import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { getPosts } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import type { Post } from '../posts/types'
import { BottomSheet, useMobileLayout } from './components/BottomSheet'
import { sheetOpenAfterSearch } from './components/bottomSheetLogic'
import { DataAttribution } from './components/DataAttribution'
import { type Condition, HazardCondition } from './components/HazardCondition'
import { HazardLegend } from './components/HazardLegend'
import { LayerPicker } from './components/LayerPicker'
import { PlaceInput } from './components/PlaceInput'
import { RouteRationale } from './components/RouteRationale'
import { RouteTable } from './components/RouteTable'
import { SafeShelterSearchButton } from './components/SafeShelterSearchButton'
import { ShelterResult } from './components/ShelterResult'
import { DRAW_ORDER, STYLE } from './constants'
import { inArea, useArea } from './hooks/useArea'
import { useGeocode } from './hooks/useGeocode'
import { tileUrlOf, useHazards, vectorUrlOf } from './hooks/useHazards'
import { type Platform, useMapAdapter } from './hooks/useMapAdapter'
import { useSearch } from './hooks/useSearch'
import { useShelters } from './hooks/useShelters'
import { useVector } from './hooks/useVector'
import { distanceKm } from './lib/distance'
import { nearestSegment, routeBounds } from './lib/geo'
import { currentPosition, type Place } from './lib/gsi'
import type { PlaceSuggestion } from './lib/place-search'
import {
  buildHazards,
  buildRouteSearchRequest,
  buildShelterSearchRequest,
  FLOOD_SCENARIO,
} from './lib/search-request'
import { shelterIsVisible } from './lib/shelter-viewport'
import { initialSafeState, type PlaceField, safeReducer } from './state/evac-route-state'
import type { Rationale, ShelterCandidate, ShelterFeature } from './types'

const CENTER: [number, number] = [139.792, 35.733]
const EMPTY = { type: 'FeatureCollection' as const, features: [] }
const FLOOD_ZOOM = { minzoom: 12, maxzoom: 15 }
const SHEET_SCREEN_CLASS = 'min-h-full bg-white px-4 py-4'
/** 指定地点から道路までの距離が、これ以上なら画面で断る(m)。
 * 実測（対象エリア内の施設4,550件）で中央値40m・95パーセンタイル84m。
 * 40mで出すと3回に1回出てしまい、読まれなくなる */
const SNAP_NOTE_M = 80

function shelterPlace(feature: ShelterFeature): Place {
  return {
    title: feature.properties.name,
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
  }
}

export function EvacRouteMap({ platform = 'maplibre' }: { platform?: Platform }) {
  const { user } = useAuth()
  const { adapter, ready } = useMapAdapter(platform, 'safe-map', CENTER, 13)
  const mobile = useMobileLayout()
  const [state, dispatch] = useReducer(safeReducer, initialSafeState)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [shelterSearchLoading, setShelterSearchLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const requestedLocation = useRef(false)
  const shelterSearchRunning = useRef(false)
  const floodAdded = useRef(false)
  const quakeAdded = useRef(false)
  const layersButtonRef = useRef<HTMLButtonElement>(null)
  const layersPopoverRef = useRef<HTMLElement>(null)
  const { catalog, error: hazardError } = useHazards()
  const { area, error: areaError } = useArea()
  const search = useSearch()
  const {
    data: shelterData,
    error: shelterError,
    loading: sheltersLoading,
  } = useShelters(true, area?.bbox)

  const active = state[state.activeField]
  // ⚠️ 探索範囲を渡す。Places は `locationRestriction` で範囲外をそもそも
  //    返さなくなる（「上野駅」で全国の同名地点が出るのを止める）
  const geocode = useGeocode(
    active.query,
    state.screen === 'search' && active.place === null,
    area?.bbox,
  )
  const layer = state.mapLayer
  const floodUrl = layer === 'flood' ? tileUrlOf(catalog, 'flood', FLOOD_SCENARIO) : null
  const quakeScenario = catalog?.hazards.find((h) => h.id === 'quake')?.scenarios[0]?.id ?? 'total'
  const quakeUrl = layer === 'quake' ? vectorUrlOf(catalog, 'quake', quakeScenario) : null
  const { data: quakeData, loading: quakeLoading, error: quakeError } = useVector(quakeUrl)
  const bundle = search.bundle

  // 「考慮する災害」の定義。危険区間の呼び名も統計キーもAPIが配る
  // （`registry.py` の risk ブロック由来。ここに種別ごとの分岐を書かない）
  const hazardMeta = catalog?.hazards.find((h) => h.id === state.hazard) ?? null
  /** 畳んだシートの見出し。⚠️ 災害の呼び名は `/api/hazards` 由来を使い、
   * ここで新しい言い方を作らない。掛け合わせていない（＝最短しか引いていない）
   * ときは「最短経路」と言う */
  const conditionLabel =
    bundle == null
      ? undefined
      : bundle.selected_route === 'baseline' || !hazardMeta
        ? '最短経路'
        : `${hazardMeta.label}を考慮`

  // ⚠️ **経路の重みに掛けた種別だけを見せる**（2026-08-22にユーザーと確認）。
  //    APIは登録済み種別を全部返し、`considered` で区別する。絞り込みはここで行い、
  //    `RouteRationale` は渡されたものを全部描く自己完結の部品のままにする。
  const consideredHazards = bundle?.rationale?.hazards.filter((h) => h.considered) ?? []
  // 指定地点から道路までの距離。⚠️ **実測の95パーセンタイル（84m）を目安にする。**
  // 中央値の40mで出すと3回に1回出て、読まれなくなる
  const snapNote = useMemo(() => {
    const far = (['origin', 'dest'] as const)
      .map((k) => ({ k, m: bundle?.od?.[k]?.snap_m ?? 0 }))
      .filter((x) => x.m >= SNAP_NOTE_M)
    if (far.length === 0) return null
    const label = { origin: '出発地', dest: '目的地' }
    const parts = far.map((x) => `${label[x.k]}から約${Math.round(x.m)}m`)
    return `${parts.join('・')}離れた道路から経路を引いています（指定した地点は建物・敷地の代表点で、道路上の点ではありません）。`
  }, [bundle])
  const primaryHazard = consideredHazards[0] ?? null

  const [latestPost, setLatestPost] = useState<Post | null>(null)

  useEffect(() => {
    void getPosts({ limit: 1, offset: 0, sort: 'recent', userId: 'anonymous' })
      .then((result) => {
        setLatestPost(result.items[0] ?? null)
      })
      .catch(() => undefined)
  }, [])

  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  function openScreen(screen: 'home' | 'search' | 'route') {
    setLayersOpen(false)
    if (screen === 'search') dispatch({ type: 'open_search', purpose: 'route' })
    else dispatch({ type: 'open', screen })
    setSheetOpen(screen !== 'home')
  }

  function toggleLayers() {
    setLayersOpen((open) => !open)
  }

  useEffect(() => {
    if (!layersOpen) return

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (layersButtonRef.current?.contains(target) || layersPopoverRef.current?.contains(target)) {
        return
      }
      setLayersOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [layersOpen])

  const shelters = useMemo(() => {
    const origin = state.origin.place
    return [...(shelterData?.features ?? [])]
      .map((feature) => ({
        feature,
        distance: origin ? distanceKm(origin, shelterPlace(feature)) : null,
      }))
      .sort(
        (a, b) =>
          (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY),
      )
  }, [shelterData, state.origin.place])

  const nearbyShelters = useMemo(() => shelters.slice(0, 8), [shelters])

  /** いま画面が選んでいる条件。**再検索へはこれをそのまま渡す。** */
  const condition = useMemo<Condition>(() => ({ hazard: state.hazard }), [state.hazard])

  const runRoute = useCallback(
    async (
      destination: Place,
      {
        origin = state.origin.place,
        // ⚠️ **条件は引数で受ける。** 切り替え直後に state を読むと
        //    更新前の値になり、古い条件で引き直してしまう
        with: cond = condition,
        keepPrevious = false,
        // 条件の切り替えのように、シートを操作している最中の引き直しでは畳まない
        collapseOnMobile = true,
      }: {
        origin?: Place | null
        with?: Condition
        keepPrevious?: boolean
        collapseOnMobile?: boolean
      } = {},
    ) => {
      dispatch({ type: 'select_place', field: 'destination', place: destination })
      // 条件の切り替えでは前の結果を消さない（消すと画面が一瞬空になる）
      if (!keepPrevious) search.clear()
      if (!origin) {
        dispatch({ type: 'open_search', purpose: 'route' })
        setSheetOpen(true)
        dispatch({ type: 'activate_field', field: 'origin' })
        flash('出発地を指定してください')
        return
      }
      if (
        !inArea(area, origin.lat, origin.lon) ||
        !inArea(area, destination.lat, destination.lon)
      ) {
        dispatch({ type: 'open_search', purpose: 'route' })
        setSheetOpen(true)
        flash('対象エリア内の地点を指定してください')
        return
      }
      const base = buildShelterSearchRequest(origin, buildHazards(cond), FLOOD_SCENARIO)
      const result = await search.run(buildRouteSearchRequest(base, destination))
      if (result) {
        dispatch({ type: 'route_ready', routes: result.routes.map((route) => route.id) })
        // ⚠️ **考慮した災害のタイルを自動で出す。** 経路だけ見せても、なぜその
        //    迂回になったのかが地図から読み取れない
        dispatch({ type: 'set_layer', layer: cond.hazard })
        // ⚠️ スマホでは畳む。判定と理由は `bottomSheetLogic.sheetOpenAfterSearch`
        setSheetOpen(sheetOpenAfterSearch(mobile, collapseOnMobile))
      }
    },
    [area, condition, flash, mobile, search.clear, search.run, state.origin.place],
  )

  const runShelterSearch = useCallback(
    async (
      selectedOrigin?: Place | null,
      cond: Condition = condition,
      { collapseOnMobile = true }: { collapseOnMobile?: boolean } = {},
    ) => {
      if (shelterSearchRunning.current) return
      const origin = selectedOrigin ?? state.origin.place
      if (!origin) {
        dispatch({ type: 'open_search', purpose: 'shelter' })
        setSheetOpen(true)
        flash('出発地を指定してください')
        return
      }
      if (!inArea(area, origin.lat, origin.lon)) {
        dispatch({ type: 'open_search', purpose: 'shelter' })
        setSheetOpen(true)
        flash('対象エリア内の出発地を指定してください')
        return
      }

      shelterSearchRunning.current = true
      setShelterSearchLoading(true)
      try {
        const request = buildShelterSearchRequest(origin, buildHazards(cond), FLOOD_SCENARIO)
        const result = await search.runShelter(request)
        // 失敗（範囲外・該当避難先なし）のときは `search.error` に本文が入る。
        // ⚠️ ここで search.error を読むと**1つ前のレンダーの値**なので読まない。
        //    表示はシート上部の search.error に任せる
        if (!result?.shelter) return
        // 推奨した避難先を目的地として扱う。以降の表示は2点探索と同じ
        dispatch({
          type: 'select_place',
          field: 'destination',
          place: {
            title: result.shelter.name,
            lat: result.shelter.latlon[0],
            lon: result.shelter.latlon[1],
          },
        })
        dispatch({ type: 'route_ready', routes: result.routes.map((route) => route.id) })
        // 考慮した災害のタイルを自動で出す（runRoute と同じ理由）
        dispatch({ type: 'set_layer', layer: cond.hazard })
        // スマホでは畳む（runRoute と同じ）
        setSheetOpen(sheetOpenAfterSearch(mobile, collapseOnMobile))
      } catch (error) {
        flash((error as Error).message)
      } finally {
        shelterSearchRunning.current = false
        setShelterSearchLoading(false)
      }
    },
    [area, condition, flash, mobile, search.runShelter, state.origin.place],
  )

  /** 考慮する災害を切り替える。**検索後なら、同じ探索を新しい条件で引き直す。**
   *
   * 以前は検索画面でしか選べず、結果画面は「何を考慮したか」を表示するだけ
   * だった。災害を変えると経路も避難先も変わるのに、変えるには最初から
   * やり直す必要があった。
   *
   * ⚠️ **避難先探索は推奨が選び直される。** 種別が変われば「一番安全に
   *    着ける先」も変わるので、目的地を固定して引き直してはいけない。
   *    候補から選んだ経路（＝目的地指定）は、その目的地のまま引き直す。
   */
  const applyCondition = useCallback(
    (next: Condition) => {
      dispatch({ type: 'set_hazard', hazard: next.hazard })
      if (state.screen !== 'route') return
      // ⚠️ **ここでは畳まない。** 利用者はシートの中の切り替えを操作している
      //    最中なので、押すたびにシートが消えると条件を比べられない
      if (bundle?.shelter) {
        void runShelterSearch(state.origin.place, next, { collapseOnMobile: false })
      } else if (state.destination.place) {
        void runRoute(state.destination.place, {
          with: next,
          keepPrevious: true,
          collapseOnMobile: false,
        })
      }
    },
    [
      bundle?.shelter,
      runRoute,
      runShelterSearch,
      state.destination.place,
      state.origin.place,
      state.screen,
    ],
  )

  /** 候補をタップしたとき。その避難所を目的地にして普通の2点探索へ切り替える。
   * ⚠️ 避難先探索をやり直すと推奨が選び直されて別の場所へ飛ぶので、
   *    ここは `runRoute`（目的地指定）を使う */
  const chooseCandidate = useCallback(
    (candidate: ShelterCandidate) => {
      void runRoute({
        title: candidate.name,
        lat: candidate.latlon[0],
        lon: candidate.latlon[1],
      })
    },
    [runRoute],
  )

  const requestLocation = useCallback(async () => {
    try {
      const place = await currentPosition()
      dispatch({ type: 'select_place', field: 'origin', place })
      adapter.current?.flyTo([place.lon, place.lat], 15)
    } catch (error) {
      flash((error as Error).message)
    }
  }, [adapter, flash])

  useEffect(() => {
    if (requestedLocation.current) return
    requestedLocation.current = true
    void requestLocation()
  }, [requestLocation])

  /** 候補を選ぶ。
   *
   * ⚠️ **座標はここで初めて確定することがある。** Places の候補は選ぶまで
   * 座標を持たない（`PlaceSuggestion.resolve()` が Place Details を1回叩く）。
   * 国土地理院の候補は最初から持っているので、その場合は即座に決まる。
   */
  async function choosePlace(suggestion: PlaceSuggestion) {
    const field = state.activeField
    try {
      const place = suggestion.place ?? (await suggestion.resolve())
      if (!inArea(area, place.lat, place.lon)) {
        flash('対象エリア内の地点を指定してください')
        return
      }
      dispatch({ type: 'select_place', field, place })
    } catch (e) {
      flash((e as Error).message)
    }
  }

  const prepareDestination = useCallback(
    (place: Place) => {
      search.clear()
      setLayersOpen(false)
      dispatch({ type: 'select_place', field: 'destination', place })
      dispatch({
        type: 'activate_field',
        field: state.origin.place ? 'destination' : 'origin',
      })
      dispatch({ type: 'open_search', purpose: 'route' })
      setSheetOpen(true)
    },
    [search.clear, state.origin.place],
  )

  function endRoute() {
    search.clear()
    dispatch({ type: 'end_route' })
    setSheetOpen(false)
    const origin = state.origin.place
    adapter.current?.flyTo(origin ? [origin.lon, origin.lat] : CENTER, origin ? 15 : 13)
  }

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready || !area) return
    const [w, s, e, n] = area.bbox
    a.setAreaOutline([
      [w, s],
      [e, n],
    ])
  }, [adapter, ready, area])

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    a.setRoutes(bundle?.geojson ?? EMPTY, STYLE, DRAW_ORDER)
    if (!bundle) return
    a.onClick(({ lngLat, route }) => {
      const segment = nearestSegment(bundle, route, lngLat)
      if (!segment) return
      // ⚠️ 表記は「危険度」で統一する（凡例・指標と揃える）
      const rank = segment.quake_rank == null ? '評価範囲外' : `危険度 ${segment.quake_rank} / 5`
      a.showPopup(
        lngLat,
        `<b>${segment.name ?? '名称なし'}</b><br>最大浸水深 ${segment.depth_max.toFixed(2)}m<br>地震危険度 ${rank}`,
      )
    })
    const allShown = Object.fromEntries(bundle.routes.map((route) => [route.id, true]))
    const bounds = routeBounds(bundle, allShown)
    if (bounds) {
      a.fitBounds(bounds, {
        padding:
          window.innerWidth >= 900
            ? { top: 64, right: 64, bottom: 64, left: 480 }
            : { top: 32, right: 24, bottom: 120, left: 24 },
        duration: 400,
      })
    }
  }, [adapter, ready, bundle])

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready || !bundle) return
    for (const route of bundle.routes) a.setVisible(route.id, state.shownRoutes[route.id] !== false)
  }, [adapter, ready, bundle, state.shownRoutes])

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    if (floodUrl) {
      if (!floodAdded.current) {
        a.addRasterLayer('flood', floodUrl, { ...FLOOD_ZOOM, opacity: state.opacity })
        floodAdded.current = true
      } else a.setRasterTiles('flood', floodUrl)
      a.setLayerVisible('flood', true)
      a.setLayerOpacity('flood', state.opacity)
    } else if (floodAdded.current) a.setLayerVisible('flood', false)
  }, [adapter, ready, floodUrl, state.opacity])

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    if (quakeData) {
      a.setVectorAreas('quake', quakeData, { opacity: state.opacity })
      quakeAdded.current = true
      a.setLayerVisible('quake', true)
      a.setLayerOpacity('quake', state.opacity)
    } else if (quakeAdded.current) a.setLayerVisible('quake', false)
  }, [adapter, ready, quakeData, state.opacity])

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    return a.onViewportChange((viewport) => {
      a.setShelterMarkers(
        shelters
          .filter(({ feature }) => shelterIsVisible(feature, viewport, area))
          .map(({ feature }) => ({
            lngLat: feature.geometry.coordinates,
            label: `【${feature.properties.type_label}】${feature.properties.name}`,
            shelterType: feature.properties.type,
            onClick: () => prepareDestination(shelterPlace(feature)),
          })),
      )
    })
  }, [adapter, ready, shelters, area, prepareDestination])

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    const markers = []
    if (state.origin.place) {
      markers.push({
        lngLat: [state.origin.place.lon, state.origin.place.lat] as [number, number],
        label: state.origin.place.title,
        role: 'origin' as const,
      })
    }
    if (state.destination.place) {
      markers.push({
        lngLat: [state.destination.place.lon, state.destination.place.lat] as [number, number],
        label: state.destination.place.title,
        role: 'destination' as const,
      })
    }
    a.setMarkers(markers)
  }, [adapter, ready, state.origin.place, state.destination.place])

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    a.onLongPress(([lon, lat]) => {
      if (state.screen === 'route' || state.screen === 'layers') return
      const field: PlaceField = state.screen === 'home' ? 'destination' : state.activeField
      const place = {
        title: '地図上の指定地点',
        lat,
        lon,
      }
      dispatch({ type: 'select_place', field, place })
      search.clear()
      if (state.screen === 'home') flash('目的地を設定しました')
    })
  }, [adapter, ready, state.screen, state.activeField, search.clear, flash])

  const error = areaError ?? hazardError ?? shelterError
  const shelterSearchMode = state.searchPurpose === 'shelter'
  const searchFields: readonly PlaceField[] = shelterSearchMode
    ? ['origin']
    : ['origin', 'destination']
  const mapPoint =
    state.destination.place?.title === '地図上の指定地点' ? state.destination.place : null

  return (
    <main className="relative min-h-dvh w-full overflow-hidden bg-slate-50 text-[#182035] shadow-[0_0_36px_rgb(15_23_42/14%)] min-[900px]:grid min-[900px]:h-dvh min-[900px]:min-h-0 min-[900px]:grid-cols-[clamp(360px,34vw,480px)_minmax(0,1fr)] min-[900px]:grid-rows-[54px_minmax(0,1fr)]">
      <header className="flex h-[54px] items-center justify-between border-b border-slate-200 bg-white/95 px-4 min-[900px]:col-span-2 min-[900px]:col-start-1 min-[900px]:row-start-1">
        <div className="flex items-center gap-2 text-sm tracking-[0.08em] text-[#07156f]">
          <span className="grid size-6 place-items-center rounded-lg bg-[#07156f] text-white">
            ◇
          </span>
          <strong>SAFE</strong>
        </div>
        <a href="/mypage" aria-label="マイページ">
          <span className="grid size-[30px] place-items-center rounded-full bg-[#07145f] text-[11px] font-bold text-white">
            {user?.name.slice(0, 1).toUpperCase() ?? '?'}
          </span>
        </a>
      </header>

      <section
        className="relative h-[calc(100dvh-54px)] bg-[#dce7e7] min-[900px]:col-start-2 min-[900px]:row-start-2 min-[900px]:h-auto min-[900px]:min-h-0"
        aria-label="地図"
        aria-busy={search.loading}
      >
        <div id="safe-map" className="absolute inset-0" />
        {state.screen === 'home' && (
          <button
            type="button"
            className="absolute top-3 left-3 z-[3] flex min-h-12 w-[calc(100%-24px)] cursor-pointer items-center gap-2.5 rounded-[13px] border border-slate-100 bg-white px-4 text-left text-slate-500 shadow-[0_5px_16px_rgb(15_23_42/14%)] [&>span:last-child]:overflow-hidden [&>span:last-child]:text-ellipsis [&>span:last-child]:whitespace-nowrap"
            onClick={() => openScreen('search')}
          >
            <span aria-hidden="true">⌕</span>
            <span>{state.destination.place?.title ?? '目的地・避難所を検索する'}</span>
          </button>
        )}
        <button
          type="button"
          className="map-tool map-tool--locate"
          onClick={() => void requestLocation()}
          aria-label="現在地へ移動"
        >
          ◎
        </button>
        <button
          ref={layersButtonRef}
          type="button"
          className="map-tool map-tool--layers"
          onClick={toggleLayers}
          aria-label="地図レイヤー"
          aria-expanded={layersOpen}
          aria-controls="map-layer-popover"
        >
          ▱
        </button>
        {layersOpen && (
          <section
            ref={layersPopoverRef}
            id="map-layer-popover"
            className="absolute right-[60px] bottom-[calc(var(--sheet-peek,74px)+23px)] z-[4] w-[min(280px,calc(100%-84px))] rounded-xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgb(15_23_42/22%)] min-[900px]:bottom-[55px]"
            aria-label="地図レイヤーの設定"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="m-0 text-sm">地図に表示する情報</h2>
              <button
                type="button"
                className="grid size-7 cursor-pointer place-items-center rounded-full border-0 bg-slate-100"
                onClick={() => setLayersOpen(false)}
                aria-label="閉じる"
              >
                ×
              </button>
            </div>
            <LayerPicker
              value={state.mapLayer}
              loading={quakeLoading}
              error={quakeError}
              onChange={(layer) => dispatch({ type: 'set_layer', layer })}
            />
          </section>
        )}
        {search.loading && (
          <div
            className="absolute inset-0 z-[5] flex items-start justify-center bg-slate-950/5 pt-[72px] min-[900px]:items-center min-[900px]:pt-0"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3 rounded-xl bg-white/85 px-4 py-3 text-[11px] font-bold text-slate-700 shadow-[0_4px_16px_rgb(15_23_42/18%)] backdrop-blur-sm">
              <span
                className="size-5 shrink-0 animate-spin rounded-full border-[3px] border-slate-300 border-t-[#07156f] motion-reduce:animate-none"
                aria-hidden="true"
              />
              {shelterSearchLoading ? '安全な避難先を検索中…' : '安全な経路を検索中…'}
            </div>
          </div>
        )}
      </section>

      <BottomSheet
        adapter={adapter}
        bundle={bundle}
        conditionLabel={conditionLabel}
        mobile={mobile}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        desktopMode="sidebar"
        collapsedLabel={
          state.screen === 'home'
            ? `近くの避難先 ${nearbyShelters.length}件`
            : state.screen === 'search'
              ? '地点を検索'
              : '避難経路'
        }
      >
        <section className="relative min-h-[calc(100dvh-346px)] bg-slate-50 min-[900px]:min-h-full">
          {error && (
            <p className="mx-3 my-2.5 rounded-lg bg-red-50 px-3 py-2 text-[10px] leading-normal text-red-700">
              データの読み込みに失敗しました: {error}
            </p>
          )}
          {search.error && state.screen !== 'search' && (
            <p className="mx-3 my-2.5 rounded-lg bg-red-50 px-3 py-2 text-[10px] leading-normal text-red-700">
              {search.error}
            </p>
          )}
          {state.screen === 'home' && (
            <>
              <section className="px-3 pb-2">
                <div className="mb-1.5 flex items-center justify-between [&_a]:text-[9px] [&_a]:font-bold [&_a]:text-[#07156f] [&_a]:no-underline [&_h2]:m-0 [&_h2]:text-sm">
                  <h2>みんなの声</h2>
                  <a href="/timeline">もっと見る</a>
                </div>
                {latestPost ? (
                  <article className="rounded-lg border border-slate-200 bg-slate-100 p-2 text-[9px] [&>p]:my-1 [&>p]:pl-6 [&>p]:leading-normal">
                    <div className="flex items-center gap-1.5 text-[9px] [&_time]:ml-auto [&_time]:text-[8px] [&_time]:text-slate-400">
                      <span className="grid size-5 place-items-center rounded-full border border-slate-300 text-[9px] text-slate-500">
                        ◎
                      </span>
                      <strong>{latestPost.user_name}</strong>
                      <time>
                        {(() => {
                          const iso = latestPost.created_at.replace(' ', 'T')
                          return new Date(
                            /[Z+]/.test(iso.slice(-6)) ? iso : `${iso}Z`,
                          ).toLocaleString('ja-JP', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        })()}
                      </time>
                    </div>
                    <p>{latestPost.content}</p>
                    <span className="pl-6 text-[8px] text-[#07156f]">
                      ♧ 役に立った {latestPost.helpful_count}
                    </span>
                  </article>
                ) : (
                  <p className="text-[9px] text-slate-400">投稿はまだありません</p>
                )}
              </section>
              <a
                href="/posts/new"
                className="mx-3 mb-2.5 flex min-h-9 w-[calc(100%-24px)] cursor-pointer items-center justify-center rounded-md bg-[#07156f] text-[10px] font-bold text-white no-underline"
              >
                ▣ 投稿する
              </a>
              <section className="border-t border-slate-200 px-3 pt-2.5 pb-3">
                <div className="mb-1.5 flex items-center justify-between [&_h2]:m-0 [&_h2]:text-sm [&_span]:text-[9px] [&_span]:font-bold [&_span]:text-[#07156f]">
                  <h2>近くの避難先</h2>
                  <span>{sheltersLoading ? '読込中…' : `${nearbyShelters.length}件表示`}</span>
                </div>
                {/* ⚠️ **いまの出発地を画面に出す。** ここに出していなかった頃は、
                    前の検索の出発地が残っていることに気づけず、別の地点から
                    調べ直すのにページ再読み込みが要った（チーム指摘、2026-08-23） */}
                <p className="mb-2 flex items-center gap-1.5 text-[9px] text-slate-500">
                  <span className="shrink-0">出発地</span>
                  <strong className="truncate font-bold text-slate-700">
                    {state.origin.place?.title ?? '未設定'}
                  </strong>
                  <button
                    type="button"
                    className="ml-auto shrink-0 cursor-pointer rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] text-[#07156f]"
                    onClick={() => {
                      dispatch({ type: 'open_search', purpose: 'shelter' })
                      setSheetOpen(true)
                    }}
                  >
                    {state.origin.place ? '変更' : '設定'}
                  </button>
                </p>
                {/* ⚠️ ここは出発地が既にあると**押した瞬間に検索が走る**ので、
                    先に災害を選べるようにしておく。検索画面へ入らないと
                    選べないままだと、既定（地震）で探したことに気づけない */}
                <HazardCondition hazard={state.hazard} onChange={applyCondition} />
                <SafeShelterSearchButton
                  loading={shelterSearchLoading}
                  onSearch={runShelterSearch}
                />
                <div className="grid gap-1.5">
                  {nearbyShelters.map(({ feature, distance }) => (
                    <article
                      className="rounded-lg border border-slate-200 bg-white p-2 shadow-[0_2px_5px_rgb(15_23_42/4%)] [&_h3]:my-1 [&_h3]:text-xs [&_p]:mb-1.5 [&_p]:text-[9px] [&_p]:text-slate-600"
                      key={feature.properties.id}
                    >
                      <button
                        type="button"
                        className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
                        onClick={() => prepareDestination(shelterPlace(feature))}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`inline-flex min-h-4 items-center rounded-full px-1.5 text-[8px] font-bold ${feature.properties.type === 'urgent' ? 'bg-orange-50 text-orange-800' : 'bg-emerald-50 text-emerald-800'}`}
                          >
                            {feature.properties.type_label}
                          </span>
                          <span className="text-[9px] text-slate-600">
                            {distance === null ? '距離未取得' : `${distance.toFixed(1)} km`}
                          </span>
                        </div>
                        <h3>{feature.properties.name}</h3>
                        <p>{feature.properties.address}</p>
                      </button>
                      <button
                        type="button"
                        className="min-h-8 w-full cursor-pointer rounded-md border-0 bg-[#07156f] text-[10px] font-bold text-white"
                        onClick={() => prepareDestination(shelterPlace(feature))}
                      >
                        ◇ ここへ行く
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}

          {state.screen === 'search' && (
            <section className={SHEET_SCREEN_CLASS}>
              <div className="mb-4 flex items-center gap-3 [&>button]:grid [&>button]:size-[34px] [&>button]:cursor-pointer [&>button]:place-items-center [&>button]:rounded-full [&>button]:border-0 [&>button]:bg-slate-100 [&_h2]:m-0 [&_h2]:text-base">
                <button type="button" onClick={() => openScreen('home')} aria-label="戻る">
                  ←
                </button>
                <h2>{shelterSearchMode ? '安全な避難先を探す' : '目的地を検索'}</h2>
              </div>
              {shelterSearchMode && (
                <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-[10px] leading-relaxed text-[#07156f]">
                  安全な避難先を探すため、現在地または出発地を指定してください。
                </p>
              )}
              <HazardCondition hazard={state.hazard} onChange={applyCondition} />
              {searchFields.map((field) => {
                const value = state[field]
                return (
                  <PlaceInput
                    id={`safe-${field}`}
                    key={field}
                    label={field === 'origin' ? '出発地' : '目的地'}
                    query={value.query}
                    placeholder={field === 'origin' ? '現在地・住所' : '住所・駅名・施設名'}
                    active={state.activeField === field}
                    onActivate={() => dispatch({ type: 'activate_field', field })}
                    onQueryChange={(query) => dispatch({ type: 'edit_field', field, query })}
                    onClear={() => {
                      search.clear()
                      dispatch({ type: 'clear_place', field })
                      dispatch({ type: 'activate_field', field })
                    }}
                  />
                )
              })}
              <button
                type="button"
                className="mb-2 ml-[66px] cursor-pointer border-0 bg-transparent text-[10px] text-[#07156f]"
                onClick={() => void requestLocation()}
              >
                ◎ 現在地を出発地にする
              </button>
              {shelterSearchMode ? (
                <SafeShelterSearchButton
                  loading={shelterSearchLoading}
                  disabled={state.origin.place === null}
                  onSearch={runShelterSearch}
                />
              ) : (
                <button
                  type="button"
                  className="mb-2.5 min-h-9 w-full cursor-pointer rounded-md border-0 bg-[#07156f] text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={
                    state.origin.place === null ||
                    state.destination.place === null ||
                    search.loading
                  }
                  onClick={() => {
                    if (state.destination.place) void runRoute(state.destination.place)
                  }}
                >
                  {search.loading ? '経路を検索中…' : 'この条件で経路を検索する'}
                </button>
              )}
              {search.error && (
                <p className="mx-3 my-2.5 rounded-lg bg-red-50 px-3 py-2 text-[10px] leading-normal text-red-700">
                  {search.error}
                </p>
              )}
              {active.query.trim() && active.place === null ? (
                <>
                  <p className="mt-4 mb-2 text-[10px] font-bold text-slate-500">検索結果</p>
                  <div className="border-t border-slate-100 [&>button]:grid [&>button]:min-h-[58px] [&>button]:w-full [&>button]:cursor-pointer [&>button]:grid-cols-[31px_1fr_auto] [&>button]:items-center [&>button]:border-0 [&>button]:border-b [&>button]:border-slate-100 [&>button]:bg-transparent [&>button]:px-1 [&>button]:py-2 [&>button]:text-left [&>button:disabled]:cursor-not-allowed [&>button:disabled]:opacity-50">
                    {geocode.loading && (
                      <p className="p-6 text-center text-[11px] text-slate-500">検索中…</p>
                    )}
                    {geocode.error && (
                      <p className="p-6 text-center text-[11px] text-slate-500">{geocode.error}</p>
                    )}
                    {geocode.places.map((suggestion) => {
                      // ⚠️ 座標を持たない候補（Places）では、エリア内かどうかを
                      //    事前に言えない。**言えないことを「対象外」と出さない**
                      const known = suggestion.place
                      const inside = known ? inArea(area, known.lat, known.lon) : null
                      return (
                        <button
                          type="button"
                          key={suggestion.id}
                          onClick={() => void choosePlace(suggestion)}
                          disabled={inside === false}
                        >
                          <span className="text-lg text-[#07156f]">⌖</span>
                          <span className="[&_small]:mt-1 [&_small]:block [&_small]:text-[9px] [&_small]:text-slate-500 [&_strong]:block [&_strong]:text-xs">
                            <strong>{suggestion.title}</strong>
                            <small>
                              {suggestion.address ??
                                (known ? `${known.lat.toFixed(5)}, ${known.lon.toFixed(5)}` : '')}
                            </small>
                          </span>
                          <em className="text-[8px] text-[#07156f] not-italic">
                            {inside === false ? '対象外' : '選択'}
                          </em>
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="grid justify-items-center px-4 pt-[30px] pb-[22px] text-center text-slate-500 [&>p]:my-1.5 [&>p]:text-[10px] [&>small]:text-[9px] [&>small]:text-slate-400 [&>strong]:text-xs [&>strong]:text-slate-700">
                  <span className="mb-2.5 grid size-[42px] place-items-center rounded-full bg-slate-100 text-xl text-[#07156f]">
                    ⌕
                  </span>
                  <strong>
                    {shelterSearchMode && state.origin.place
                      ? '出発地を設定しました'
                      : state.activeField === 'origin'
                        ? '出発地を入力してください'
                        : '目的地を入力してください'}
                  </strong>
                  <p>
                    {shelterSearchMode && state.origin.place
                      ? '上のボタンから安全な避難先を検索できます'
                      : '施設名、駅名、住所から検索できます'}
                  </p>
                  <small>
                    {shelterSearchMode && state.origin.place
                      ? state.origin.place.title
                      : '地図の長押しでも指定できます'}
                  </small>
                </div>
              )}
            </section>
          )}

          {state.screen === 'route' && (
            <section className={SHEET_SCREEN_CLASS}>
              <div className="mb-4 flex items-center gap-3 [&>button]:grid [&>button]:size-[34px] [&>button]:cursor-pointer [&>button]:place-items-center [&>button]:rounded-full [&>button]:border-0 [&>button]:bg-slate-100 [&_h2]:m-0 [&_h2]:text-base [&_small]:text-[9px] [&_small]:text-slate-500">
                <button type="button" onClick={endRoute} aria-label="経路を終了">
                  ×
                </button>
                <div>
                  <small>{state.origin.place?.title} →</small>
                  <h2>{state.destination.place?.title}</h2>
                </div>
              </div>
              {/* 表示だけでなく、ここで切り替えて引き直せる */}
              <HazardCondition
                busy={search.loading}
                hazard={state.hazard}
                note={
                  bundle?.shelter
                    ? '切り替えると避難先から探し直します'
                    : '切り替えると経路を引き直します'
                }
                onChange={applyCondition}
                title="経路条件"
              />
              {search.loading && (
                <p className="mb-3 text-[9px] text-slate-500" role="status">
                  新しい条件で引き直しています…
                </p>
              )}
              {/* ⚠️ 指定した地点と経路の端がずれることを黙らない。
                  施設・住所の代表点は道路上の点ではないので、探索は最寄りの
                  道路ノードから始まる（実測: 都内の施設4,550件で中央値40m、
                  95%が84m以内、300m超は0.77%）。目立つときだけ言う */}
              {snapNote && (
                <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-[9px] leading-relaxed text-slate-600">
                  {snapNote}
                </p>
              )}
              {bundle && (
                <RouteTable
                  bundle={bundle}
                  shown={state.shownRoutes}
                  risk={hazardMeta?.risk}
                  hazard={primaryHazard}
                  distance={bundle.rationale?.distance ?? null}
                  onToggle={(route, shown) => dispatch({ type: 'show_route', route, shown })}
                />
              )}
              {/* なぜこの経路なのか。短文と詳細4行はAPIが完成した文字列で返す
                  （`backend/app/services/evac_routes/rationale.py` が文言の単一の出所）。
                  この部品は分解せず、置き場所を変えるだけで使う */}
              {consideredHazards.length > 0 && (
                <RouteRationale
                  rationale={{
                    ...(bundle?.rationale as Rationale),
                    hazards: consideredHazards,
                  }}
                />
              )}
              {/* 避難先探索のときだけ。推奨1件と比較材料。
                  ⚠️ 候補に通し番号の順位を振らないこと（ShelterResult 冒頭） */}
              {bundle?.shelter && bundle.shelter_candidates && bundle.shelter_query && (
                <ShelterResult
                  candidates={bundle.shelter_candidates}
                  onSelect={chooseCandidate}
                  query={bundle.shelter_query}
                  risk={hazardMeta?.risk}
                  shelter={bundle.shelter}
                />
              )}
              {hazardMeta?.legend && (
                <HazardLegend hazardLabel={hazardMeta.label} items={hazardMeta.legend} />
              )}
              <button
                type="button"
                className="mt-4 min-h-[42px] w-full cursor-pointer rounded-lg border border-slate-300 bg-white text-[#07156f]"
                onClick={endRoute}
              >
                経路を終了
              </button>
            </section>
          )}
        </section>
      </BottomSheet>

      {(!mobile || !sheetOpen) && <DataAttribution mobile={mobile} platform={platform} />}

      {mapPoint && state.screen === 'home' && (
        <div className="fixed top-[225px] left-1/2 z-[14] grid w-[min(calc(100%-32px),398px)] -translate-x-1/2 grid-cols-[1fr_auto] gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_6px_20px_rgb(15_23_42/22%)] min-[900px]:top-[76px] min-[900px]:left-[calc(67%+170px)]">
          <div className="[&_small]:mt-1 [&_small]:block [&_small]:text-[8px] [&_small]:text-slate-500 [&_strong]:block [&_strong]:text-[11px]">
            <strong>地図上の指定地点</strong>
            <small>
              {mapPoint.lat.toFixed(5)}, {mapPoint.lon.toFixed(5)}
            </small>
          </div>
          <button
            type="button"
            className="min-h-[38px] cursor-pointer rounded-lg border-0 bg-[#07156f] px-3 text-[9px] font-bold text-white"
            onClick={() => void runRoute(mapPoint)}
          >
            この場所へ行く
          </button>
          <button
            type="button"
            className="absolute -top-2 -right-2 size-6 cursor-pointer rounded-full border border-slate-200 bg-white p-0"
            onClick={() => dispatch({ type: 'clear_place', field: 'destination' })}
            aria-label="指定地点を解除"
          >
            ×
          </button>
        </div>
      )}
      {toast && (
        <div
          className="fixed bottom-[22px] left-1/2 z-20 w-max max-w-[calc(100%-40px)] -translate-x-1/2 rounded-lg bg-slate-900/95 px-4 py-2.5 text-[10px] text-white shadow-[0_5px_15px_rgb(15_23_42/25%)]"
          role="status"
        >
          {toast}
        </div>
      )}
    </main>
  )
}
