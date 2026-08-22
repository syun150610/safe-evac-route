import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BottomSheet, useMobileLayout } from './components/BottomSheet'
import { DataAttribution } from './components/DataAttribution'
import { HazardPicker } from './components/HazardPicker'
import { LayerPicker } from './components/LayerPicker'
import { PlaceInput } from './components/PlaceInput'
import { RouteTable } from './components/RouteTable'
import { DRAW_ORDER, STYLE } from './constants'
import { POSTS } from './fixtures/posts'
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
import { initialSafeState, type PlaceField, safeReducer } from './state/evac-route-state'
import type { ShelterFeature } from './types'

const CENTER: [number, number] = [139.792, 35.733]
const EMPTY = { type: 'FeatureCollection' as const, features: [] }
const FLOOD_ZOOM = { minzoom: 12, maxzoom: 15 }
const SHEET_SCREEN_CLASS = 'min-h-full bg-white px-4 py-4'

function shelterPlace(feature: ShelterFeature): Place {
  return {
    title: feature.properties.name,
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
  }
}

export function EvacRouteMap({ platform = 'maplibre' }: { platform?: Platform }) {
  const { adapter, ready } = useMapAdapter(platform, 'safe-map', CENTER, 13)
  const mobile = useMobileLayout()
  const [state, dispatch] = useReducer(safeReducer, initialSafeState)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const requestedLocation = useRef(false)
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
  const geocode = useGeocode(active.query, state.screen === 'search' && active.place === null)
  const layer = state.mapLayer
  const floodUrl = layer === 'flood' ? tileUrlOf(catalog, 'flood', state.scenario) : null
  const quakeScenario = catalog?.hazards.find((h) => h.id === 'quake')?.scenarios[0]?.id ?? 'total'
  const quakeUrl = layer === 'quake' ? vectorUrlOf(catalog, 'quake', quakeScenario) : null
  const { data: quakeData, loading: quakeLoading, error: quakeError } = useVector(quakeUrl)
  const bundle = search.bundle

  const flash = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  function openScreen(screen: 'home' | 'search' | 'route') {
    setLayersOpen(false)
    dispatch({ type: 'open', screen })
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
      .slice(0, 8)
  }, [shelterData, state.origin.place])

  const hazards = useMemo<Record<string, string>>(() => {
    const selection: Record<string, string> = {}
    selection[state.hazard] = state.hazard === 'quake' ? 'total' : state.scenario
    return selection
  }, [state.hazard, state.scenario])

  const runRoute = useCallback(
    async (destination: Place, origin = state.origin.place) => {
      dispatch({ type: 'select_place', field: 'destination', place: destination })
      search.clear()
      if (!origin) {
        dispatch({ type: 'open', screen: 'search' })
        setSheetOpen(true)
        dispatch({ type: 'activate_field', field: 'origin' })
        flash('出発地を指定してください')
        return
      }
      if (
        !inArea(area, origin.lat, origin.lon) ||
        !inArea(area, destination.lat, destination.lon)
      ) {
        dispatch({ type: 'open', screen: 'search' })
        setSheetOpen(true)
        flash('対象エリア内の地点を指定してください')
        return
      }
      const result = await search.run({
        origin: { lat: origin.lat, lon: origin.lon, label: origin.title },
        dest: { lat: destination.lat, lon: destination.lon, label: destination.title },
        hazards,
        include: ['baseline', 'selected'],
        scenario: state.scenario,
      })
      if (result) {
        dispatch({ type: 'route_ready', routes: result.routes.map((route) => route.id) })
        setSheetOpen(true)
      }
    },
    [area, flash, hazards, search.clear, search.run, state.origin.place, state.scenario],
  )

  function choosePlace(place: Place) {
    const field = state.activeField
    dispatch({ type: 'select_place', field, place })
    if (field === 'destination') void runRoute(place)
  }

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
      const rank = segment.quake_rank == null ? '評価範囲外' : `ランク ${segment.quake_rank} / 5`
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
    a.setShelterMarkers(
      shelters.map(({ feature }) => ({
        lngLat: feature.geometry.coordinates,
        label: `【${feature.properties.type_label}】${feature.properties.name}`,
        shelterType: feature.properties.type,
        onClick: () => void runRoute(shelterPlace(feature)),
      })),
    )
  }, [adapter, ready, shelters, runRoute])

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

  const floodScenarios = catalog?.hazards.find((hazard) => hazard.id === 'flood')?.scenarios ?? []
  const error = areaError ?? hazardError ?? shelterError
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
        <button
          type="button"
          className="size-[30px] cursor-pointer rounded-full border-0 bg-[#e8d6c5] text-[11px] text-[#433024]"
          onClick={() => flash('プロフィールは準備中です')}
          aria-label="プロフィール"
        >
          人
        </button>
      </header>

      <section
        className="relative h-[calc(100dvh-54px)] bg-[#dce7e7] min-[900px]:col-start-2 min-[900px]:row-start-2 min-[900px]:h-auto min-[900px]:min-h-0"
        aria-label="地図"
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
              scenario={state.scenario}
              scenarios={floodScenarios}
              opacity={state.opacity}
              loading={quakeLoading}
              error={quakeError}
              onChange={(layer) => dispatch({ type: 'set_layer', layer })}
              onScenarioChange={(scenario) => dispatch({ type: 'set_scenario', scenario })}
              onOpacityChange={(opacity) => dispatch({ type: 'set_opacity', opacity })}
            />
          </section>
        )}
      </section>

      <BottomSheet
        adapter={adapter}
        bundle={bundle}
        mobile={mobile}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        desktopMode="sidebar"
        collapsedLabel={
          state.screen === 'home'
            ? `近くの避難先 ${shelters.length}件`
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
              <section className="mx-3 mb-3.5 flex items-center justify-between gap-3 rounded-[10px] border border-slate-200 bg-white p-2.5 [&_small]:mt-0.5 [&_small]:block [&_small]:text-[8px] [&_small]:text-slate-500 [&_strong]:block [&_strong]:text-[11px]">
                <div>
                  <strong>経路条件</strong>
                  <small>
                    {state.hazard === 'quake' ? '建物倒壊危険度を考慮' : '浸水深を考慮'}
                  </small>
                </div>
                <HazardPicker
                  value={state.hazard}
                  onChange={(hazard) => dispatch({ type: 'set_hazard', hazard })}
                />
              </section>
              <section className="px-3 pb-3">
                <div className="mb-2 flex items-center justify-between [&_h2]:m-0 [&_h2]:text-base [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-[10px] [&_button]:font-bold [&_button]:text-[#07156f]">
                  <h2>
                    みんなの声{' '}
                    <small className="ml-1 inline-flex rounded-full bg-slate-200 px-1.5 py-0.5 align-middle text-[8px] text-slate-600">
                      サンプル
                    </small>
                  </h2>
                  <button type="button" onClick={() => flash('投稿一覧は準備中です')}>
                    もっと見る
                  </button>
                </div>
                <article className="rounded-xl border border-slate-200 bg-slate-100 p-3 text-[11px] [&>p]:my-1.5 [&>p]:pl-8 [&>p]:leading-relaxed">
                  <div className="flex items-center gap-2 text-[10px] [&_time]:ml-auto [&_time]:text-slate-400">
                    <span className="grid size-6 place-items-center rounded-full border border-slate-300 text-slate-500">
                      ◎
                    </span>
                    <strong>{POSTS[0].author}</strong>
                    <time>{POSTS[0].age}</time>
                  </div>
                  <p>{POSTS[0].body}</p>
                  <span className="pl-8 text-[9px] text-[#07156f]">
                    ♧ 役に立った {POSTS[0].reactions}
                  </span>
                </article>
              </section>
              <button
                type="button"
                className="mx-3 mb-4 min-h-11 w-[calc(100%-24px)] cursor-pointer rounded-lg border-0 bg-[#07156f] font-bold text-white"
                onClick={() => flash('投稿機能は準備中です')}
              >
                ▣ 投稿する
              </button>
              <section className="border-t border-slate-200 px-3 pt-4 pb-3">
                <div className="mb-2 flex items-center justify-between [&_h2]:m-0 [&_h2]:text-base [&_span]:text-[10px] [&_span]:font-bold [&_span]:text-[#07156f]">
                  <h2>近くの避難先</h2>
                  <span>{sheltersLoading ? '読込中…' : `${shelters.length}件表示`}</span>
                </div>
                <div className="grid gap-2.5">
                  {shelters.map(({ feature, distance }) => (
                    <article
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_2px_5px_rgb(15_23_42/4%)] [&_h3]:my-2 [&_h3]:text-[15px] [&_p]:mb-2.5 [&_p]:text-[11px] [&_p]:text-slate-600"
                      key={feature.properties.id}
                    >
                      <button
                        type="button"
                        className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
                        onClick={() => void runRoute(shelterPlace(feature))}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`inline-flex min-h-5 items-center rounded-full px-2 py-0.5 text-[9px] font-bold ${feature.properties.type === 'urgent' ? 'bg-orange-50 text-orange-800' : 'bg-emerald-50 text-emerald-800'}`}
                          >
                            {feature.properties.type_label}
                          </span>
                          <span className="text-[10px] text-slate-600">
                            {distance === null ? '距離未取得' : `${distance.toFixed(1)} km`}
                          </span>
                        </div>
                        <h3>{feature.properties.name}</h3>
                        <p>{feature.properties.address}</p>
                      </button>
                      <button
                        type="button"
                        className="min-h-10 w-full cursor-pointer rounded-lg border-0 bg-[#07156f] text-[11px] font-bold text-white"
                        onClick={() => void runRoute(shelterPlace(feature))}
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
                <h2>目的地を検索</h2>
              </div>
              {(['origin', 'destination'] as const).map((field) => {
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
              <section className="mt-3.5 rounded-[10px] border border-slate-200 bg-slate-50 p-3 [&>p]:m-0 [&>p]:text-[9px] [&>p]:leading-normal [&>p]:text-slate-600">
                <div className="mb-2 flex items-center justify-between gap-3 [&>strong]:text-[11px]">
                  <strong>考慮する災害</strong>
                  <HazardPicker
                    value={state.hazard}
                    onChange={(hazard) => dispatch({ type: 'set_hazard', hazard })}
                  />
                </div>
                <p>
                  {state.hazard === 'quake'
                    ? '建物倒壊危険度の高い地域を避けます。'
                    : '浸水深が大きい道路を避けます。'}
                </p>
                {state.hazard === 'flood' && (
                  <label className="mt-2.5 grid gap-1.5 text-[10px] text-slate-600 [&_select]:min-h-11 [&_select]:rounded-lg [&_select]:border [&_select]:border-slate-200 [&_select]:bg-white [&_select]:px-2.5">
                    浸水想定
                    <select
                      value={state.scenario}
                      onChange={(event) =>
                        dispatch({ type: 'set_scenario', scenario: event.target.value })
                      }
                    >
                      {floodScenarios.map((scenario) => (
                        <option value={scenario.id} key={scenario.id}>
                          {scenario.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </section>
              {search.loading && (
                <p className="mt-4 mb-2 text-[10px] font-bold text-slate-500">
                  安全な経路を探索中…
                </p>
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
                    {geocode.places.map((place) => {
                      const inside = inArea(area, place.lat, place.lon)
                      return (
                        <button
                          type="button"
                          key={`${place.title}-${place.lat}-${place.lon}`}
                          onClick={() => choosePlace(place)}
                          disabled={!inside}
                        >
                          <span className="text-lg text-[#07156f]">⌖</span>
                          <span className="[&_small]:mt-1 [&_small]:block [&_small]:text-[9px] [&_small]:text-slate-500 [&_strong]:block [&_strong]:text-xs">
                            <strong>{place.title}</strong>
                            <small>
                              {place.lat.toFixed(5)}, {place.lon.toFixed(5)}
                            </small>
                          </span>
                          <em className="text-[8px] text-[#07156f] not-italic">
                            {inside ? '選択' : '対象外'}
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
                    {state.activeField === 'origin'
                      ? '出発地を入力してください'
                      : '目的地を入力してください'}
                  </strong>
                  <p>施設名、駅名、住所から検索できます</p>
                  <small>地図の長押しでも指定できます</small>
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
              <section className="mb-3.5 flex items-center justify-between gap-3 rounded-[10px] border border-slate-200 bg-slate-50 p-2.5 [&_small]:mt-0.5 [&_small]:block [&_small]:text-[8px] [&_small]:text-slate-500 [&_strong]:block [&_strong]:text-[11px]">
                <div>
                  <strong>経路条件</strong>
                  <small>検索時に選択した条件</small>
                </div>
                <span
                  className={`inline-flex min-h-8 items-center rounded-lg px-2.5 text-[10px] font-bold ${state.hazard === 'flood' ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-[#07156f]'}`}
                >
                  {state.hazard === 'quake' ? '地震を考慮' : '浸水を考慮'}
                </span>
              </section>
              {bundle && (
                <RouteTable
                  bundle={bundle}
                  shown={state.shownRoutes}
                  hazard={state.hazard}
                  onToggle={(route, shown) => dispatch({ type: 'show_route', route, shown })}
                />
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
        <DataAttribution mobile platform={platform} />
      </BottomSheet>

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
      {state.screen !== 'home' && state.screen !== 'search' && (
        <button
          type="button"
          className="fixed right-[18px] bottom-[calc(var(--sheet-peek,74px)+16px)] z-12 size-12 cursor-pointer rounded-full border-0 bg-[#07156f] text-2xl text-white shadow-[0_5px_15px_rgb(7_21_111/35%)] min-[900px]:bottom-[18px]"
          onClick={() => flash('投稿機能は準備中です')}
          aria-label="投稿する"
        >
          ＋
        </button>
      )}
      {toast && (
        <div
          className="fixed bottom-[22px] left-1/2 z-20 w-max max-w-[calc(100%-40px)] -translate-x-1/2 rounded-lg bg-slate-900/95 px-4 py-2.5 text-[10px] text-white shadow-[0_5px_15px_rgb(15_23_42/25%)]"
          role="status"
        >
          {toast}
        </div>
      )}
      {search.loading && state.screen !== 'search' && (
        <div
          className="fixed bottom-[22px] left-1/2 z-20 w-max max-w-[calc(100%-40px)] -translate-x-1/2 rounded-lg bg-slate-900/95 px-4 py-2.5 text-[10px] text-white shadow-[0_5px_15px_rgb(15_23_42/25%)]"
          role="status"
        >
          安全な経路を探索中…
        </div>
      )}
    </main>
  )
}
