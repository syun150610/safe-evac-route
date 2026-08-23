/** MapLibre GL（地理院タイル）用アダプタ。
 *
 * `frontend/adapter_maplibre.js`（素のHTML版）からの移植。**ロジックは変えていない。**
 * 契約は ./types.ts。Google版と対になっているので、片方だけ直さないこと。
 */
// maplibre-gl は名前付き export（default は無い）

import type { Feature, FeatureCollection } from 'geojson'
import {
  type GeoJSONSource,
  type MapMouseEvent,
  Marker,
  Map as MlMap,
  NavigationControl,
  Popup,
  type RasterTileSource,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl'
// ⚠️ Vite に「これは Worker だ」と教えて束ねさせる（`?worker&url`）。理由は下の setWorkerUrl
import mlWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import type { RouteStyle } from '../constants'
import type { RouteId } from '../types'
import type {
  AreaClick,
  BBox,
  CalloutSpec,
  LngLatTuple,
  MapAdapter,
  MapViewport,
  MarkerSpec,
  Padding,
  RasterOptions,
  RouteClick,
  ShelterMarkerSpec,
} from './types'
import { viewportKey } from './viewport'

// ⚠️ **これが無いと経路の線が1本も描かれない。** maplibre-gl v6 は Worker を本体とは
//    別ファイル（dist/maplibre-gl-worker.mjs）に分け、既定では `import.meta.url` からの
//    相対で取りに行く。Vite はこのファイルを一緒に置いてくれないので 404 になる:
//      dev   → /node_modules/.vite/deps/maplibre-gl-worker.mjs（事前バンドル先に無い）
//      build → /assets/maplibre-gl-worker.mjs（静的解析に掛からないので出力されない）
//    Worker が黙って死ぬと **GeoJSON ソースだけが読み込み待ちのまま止まる**。
//    ラスタタイル・マーカー・fitBounds は主スレッドなので動いてしまい、地図は
//    正常に見える。`getSource("demo").loaded()` が false のままなのが唯一の手掛かり
//    （v4.7 の素のHTML版はWorkerを本体に同梱していたので、この問題は起きない）。
setWorkerUrl(mlWorkerUrl)

const GSI_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'

/** 要約の吹き出しをピンの上へ逃がす量(px)。MapLibre の既定マーカーは高さ41px */
const CALLOUT_LIFT = 46

/** シートを掴んでいる間だけ切るジェスチャ。切ったものだけを元に戻す */
const GESTURES = [
  'dragPan',
  'dragRotate',
  'touchZoomRotate',
  'touchPitch',
  'scrollZoom',
  'doubleClickZoom',
] as const

type Handler = { isEnabled(): boolean; disable(): void; enable(): void }

export function createMapLibreAdapter(): MapAdapter {
  let map!: MlMap
  let popup!: Popup
  let clickCb: ((e: RouteClick) => void) | null = null
  let areaClickCb: ((e: AreaClick) => void) | null = null
  let longPressCb: ((lngLat: LngLatTuple) => void) | null = null
  let viewportChangeCb: ((viewport: MapViewport) => void) | null = null
  let lastViewportKey: string | null = null
  let locked: string[] | null = null
  const markers: Marker[] = []
  const shelterMarkers: Marker[] = []
  const callouts: Popup[] = [] // 出しっぱなしの要約

  const handler = (n: string) => (map as unknown as Record<string, Handler>)[n]

  function viewport(): MapViewport {
    const bounds = map.getBounds()
    return {
      bbox: [
        [bounds.getWest(), bounds.getSouth()],
        [bounds.getEast(), bounds.getNorth()],
      ],
      zoom: map.getZoom(),
    }
  }

  function emitViewport(force = false) {
    if (!viewportChangeCb) return
    const current = viewport()
    const key = viewportKey(current)
    if (!force && key === lastViewportKey) return
    lastViewportKey = key
    viewportChangeCb(current)
  }

  /** ハザードの面は**経路より下**に入れる。返り値を addLayer の第2引数に渡す。
   *
   * 素のHTML版は「タイル → 経路」の順で必ず呼ばれるので順番を気にしなくてよかったが、
   * React版はタイルURLを別のAPI（/api/hazards）から取るため、どちらが先に届くか決まらない。
   * 後から載せると経路が塗り潰される。まだ経路が無ければ undefined（＝最前面）でよい。 */
  const belowRoutes = () =>
    map.getStyle().layers.find((l: { id: string }) => /^(casing|route|hit)-/.test(l.id))?.id

  return {
    name: 'maplibre',

    init(container, { center, zoom }) {
      map = new MlMap({
        container: container as string,
        style: {
          version: 8,
          sources: {
            gsi: {
              type: 'raster',
              tiles: [GSI_TILES],
              tileSize: 256,
              maxzoom: 18,
              attribution: '地理院タイル',
            },
          },
          layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
        },
        center,
        zoom,
      })
      map.addControl(new NavigationControl(), 'top-right')
      map.addControl(new ScaleControl({}))
      popup = new Popup({ closeButton: false })
      map.on('moveend', () => emitViewport())

      const canvas = map.getCanvas()
      let longPressTimer: ReturnType<typeof setTimeout> | null = null
      let pointerStart: { x: number; y: number } | null = null
      const cancelLongPress = () => {
        if (longPressTimer) clearTimeout(longPressTimer)
        longPressTimer = null
        pointerStart = null
      }
      canvas.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0) return
        pointerStart = { x: event.clientX, y: event.clientY }
        longPressTimer = setTimeout(() => {
          if (!pointerStart || !longPressCb) return
          const rect = canvas.getBoundingClientRect()
          const point = map.unproject([pointerStart.x - rect.left, pointerStart.y - rect.top])
          longPressCb([point.lng, point.lat])
          cancelLongPress()
        }, 650)
      })
      canvas.addEventListener('pointermove', (event) => {
        if (
          pointerStart &&
          Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8
        ) {
          cancelLongPress()
        }
      })
      canvas.addEventListener('pointerup', cancelLongPress)
      canvas.addEventListener('pointercancel', cancelLongPress)
      canvas.addEventListener('pointerleave', cancelLongPress)

      // ⚠️ 準備完了をイベントで取らない。2通り試して2回とも外している:
      //    ・load は発火しない（タイル取得が終わらないと来ない。loaded() も false のまま）
      //    ・styledata は「スタイルは来たがソース未完」の瞬間に飛ぶので、逃すと二度と来ない
      //      （isStyleLoaded() は内部でソース完了も見ている）
      //    レイヤ追加に要るのは isStyleLoaded() だけなので、短い間隔で確認する。
      return new Promise<void>((res) => {
        if (map.isStyleLoaded()) return res()
        const t0 = Date.now()
        const t = setInterval(() => {
          if (!map.isStyleLoaded() && Date.now() - t0 < 15000) return
          clearInterval(t)
          if (!map.isStyleLoaded()) console.warn('[map] スタイル未完のまま続行する')
          res()
        }, 50)
      })
    },

    // MapLibre は source に minzoom/maxzoom を書くだけで、範囲外ズームの抑制・
    // 経度のラップ・maxzoom超過時の overzoom を全部やってくれる（Google側は自前実装）
    addRasterLayer(id, url, opts: RasterOptions = {}) {
      const { minzoom = 0, maxzoom = 18, opacity = 1, attribution } = opts
      map.addSource(id, {
        type: 'raster',
        tiles: [url],
        tileSize: 256,
        minzoom,
        maxzoom,
        attribution,
      })
      map.addLayer(
        {
          id,
          type: 'raster',
          source: id,
          paint: {
            'raster-opacity': opacity,
            // ⚠️ **maxzoom を超えたら拡大表示になる。既定の補間だとブロックがぼやける。**
            //    浸水データの格子は約10mで、タイルは z15（3.9m/px）までしか焼いていない
            //    （z16以降は情報が増えないため。docs/dev/07 §2-7-0）。
            //    元が単色ブロックなので、補間せず引き伸ばす方が正しく見える。
            //    Google側は getTile が `image-rendering: pixelated` で同じことをしている
            'raster-resampling': 'nearest',
          },
        },
        belowRoutes(),
      )
    },

    setRasterTiles(id, url) {
      const src = map.getSource(id) as RasterTileSource | undefined
      if (src?.setTiles) src.setTiles([url])
    },

    // 面のベクタレイヤ。地震の地域危険度は町丁目ポリゴンなので、
    // ラスタに焼かずにこれで描く（境界がシャープに出る・クリックできる）
    setVectorAreas(id, geojson, { opacity = 0.55, colorProperty = 'color' } = {}) {
      const existing = map.getSource(id) as GeoJSONSource | undefined
      if (existing) {
        existing.setData(geojson as FeatureCollection)
        return
      }
      map.addSource(id, { type: 'geojson', data: geojson as FeatureCollection })
      // ⚠️ **経路より下に入れる。** 指定しないと最前面に載って経路が隠れる
      const below = belowRoutes()
      map.addLayer(
        {
          id,
          type: 'fill',
          source: id,
          paint: { 'fill-color': ['get', colorProperty], 'fill-opacity': opacity },
        },
        below,
      )
      map.addLayer(
        {
          id: `${id}-line`,
          type: 'line',
          source: id,
          paint: { 'line-color': '#ffffff', 'line-width': 0.4, 'line-opacity': opacity },
        },
        below,
      )
      map.on('mouseenter', id, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', id, () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('click', id, (e: MapMouseEvent & { features?: Feature[] }) => {
        const f = e.features?.[0]
        if (!areaClickCb || !f) return
        areaClickCb({
          lngLat: [e.lngLat.lng, e.lngLat.lat],
          properties: f.properties as Record<string, unknown>,
        })
      })
    },

    setLayerOpacity(id, v) {
      const layer = map.getLayer(id)
      if (!layer) return
      // ラスタとベクタで不透明度のプロパティ名が違う
      if (layer.type === 'raster') map.setPaintProperty(id, 'raster-opacity', v)
      else if (layer.type === 'fill') {
        map.setPaintProperty(id, 'fill-opacity', v)
        if (map.getLayer(`${id}-line`)) map.setPaintProperty(`${id}-line`, 'line-opacity', v)
      }
    },

    setLayerVisible(id, on) {
      for (const l of [id, `${id}-line`]) {
        if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none')
      }
    },

    // 対象エリアの枠。塗らずに線だけにする（下のタイルと経路を隠さない）
    setAreaOutline(bbox) {
      const id = 'area-outline'
      if (!bbox) {
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(id)) map.removeSource(id)
        return
      }
      const [[w, s], [e, n]] = bbox
      const data: FeatureCollection = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [w, s],
                [e, s],
                [e, n],
                [w, n],
                [w, s],
              ],
            },
          },
        ],
      }
      const src = map.getSource(id) as GeoJSONSource | undefined
      if (src) {
        src.setData(data)
        return
      }
      map.addSource(id, { type: 'geojson', data })
      map.addLayer(
        {
          id,
          type: 'line',
          source: id,
          paint: {
            'line-color': '#334155',
            'line-width': 1.5,
            'line-opacity': 0.55,
            'line-dasharray': [3, 2],
          },
        },
        belowRoutes(),
      )
    },

    // 経路は1つの geojson ソースにまとめ、レイヤ側の filter で振り分ける。
    // 5本 × 数百区間を個別の線にすると重いので、ここは1ソース方式のまま
    setRoutes(geojson, styleMap: Record<RouteId, RouteStyle>, drawOrder: RouteId[]) {
      const src = map.getSource('demo') as GeoJSONSource | undefined
      if (src) {
        src.setData(geojson as FeatureCollection)
        return
      }
      map.addSource('demo', { type: 'geojson', data: geojson as FeatureCollection })

      const isRoute = (id: RouteId) => [
        'all',
        ['==', ['get', 'kind'], 'route'],
        ['==', ['get', 'route'], id],
      ]

      for (const id of drawOrder) {
        const s = styleMap[id]
        if (s.casing) {
          map.addLayer({
            id: `casing-${id}`,
            type: 'line',
            source: 'demo',
            filter: isRoute(id) as never,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#ffffff',
              'line-width': s.width + 3.5,
              'line-opacity': 0.9,
              'line-offset': s.offset,
            },
          })
        }
        map.addLayer({
          id: `route-${id}`,
          type: 'line',
          source: 'demo',
          filter: isRoute(id) as never,
          layout: { 'line-cap': s.dash ? 'butt' : 'round', 'line-join': 'round' },
          paint: {
            'line-color': s.color,
            'line-width': s.width,
            'line-offset': s.offset,
            ...(s.dash ? { 'line-dasharray': s.dash } : {}),
          },
        })
        // 当たり判定用。指で押せる幅を確保するため、描画とは別に太い透明線を敷く
        map.addLayer({
          id: `hit-${id}`,
          type: 'line',
          source: 'demo',
          filter: isRoute(id) as never,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': s.color,
            'line-width': 18,
            'line-opacity': 0.01,
            'line-offset': s.offset,
          },
        })
        map.on('mouseenter', `hit-${id}`, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', `hit-${id}`, () => {
          map.getCanvas().style.cursor = ''
        })
      }

      // クリックは1箇所で受ける。経路は重なっているので、レイヤごとに待つと
      // 同じ地点で複数の吹き出しが積み重なる。最前面（drawOrder の後ろ）を1つだけ返す
      map.on('click', (e: MapMouseEvent) => {
        if (!clickCb) return
        const layers = drawOrder
          .map((id) => `hit-${id}`)
          .filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none')
        const hits = map.queryRenderedFeatures(e.point, { layers })
        if (!hits.length) return
        const top = hits.reduce((a: (typeof hits)[number], b: (typeof hits)[number]) =>
          drawOrder.indexOf(b.properties.route as RouteId) >
          drawOrder.indexOf(a.properties.route as RouteId)
            ? b
            : a,
        )
        clickCb({ lngLat: [e.lngLat.lng, e.lngLat.lat], route: top.properties.route as RouteId })
      })
    },

    setVisible(routeId, on) {
      for (const p of ['casing', 'route', 'hit']) {
        const id = `${p}-${routeId}`
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
      }
    },

    setLineWidth(routeId, w) {
      if (map.getLayer(`route-${routeId}`)) {
        map.setPaintProperty(`route-${routeId}`, 'line-width', w)
      }
    },

    setMarkers(list: MarkerSpec[]) {
      for (const m of markers) m.remove()
      markers.length = 0
      for (const m of list) {
        markers.push(
          new Marker({ color: m.role === 'destination' ? '#dc2626' : '#2563eb' })
            .setLngLat(m.lngLat)
            .setPopup(new Popup().setText(m.label))
            .addTo(map),
        )
      }
    },

    setShelterMarkers(list: ShelterMarkerSpec[]) {
      for (const m of shelterMarkers) m.remove()
      shelterMarkers.length = 0
      for (const m of list) {
        const color = m.shelterType === 'urgent' ? '#16a34a' : '#ca8a04'
        const marker = new Marker({ color })
          .setLngLat(m.lngLat)
          .setPopup(new Popup().setText(m.label))
          .addTo(map)
        if (m.onClick) marker.getElement().addEventListener('click', m.onClick)
        shelterMarkers.push(marker)
      }
    },

    showPopup(lngLat: LngLatTuple, html: string) {
      popup.setLngLat(lngLat).setHTML(html).addTo(map)
    },

    // 出しっぱなしの要約。**共用の `popup` は使わない**（区間タップ用で、
    // 内容を上書きし合う）。
    //
    // ⚠️ `closeOnClick` を切る。既定では地図を1回押すだけで全部消え、
    //    利用者は消えた理由も戻し方も分からない。
    // ⚠️ `focusAfterOpen` を切る。開くたびにフォーカスが吹き出しへ飛び、
    //    シートの操作位置を見失う。
    setCallouts(list: CalloutSpec[]) {
      for (const p of callouts) p.remove()
      callouts.length = 0
      for (const c of list) {
        callouts.push(
          new Popup({
            closeButton: false,
            closeOnClick: false,
            focusAfterOpen: false,
            maxWidth: '220px',
            // ⚠️ ピンの高さぶん持ち上げる。既定では同じ地点に立つマーカーを覆う
            offset: [0, -CALLOUT_LIFT],
          })
            .setLngLat(c.lngLat)
            .setHTML(c.html)
            .addTo(map),
        )
      }
    },

    onClick(cb) {
      clickCb = cb
    },
    onAreaClick(cb) {
      areaClickCb = cb
    },
    onLongPress(cb) {
      longPressCb = cb
    },
    onViewportChange(cb) {
      viewportChangeCb = cb
      emitViewport(true)
      return () => {
        if (viewportChangeCb === cb) viewportChangeCb = null
      }
    },

    fitBounds(
      bbox: BBox,
      { padding, duration = 0 }: { padding?: Padding; duration?: number } = {},
    ) {
      map.fitBounds(bbox, { padding, duration })
    },
    flyTo(lngLat, zoom) {
      map.flyTo({ center: lngLat, ...(zoom === undefined ? {} : { zoom }), duration: 500 })
    },

    // シートを掴んでいる間は地図を動かさない。つまみがイベントを受け止めるのに
    // 加えて、地図側のハンドラも明示的に切る（掴んだつもりで地図が動くのが最悪）
    lockGestures(on) {
      if (on) {
        if (locked) return
        locked = GESTURES.filter((h) => handler(h)?.isEnabled())
        for (const h of locked) handler(h).disable()
      } else {
        if (!locked) return
        for (const h of locked) handler(h).enable()
        locked = null
      }
    },

    // MapLibre の帰属表示はコンテナ内の絶対配置なので、CSS変数で持ち上げる。
    // 地図の描画領域は全画面のままでよい（シートは上に重なる）
    reserveBottom(px) {
      document.documentElement.style.setProperty('--sheet-peek', `${px}px`)
    },

    size() {
      const el = map.getContainer()
      return { w: el.clientWidth, h: el.clientHeight }
    },
  }
}
