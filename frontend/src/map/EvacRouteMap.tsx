/** 避難経路の地図。
 *
 * **アダプタは命令的なまま使う。** state → effect → adapter.xxx() の一方通行にする
 * （宣言的に書き直すと MapLibre の内部状態と二重管理になる。§9 落とし穴2）。
 *
 * 段8で入れた3つ（docs/dev/06_次セッションへの指示.md §2）:
 *   ① 出発地・目的地の2地点入力（現在地・地理院の住所検索）… `PlaceInput`
 *   ② 経路で考慮する災害                                  … `HazardPicker`
 *   ③ 地図に表示する災害の切替                            … `LayerPicker`
 *
 * ⚠️ **②と③は別物。** ②は経路の引き方（コストの掛け合わせ）、③は地図に何を重ねるか。
 * 混ぜると「地震を表示していないから経路も地震を見ていない」という誤読を生む。
 *
 * ⚠️ **経路はプリセットも探索も同じ形**（bundles.py の出力）で来る。
 * だから表示側（RouteTable / 地図への反映）は1本で済む。分岐させないこと。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BBox } from './adapters/types'
import { BottomSheet, useMobileLayout } from './components/BottomSheet'
import { HazardPicker, type HazardSelection } from './components/HazardPicker'
import { LayerPicker, type ShownHazard } from './components/LayerPicker'
import { PlaceInput } from './components/PlaceInput'
import { RouteTable } from './components/RouteTable'
import { DRAW_ORDER, INITIAL_ON, STYLE } from './constants'
import { inArea, useArea } from './hooks/useArea'
import { useBundle, usePresets } from './hooks/useBundle'
import { tileUrlOf, useHazards, vectorUrlOf } from './hooks/useHazards'
import { type Platform, useMapAdapter } from './hooks/useMapAdapter'
import { useSearch } from './hooks/useSearch'
import { useVector } from './hooks/useVector'
import { nearestSegment, routeBounds } from './lib/geo'
import type { Place } from './lib/gsi'
import type { RouteId } from './types'

const CENTER: [number, number] = [139.792, 35.733]
const EMPTY = { type: 'FeatureCollection' as const, features: [] }
// ⚠️ **maxzoom は「焼いてあるズーム」。拡大の上限ではない**（超えると overzoom）。
//    浸水データの格子は約10m。z15 で 3.9m/px なので、z16以降を焼いても
//    1セルを単色ブロックに引き伸ばすだけで情報が増えない（docs/dev/07 §2-7-0）。
//    ⚠️ prep/tile_render/render.py の ZOOMS と、app/services/hazards/catalog.py の
//    FLOOD_MAXZ と**揃えること**。ズレると404か、焼いたタイルが使われない
const FLOOD_ZOOM = { minzoom: 12, maxzoom: 15 }

type Mode = 'preset' | 'search'

export function EvacRouteMap({ platform = 'maplibre' }: { platform?: Platform }) {
  const { adapter, ready } = useMapAdapter(platform, 'map', CENTER, 13)
  const mobile = useMobileLayout()
  const { index, error: indexError } = usePresets()
  const { catalog, error: hazardError } = useHazards()
  const { area, error: areaError } = useArea()

  const [mode, setMode] = useState<Mode>('preset')
  const [od, setOd] = useState<string | null>(null)
  const [scenario, setScenario] = useState<string | null>(null)
  const [shown, setShown] = useState<Record<RouteId, boolean>>(INITIAL_ON)
  const [sheetOpen, setSheetOpen] = useState(false)

  // ① 2地点
  const [origin, setOrigin] = useState<Place | null>(null)
  const [dest, setDest] = useState<Place | null>(null)
  // ② 経路で考慮する災害。既定は推奨経路（浸水×地震）と同じ組み合わせ
  const [hazards, setHazards] = useState<HazardSelection>({})
  // ③ 地図に表示する災害
  const [layer, setLayer] = useState<ShownHazard>(null)
  const [opacity, setOpacity] = useState(0.7)

  const { bundle: presetBundle, error: presetError } = useBundle(
    mode === 'preset' ? od : null,
    scenario,
  )
  const search = useSearch()
  const bundle = mode === 'preset' ? presetBundle : search.bundle

  useEffect(() => {
    if (!index) return
    setOd((v) => v ?? index.default_od)
    setScenario((v) => v ?? index.default_scenario)
  }, [index])

  // 既定の表示は浸水。カタログが来てから決める（種別をハードコードしないため）
  useEffect(() => {
    if (!catalog || !scenario) return
    setLayer((v) => v ?? { id: 'flood', scenario })
    setHazards((v) => (Object.keys(v).length ? v : { flood: scenario, quake: 'total' }))
  }, [catalog, scenario])

  // 浸水シナリオを変えたら、②の variant と③の表示も追従させる。
  // ここがズレると「神田川のタイルを見ながら包絡で引いた経路」を見ることになる。
  // 探索済みの結果も**別の想定図で引いたもの**になるので捨てる（引き直してもらう）
  const clearSearch = search.clear
  useEffect(() => {
    if (!scenario) return
    setHazards((v) => ('flood' in v ? { ...v, flood: scenario } : v))
    setLayer((v) => (v?.id === 'flood' ? { id: 'flood', scenario } : v))
    clearSearch()
  }, [scenario, clearSearch])

  // 探索結果は「頼んだ経路」しか入っていない。⑤や minimax は既定OFFなので、
  // そのままだと**選んだ経路が消えたように見える**。来たものは必ず表示する
  const searched = search.bundle
  useEffect(() => {
    if (!searched) return
    setShown((s) => {
      const next = { ...s }
      for (const r of searched.routes) next[r.id] = true
      return next
    })
  }, [searched])

  // ---- 地図への反映。ここから下は state からの一方通行 ----

  // 対象エリアの枠
  useEffect(() => {
    const a = adapter.current
    if (!a || !ready || !area) return
    const [w, s, e, n] = area.bbox
    a.setAreaOutline([
      [w, s],
      [e, n],
    ] as BBox)
  }, [adapter, ready, area])

  // 経路。bundle が無いとき（探索前）は空で入れて、前の経路を消す
  // ⚠️ shown を依存に入れない。入れると表示を切り替えるたびに経路を投入し直し、
  //    fitBounds が走って地図が飛ぶ。表示の反映は次の effect の担当
  // biome-ignore lint/correctness/useExhaustiveDependencies: shown は意図的に外す
  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    a.setRoutes(bundle?.geojson ?? EMPTY, STYLE, DRAW_ORDER)
    if (!bundle) return
    a.onClick(({ lngLat, route }) => {
      const seg = nearestSegment(bundle, route, lngLat)
      if (!seg) return
      const r = bundle.routes.find((x) => x.id === route)
      const rank = seg.quake_rank == null ? '評価範囲外' : `ランク ${seg.quake_rank} / 5`
      a.showPopup(
        lngLat,
        `<div style="font-size:12px;line-height:1.65">
        <b>${seg.name ?? '（名称なし）'}</b>
        <span style="color:${STYLE[route].color}">　${r?.no} ${r?.label}</span><br>
        区間長 ${seg.length_m.toFixed(0)}m<br>
        最大浸水深 <b>${seg.depth_max.toFixed(2)}m</b>（平均 ${seg.depth_mean.toFixed(2)}m）<br>
        地震の地域危険度 <b>${rank}</b></div>`,
      )
    })
    const bb = routeBounds(bundle, shown)
    if (bb) {
      a.fitBounds(bb, {
        padding: mobile
          ? { top: 50, right: 24, bottom: 98, left: 24 }
          : { top: 60, right: 60, bottom: 60, left: 420 },
      })
    }
  }, [adapter, ready, bundle, mobile])

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready || !bundle) return
    for (const r of bundle.routes) a.setVisible(r.id, shown[r.id])
  }, [adapter, ready, bundle, shown])

  // ③ 表示する災害。**同時に出すのは1つ**なので、選ばれていない方は必ず消す
  const floodAdded = useRef(false)
  const floodUrl = layer?.id === 'flood' ? tileUrlOf(catalog, 'flood', layer.scenario) : null
  const quakeUrl = layer?.id === 'quake' ? vectorUrlOf(catalog, 'quake', layer.scenario) : null
  const { data: quakeData, loading: quakeLoading, error: quakeError } = useVector(quakeUrl)

  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    if (floodUrl) {
      // レイヤの追加は1回だけ。2回目以降はURLの差し替えで済む
      if (!floodAdded.current) {
        a.addRasterLayer('flood', floodUrl, { ...FLOOD_ZOOM, opacity })
        floodAdded.current = true
      } else {
        a.setRasterTiles('flood', floodUrl)
      }
      a.setLayerVisible('flood', true)
      a.setLayerOpacity('flood', opacity)
    } else if (floodAdded.current) {
      a.setLayerVisible('flood', false)
    }
  }, [adapter, ready, floodUrl, opacity])

  // ⚠️ **都内 5,192件を全部渡す（絞らない）。** 経路を引けるのは対象エリアの中だけだが、
  //    地域危険度は「この街がどのくらい危ないか」を見るための図なので、
  //    枠の外まで続いている方が読みやすい（本人の判断。2026-08-17）。
  //    Google版は Polygon を1枚ずつ置く作りなので件数がそのまま重さになる
  //    （docs/findings/地図基盤の比較.md §10-1）。重くなったらここで絞る。
  const quakeAdded = useRef(false)
  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    if (quakeData) {
      a.setVectorAreas('quake', quakeData, { opacity })
      quakeAdded.current = true
      a.setLayerVisible('quake', true)
      a.setLayerOpacity('quake', opacity)
    } else if (quakeAdded.current) {
      a.setLayerVisible('quake', false)
    }
  }, [adapter, ready, quakeData, opacity])

  // マーカー。探索モードでは、まだ引いていなくても選んだ2点を出す
  useEffect(() => {
    const a = adapter.current
    if (!a || !ready) return
    if (mode === 'search') {
      a.setMarkers(
        [origin, dest]
          .filter((p): p is Place => p != null)
          .map((p) => ({
            lngLat: [p.lon, p.lat] as [number, number],
            label: p.title,
          })),
      )
      return
    }
    a.setMarkers(
      bundle
        ? [bundle.od.origin, bundle.od.dest].map((p) => ({
            lngLat: [p.latlon[1], p.latlon[0]] as [number, number],
            label: p.display,
          }))
        : [],
    )
  }, [adapter, ready, mode, origin, dest, bundle])

  // ---- 探索 ----

  const canSearch = useMemo(() => {
    if (!origin || !dest || search.loading) return false
    return inArea(area, origin.lat, origin.lon) && inArea(area, dest.lat, dest.lon)
  }, [origin, dest, area, search.loading])

  function runSearch() {
    if (!origin || !dest) return
    void search.run({
      origin: { lat: origin.lat, lon: origin.lon, label: origin.title },
      dest: { lat: dest.lat, lon: dest.lon, label: dest.title },
      hazards,
      // minimax（下限）は二分探索でおよそ1秒かかる。まずは2本だけ出す
      include: ['baseline', 'selected'],
    })
  }

  function switchMode(m: Mode) {
    setMode(m)
    if (m === 'preset') search.clear()
  }

  function changeSheet(open: boolean) {
    setSheetOpen(open)
    if (open || !mobile || !bundle) return
    const a = adapter.current
    const bb = routeBounds(bundle, shown)
    if (a && bb) {
      a.fitBounds(bb, {
        padding: { top: 50, right: 24, bottom: 98, left: 24 },
        duration: 200,
      })
    }
  }

  const err = indexError ?? presetError ?? hazardError ?? areaError

  return (
    <>
      <div id="map" style={{ position: 'absolute', inset: 0 }} />
      <BottomSheet
        adapter={adapter}
        bundle={bundle}
        mobile={mobile}
        open={sheetOpen}
        onOpenChange={changeSheet}
      >
        <div className="w-[372px] rounded-lg border border-slate-300 bg-white/95 px-3.5 py-3 text-[13px] leading-normal shadow-[0_2px_10px_rgba(0,0,0,0.12)] max-[700px]:w-full max-[700px]:rounded-none max-[700px]:border-0 max-[700px]:border-t max-[700px]:shadow-none">
          <h1 className="mb-2 text-sm font-semibold">避難経路の比較</h1>
          {err && (
            <p className="text-[12px] text-red-700">
              APIを読めませんでした: {err}
              <br />
              <code className="rounded bg-slate-100 px-1">
                cd backend &amp;&amp; uvicorn app.main:app --port 8200
              </code>
            </p>
          )}

          <div className="mb-2 flex gap-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'preset'}
              className={`min-h-9 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-[12.5px] max-[700px]:min-h-11 ${mode === 'preset' ? 'bg-blue-600 border-blue-600 text-white font-semibold' : 'bg-slate-50 text-slate-700'}`}
              onClick={() => switchMode('preset')}
            >
              プリセット
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'search'}
              className={`min-h-9 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-[12.5px] max-[700px]:min-h-11 ${mode === 'search' ? 'bg-blue-600 border-blue-600 text-white font-semibold' : 'bg-slate-50 text-slate-700'}`}
              onClick={() => switchMode('search')}
            >
              地点を指定
            </button>
          </div>

          {mode === 'preset' && index && (
            <div className="mb-2">
              <label htmlFor="od" className="mt-1.5 mb-0.5 block text-[11px] text-slate-600">
                出発地 → 目的地
              </label>
              <select
                id="od"
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12.5px]"
                value={od ?? ''}
                onChange={(e) => setOd(e.target.value)}
              >
                {index.od.map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {o.display}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'search' && (
            <div className="mb-2">
              <PlaceInput
                id="from"
                label="出発地"
                value={origin}
                onChange={setOrigin}
                area={area}
                rejected={search.outside.includes('origin')}
              />
              <PlaceInput
                id="to"
                label="目的地"
                value={dest}
                onChange={setDest}
                area={area}
                rejected={search.outside.includes('dest')}
              />
              <HazardPicker
                catalog={catalog}
                value={hazards}
                onChange={setHazards}
                scenario={scenario ?? 'envelope'}
              />
              <button
                type="button"
                className="mt-2 min-h-11 w-full rounded-md bg-green-700 p-2.5 text-[13px] font-semibold text-white disabled:bg-slate-300"
                disabled={!canSearch}
                onClick={runSearch}
              >
                {search.loading ? '探索中…' : '経路を引く'}
              </button>
              {search.error && (
                <p className="mt-1 text-[11px] text-slate-600 text-[12px] text-red-700">
                  {search.error}
                </p>
              )}
              {area && !search.error && (
                <p className="mt-1 text-[11px] text-slate-600">{area.note}</p>
              )}
            </div>
          )}

          {index && (
            <div className="mb-2">
              <label htmlFor="sc" className="mt-1.5 mb-0.5 block text-[11px] text-slate-600">
                浸水シナリオ
              </label>
              <select
                id="sc"
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12.5px]"
                value={scenario ?? ''}
                onChange={(e) => setScenario(e.target.value)}
              >
                {index.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.display}
                  </option>
                ))}
              </select>
            </div>
          )}

          <LayerPicker
            catalog={catalog}
            value={layer}
            onChange={setLayer}
            opacity={opacity}
            onOpacity={setOpacity}
            fixed={scenario ? { flood: scenario } : {}}
          />
          {quakeLoading && (
            <p className="mt-1 text-[11px] text-slate-600">
              地震の地域危険度を読み込み中…（4.6MB）
            </p>
          )}
          {quakeError && (
            <p className="mt-1 text-[11px] text-slate-600 text-[12px] text-red-700">{quakeError}</p>
          )}

          {bundle && (
            <>
              <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                {bundle.scenario_note.replace(/\*\*/g, '')}
              </p>
              <RouteTable
                bundle={bundle}
                shown={shown}
                onToggle={(id, on) => setShown((s) => ({ ...s, [id]: on }))}
              />
            </>
          )}
          {mode === 'search' && !bundle && !search.loading && (
            <p className="mt-1 text-[11px] text-slate-600">
              2地点を選んで「経路を引く」を押してください。
            </p>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
