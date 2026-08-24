/** Google Maps 用アダプタ。
 *
 * `frontend/adapter_google.js`（素のHTML版）からの移植を起点にした実装。
 * 契約は ./types.ts。MapLibre版と対になっているので、片方だけ直さないこと。
 *
 * google.maps の型は入れていない（@types/google.maps を足すと Map ID など
 * 使っていない機能まで型が要求される）。境界だけ any にしてある。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadMapsScript, mapsApiKey, reportGoogleMapsUnavailable } from '../lib/google-maps'
import { metersPerPixel, offsetPath } from './route-offset'
import type {
  AreaClick,
  CalloutAnchor,
  CalloutSpec,
  LngLatTuple,
  MapAdapter,
  MapViewport,
  RouteClick,
  ShelterMarkerSpec,
} from './types'
import { viewportKey } from './viewport'

// Maps JS API は実行時に <script> で読み込む（@types は入れない方針）
declare const google: any

export function createGoogleAdapter(): MapAdapter {
  const MINZ_DEFAULT = 0,
    MAXZ_DEFAULT = 18
  // 論理ズーム（MapLibre基準）→ Google のズーム。**この +1 を共通側に漏らさない**
  const Z_SHIFT = 1

  // 要約の吹き出しをピンの上へ逃がす量(px)。
  // **マーカーの高さ（36px。地点に立つので上へ36px伸びる）＋余白**。
  // マーカーの大きさを変えたらここも変える（重なりが戻る）
  const CALLOUT_LIFT = 42
  // 上以外の向きに置くときの隙間(px)。ピンの幅は24pxなので半分より広く取る
  const CALLOUT_GAP = 16

  /** 地点を基準に、吹き出しの左上をどこへ置くか(px)。
   *
   * ⚠️ **上に置くときだけピンの高さぶん余分に逃がす。** ピンは地点から上へ
   * 伸びており、素直に上へ置くと必ず重なる（2026-08-23の指摘）。 */
  const CALLOUT_DELTA: Record<CalloutAnchor, (w: number, h: number) => [number, number]> = {
    top: (w, h) => [-w / 2, -h - CALLOUT_LIFT],
    'top-right': (_w, h) => [CALLOUT_GAP, -h - CALLOUT_GAP],
    'top-left': (w, h) => [-w - CALLOUT_GAP, -h - CALLOUT_GAP],
    bottom: (w) => [-w / 2, CALLOUT_GAP],
    'bottom-right': () => [CALLOUT_GAP, CALLOUT_GAP],
    'bottom-left': (w) => [-w - CALLOUT_GAP, CALLOUT_GAP],
    left: (w, h) => [-w - CALLOUT_GAP, -h / 2],
    right: (_w, h) => [CALLOUT_GAP, -h / 2],
  }

  /** 画面の縁からの最小の隙間(px)。
   *
   * ⚠️ **下だけ広く取る。** 地図の下端には Google のロゴ・「地図データ ©」・
   * 利用規約の帯と、その上にオープンデータの出典チップが重なっている。
   * **どちらも覆ってはいけない**ので、吹き出しはその上で止める
   * （実機で出典チップに重なった。2026-08-23） */
  const CALLOUT_MARGIN = { top: 8, right: 8, bottom: 64, left: 8 }

  const CALLOUT_STYLE = [
    'position:absolute',
    'background:#fff',
    'border:1px solid #e2e8f0',
    'border-radius:10px',
    'padding:7px 9px',
    'box-shadow:0 6px 18px rgb(15 23 42 / 22%)',
    // ⚠️ **クリックを吸わせない。** 吹き出しは読むだけのもので、下の経路や
    //    ピンを押せなくなると、区間タップも避難先の切り替えもできなくなる
    'pointer-events:none',
  ].join(';')

  /** 避難先の詳細。**DOM で組む**（HTML文字列のままだと中のボタンに
   * イベントを付けられない）。押されたら初めて `onGo` を呼ぶ。 */
  function openShelterInfo(m: ShelterMarkerSpec, marker: any) {
    if (!shelterInfo) {
      // ⚠️ **地図を動かして吹き出しを画面へ入れる（既定のまま）。** 端のピンを
      //    押したとき、動かさないと吹き出しが画面の外に出て読めない。
      //    ⚠️ 動くと `idle` → 表示範囲の通知 → ピンの作り直し、と回って以前は
      //    その場で閉じていた。いまは作り直したピンへ**開き直す**ので消えない
      //    （`setShelterMarkers` の `reopen`）
      shelterInfo = new google.maps.InfoWindow()
      shelterInfo.addListener('closeclick', () => {
        shelterInfoId = null
      })
    }
    shelterInfoId = m.id
    shelterInfo.setContent(shelterContent(m))
    shelterInfo.open(map, marker)
  }

  function shelterContent(m: ShelterMarkerSpec): HTMLElement {
    const el = document.createElement('div')
    if (m.detailHtml) {
      el.innerHTML = m.detailHtml
      const go = el.querySelector('[data-action="go"]')
      // ⚠️ 押したら閉じる。経路が引かれると同じ避難先の要約が別に出るので、
      //    詳細を残すと同じ施設の箱が2つ並ぶ
      if (go && m.onGo) {
        go.addEventListener('click', () => {
          shelterInfo?.close()
          shelterInfoId = null
          m.onGo?.()
        })
      }
    } else {
      el.textContent = m.label
    }
    return el
  }

  /** 要約の吹き出し1つ。**InfoWindow は使わない。**
   *
   * ⚠️ InfoWindow は必ず地点の上に出て、向きを選べない。経路が北から入って
   * くると線に重なる（2026-08-23の指摘）。上下左右へ置けるように自前で描く。 */
  function makeCallout(spec: CalloutSpec) {
    const overlay = new google.maps.OverlayView() as any
    let div: HTMLDivElement | null = null
    overlay.onAdd = function onAdd(this: any) {
      div = document.createElement('div')
      div.style.cssText = CALLOUT_STYLE
      div.innerHTML = spec.html
      // ⚠️ ×だけがクリックを受ける（`CALLOUT_STYLE` は pointer-events:none）
      const dismiss = div.querySelector('[data-action="dismiss"]')
      if (dismiss && spec.onDismiss) dismiss.addEventListener('click', spec.onDismiss)
      this.getPanes()?.floatPane?.appendChild(div)
      // ⚠️ **並べ終わってからもう一度置き直す。** 最初の `draw` の時点では
      //    まだ大きさが決まっておらず、画面の内側へ押し戻す計算が効かない
      //    （実機で下端が切れた）
      requestAnimationFrame(() => this.draw())
    }
    // ⚠️ **画面からはみ出さないところまで寄せる。** 地図を収めるときの余白
    //    （`calloutPadding`）だけでは、狭い画面で足りずに端が切れる
    //    （実機で左端が切れた。2026-08-23の指摘）。向きは保ったまま、
    //    最後に画面の内側へ押し戻す。
    overlay.draw = function draw(this: any) {
      const projection = this.getProjection()
      if (!div || !projection) return
      const latLng = new google.maps.LatLng(spec.lngLat[1], spec.lngLat[0])
      // div座標＝地図と一緒に動く層、container座標＝画面。**両方要る**。
      // 画面基準で押し戻し、その結果を div 座標へ戻す
      const inDiv = projection.fromLatLngToDivPixel(latLng)
      const inContainer = projection.fromLatLngToContainerPixel(latLng)
      if (!inDiv || !inContainer) return
      const w = div.offsetWidth
      const h = div.offsetHeight
      const [dx, dy] = CALLOUT_DELTA[spec.anchor](w, h)
      const view = { w: container?.clientWidth ?? 0, h: container?.clientHeight ?? 0 }
      // ⚠️ 押し戻す余地が無いとき（吹き出しより画面が狭い）はそのまま置く
      const clamp = (v: number, lo: number, hi: number) =>
        hi < lo ? v : Math.min(Math.max(v, lo), hi)
      const x = clamp(inContainer.x + dx, CALLOUT_MARGIN.left, view.w - w - CALLOUT_MARGIN.right)
      const y = clamp(inContainer.y + dy, CALLOUT_MARGIN.top, view.h - h - CALLOUT_MARGIN.bottom)
      div.style.left = `${x + (inDiv.x - inContainer.x)}px`
      div.style.top = `${y + (inDiv.y - inContainer.y)}px`
    }
    overlay.onRemove = function onRemove() {
      div?.remove()
      div = null
    }
    overlay.setMap(map)
    return overlay
  }

  let map: any = null
  let container: HTMLElement | null = null
  const quakePolys: any[] = [] // 地域危険度の町丁目（google.maps.Polygon）
  let areaRect: any = null // 対象エリアの枠（google.maps.Rectangle）
  let areaClickCb: ((e: AreaClick) => void) | null = null
  let flood: any = null
  let floodIndex = -1
  // ⚠️ **浸水の不透明度を地震のものと共有しない。** 以前は setLayerVisible が
  //    quakeOpacity で復帰させていて、片方だけ濃さを変えると巻き添えで戻った
  let floodOpacity = 1
  let infoWindow: any = null
  let shelterInfo: any = null // 避難先の詳細（**1つを使い回す**）
  let shelterInfoId: string | null = null // いま詳細を開いている施設
  let clickCb: ((e: RouteClick) => void) | null = null
  let longPressCb: ((lngLat: LngLatTuple) => void) | null = null
  let viewportChangeCb: ((viewport: MapViewport) => void) | null = null
  let viewportTimer: ReturnType<typeof setTimeout> | null = null
  let lastViewportKey: string | null = null
  let reserved = 0
  const markers: any[] = []
  const shelterMarkers: any[] = []
  const callouts: any[] = [] // 出しっぱなしの要約（自前の OverlayView）
  const layers: Record<string, any> = {} // routeId -> { casing, main, hit, style, z }
  let mapInited = false
  let resolveReady: (() => void) | null = null

  function viewport(): MapViewport | null {
    const bounds = map?.getBounds()
    const zoom = map?.getZoom()
    if (!bounds || typeof zoom !== 'number') return null
    const southwest = bounds.getSouthWest()
    const northeast = bounds.getNorthEast()
    return {
      bbox: [
        [southwest.lng(), southwest.lat()],
        [northeast.lng(), northeast.lat()],
      ],
      zoom: zoom - Z_SHIFT,
    }
  }

  function emitViewport(force = false) {
    const current = viewport()
    if (!current || !viewportChangeCb) return
    const key = viewportKey(current)
    if (!force && key === lastViewportKey) return
    lastViewportKey = key
    viewportChangeCb(current)
  }

  function queueViewport() {
    if (viewportTimer) clearTimeout(viewportTimer)
    viewportTimer = setTimeout(() => {
      viewportTimer = null
      emitViewport()
    }, 100)
  }
  // Googleはキー不正時に例外ではなくこのグローバル関数を呼ぶ。
  // 灰色の地図を残さず、Appへ伝えてMapLibreへ切り替える。
  ;(window as any).gm_authFailure = () => reportGoogleMapsUnavailable('auth')

  // ---- 浸水タイル ---------------------------------------------------------
  // MapLibre は source に minzoom/maxzoom を書くだけで、範囲外ズームの抑制・
  // 経度のラップ・maxzoom超過時の overzoom を全部やってくれる。Google には無いので自前。
  //
  // ⚠️ getTileUrl で「親タイルのURL」を返すだけでは overzoom にならない。
  // Google は返した画像をタイル枠いっぱいに描くため、z18 では親タイル全体が
  // 4つの子タイル枠それぞれに描かれ、模様が4回繰り返される。
  // getTile で DOM を返し、background-size / background-position で象限を切り出す。
  /** 浸水タイルのPNGに焼き込まれた不透明度（浸水色）。
   * 出所は `backend/prep/tile_render/render.py` の `ALPHA = 165`。 */
  const FLOOD_BAKED_ALPHA = 0.65
  /** 重ね塗りの上限。⚠️ 増やしすぎても下の道路が読めなくなるだけ */
  const FLOOD_MAX_PAINTS = 3

  /** 「見え方の強さ（0〜1）」から、重ねる枚数とCSSの不透明度を決める。
   *
   * ⚠️ **地震の面とスケールを揃えるための換算。** 地震は多角形の塗りなので
   * 指定した値がそのまま濃さになるが、浸水はPNGに 0.65 が焼かれている。
   * 同じ値を指定しても浸水のほうが薄くなるので、ここで吸収する
   * （ユーザー指摘、2026-08-24）。
   *   target <= 0.65 … 1枚 ＋ CSS不透明度で薄める
   *   target >  0.65 … 重ねて濃くし、行き過ぎたぶんをCSS不透明度で戻す */
  function paintPlan(target: number) {
    const t = Math.min(1, Math.max(0, target))
    let paints = 1
    while (paints < FLOOD_MAX_PAINTS && 1 - (1 - FLOOD_BAKED_ALPHA) ** paints < t) paints += 1
    const reachable = 1 - (1 - FLOOD_BAKED_ALPHA) ** paints
    return { paints, opacity: Math.min(1, t / reachable) }
  }
  // ⚠️ **タイルを広げて重ねない。** 2026-08-24に2回試して、どちらも外した:
  //   1. 背景の絵だけ広げる → 箱の外へは出ないので効果が無い
  //   2. 箱ごと広げる → 隙間は埋まるが、乗算で二重に色が乗って濃い格子が出る
  //   継ぎ目の原因は**小数ズーム**（タイルが端数pxに置かれる）だったので、
  //   そちらを切った（`isFractionalZoomEnabled: false`）。整数ズームなら
  //   タイルはちょうど並ぶので、ここで細工する必要は無い。

  function makeFloodType(url: string, minz: number, maxz: number, target: number) {
    const plan = paintPlan(target)
    const tpl = (z: number, x: number, y: number) =>
      url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    return new (class {
      tileSize: any
      maxZoom = 21
      name = '浸水深'
      _tiles = new Set<HTMLElement>()
      _opacity: number
      _minz?: number
      _maxz?: number
      _url?: string
      /** いま指定されている「見え方の強さ」。重ね枚数の決め直しに使う */
      _target?: number

      constructor() {
        this.tileSize = new google.maps.Size(256, 256)
        this._opacity = plan.opacity
      }
      getTile(coord: any, zoom: number, doc: Document) {
        const div = doc.createElement('div')
        // ⚠️ 256pxのままだと、隣の箱との間に端数pxの隙間ができる
        div.style.width = div.style.height = '256px'
        div.style.opacity = String(this._opacity)
        this._tiles.add(div)

        // ⚠️ ここの zoom はタイル座標のズームで、カメラのズーム(+Z_SHIFT)とは別物。
        // Googleのタイル格子は 256px の標準XYZそのままなので、ここでは補正しない
        const nz = 1 << zoom
        if (zoom < minz || coord.y < 0 || coord.y >= nz) return div // 空タイル

        let x = ((coord.x % nz) + nz) % nz // 経度方向のラップ
        let y = coord.y,
          z = zoom,
          shift = 0
        if (z > maxz) {
          shift = z - maxz
          z = maxz
          x >>= shift
          y >>= shift
        }

        const scale = 1 << shift // 親1枚が覆う子タイルの一辺の数
        const cx = (((coord.x % nz) + nz) % nz) % scale
        const cy = coord.y % scale

        // ⚠️ **同じ画像を重ねて塗る。** 浸水タイルは**PNG自体に不透明度が
        //    焼き込まれている**（浸水色 165/255、範囲外ハッチ 70/255。出所は
        //    `backend/prep/tile_render/render.py` の `ALPHA` と `HATCH_RGBA`）。
        //    レイヤの不透明度を1にしても地図の下地に負けて読めない
        //    （ユーザー指摘、2026-08-23）。n回重ねると 1-(1-a)^n まで濃くなる。
        //    ⚠️ タイルを焼き直したくない（R2の6千枚＋凡例の作り直しになる）ので、
        //    描画側で濃くする。**色そのものは変えていない。**
        const src = `url(${tpl(z, x, y)})`
        // ⚠️ 拡大したぶん、位置も同じ割合でずらす（ずらさないと絵が右下へ動く）
        const size = 256 * scale
        const shiftX = -(256 * cx)
        const shiftY = -(256 * cy)
        div.style.backgroundImage = Array(plan.paints).fill(src).join(', ')
        div.style.backgroundSize = Array(plan.paints).fill(`${size}px ${size}px`).join(', ')
        div.style.backgroundPosition = Array(plan.paints).fill(`${shiftX}px ${shiftY}px`).join(', ')
        div.style.imageRendering = 'pixelated' // 拡大時に補間でぼかさない
        // 標準色（国交省）は淡い黄・桃色で、色の付いた下地の上だと沈む。
        // ⚠️ 色相は動かさない（凡例の色見本と食い違う）。彩度だけ少し上げる
        div.style.filter = 'saturate(1.35)'
        // ⚠️ **乗算で重ねる。** 普通に重ねると濃くはなるが、下の道路と地名を
        //    塗りつぶしてしまい「どこの話か」が読めなくなる（実測）。乗算なら
        //    白い下地はしっかり色が乗り、道路や文字の暗い線は残る
        div.style.mixBlendMode = 'multiply'
        return div
      }
      releaseTile(div: any) {
        this._tiles.delete(div)
      }
      // ImageMapType.setOpacity 相当を自前で持つ（生成済みタイルを全部更新する）
      setOpacity(v: number) {
        this._opacity = v
        for (const d of this._tiles) d.style.opacity = String(v)
      }
    })()
  }

  // ---- 経路の線 -----------------------------------------------------------
  /** 破線。Google の Polyline/Data に dasharray は無く、シンボルの繰り返しで作る */
  function dashIcons(color: string, weight: number, dash: [number, number] | null) {
    const gap = dash?.[1] ? dash[1] : 1.5
    return [
      {
        icon: {
          path: 'M 0,-1 0,1',
          strokeColor: color,
          strokeOpacity: 1,
          strokeWeight: weight,
          scale: weight,
        },
        offset: '0',
        repeat: `${(weight * (1 + gap * 1.6)).toFixed(0)}px`,
      },
    ]
  }

  const toPath = (coords: number[][]) => coords.map(([lng, lat]) => ({ lat, lng }))

  // 面の塗り。色は Feature の color プロパティ（凡例と同じ値をバックが入れている）。
  // color を省くと**色だけ据え置き**で不透明度などを変えられる（setLayerOpacity 用）
  function areaStyle(opacity: number, color?: string) {
    return {
      ...(color ? { fillColor: color } : {}),
      fillOpacity: opacity,
      strokeColor: '#ffffff',
      strokeWeight: 0.4,
      strokeOpacity: opacity,
      clickable: true,
      // ⚠️ 経路より下に置く（経路は 10〜32 を使う。setRoutes 参照）。
      // 指定しないと面が経路を覆って線が見えなくなる
      zIndex: 1,
    }
  }

  // Data レイヤではなく Polyline を使う。経路は5本しかなく、ズームごとに
  // setPath でオフセットを引き直せるため（Data は addGeoJson のやり直しが要る）
  function polyline(path: any, opts: any, zIndex: number, clickable: boolean) {
    return new google.maps.Polyline({
      map,
      path,
      zIndex,
      clickable,
      ...opts,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    })
  }

  function mainOpts(s: any, width: number) {
    return s.dash
      ? { strokeOpacity: 0, icons: dashIcons(s.color, width, s.dash) }
      : { strokeColor: s.color, strokeWeight: width, strokeOpacity: 1 }
  }

  function currentMPerPx() {
    if (!map) return 2.4
    const c = map.getCenter()
    return metersPerPixel(map.getZoom(), c ? c.lat() : 35.73)
  }

  // ズームが変わったら、px指定のオフセットを今のスケールのメートルに直して引き直す。
  // これをしないと、引きの画で5本が1本に見える（MapLibre側は画面px基準なので起きない）
  let reoffsetQueued = false,
    lastMPerPx = 0
  function reoffset() {
    const m = currentMPerPx()
    if (Math.abs(m - lastMPerPx) < lastMPerPx * 0.02) return // 誤差なら触らない
    lastMPerPx = m
    for (const id in layers) {
      const L = layers[id]
      const path = toPath(offsetPath(L.coords, L.style.offset * m))
      for (const p of [L.casing, L.main, L.hit]) if (p) p.setPath(path)
    }
  }
  function queueReoffset() {
    if (reoffsetQueued) return
    reoffsetQueued = true
    requestAnimationFrame(() => {
      reoffsetQueued = false
      reoffset()
    })
  }

  return {
    name: 'google',

    init(containerId, { center, zoom }) {
      container =
        typeof containerId === 'string' ? document.getElementById(containerId) : containerId
      const ready = new Promise<void>((res) => {
        resolveReady = res
      })

      // キーは Vite の環境変数から。config.local.js は使わない
      const key = mapsApiKey()
      if (!key) {
        reportGoogleMapsUnavailable('missing-key')
        return ready
      }
      // スクリプトの読み込みは1回だけ（`lib/google-maps.ts` が見張る）。
      // 2枚目を入れると Maps の内部状態が壊れ、地図のDOMが空になる
      loadMapsScript(key)
        .then(() => {
          if (mapInited) return // callback の二重発火に対する保険
          mapInited = true
          map = new google.maps.Map(container, {
            center: { lat: center[1], lng: center[0] },
            zoom: zoom + Z_SHIFT, // ★ 1段ズレの吸収はここだけ
            mapTypeId: 'roadmap',
            scaleControl: true,
            streetViewControl: false,
            fullscreenControl: false,
            // ⚠️ **ベクタ地図の既定で右下に出るカメラ操作（傾き・回転）を消す。**
            // アプリ側の道具（現在地・レイヤー・凡例）と同じ場所に重なる
            // （ユーザー指摘、2026-08-23）。傾きと回転はこのアプリでは使わない
            cameraControl: false,
            clickableIcons: false,
            // 航空写真に切り替えられると浸水オーバーレイが読めなくなる。
            // PCでは指標パネルの下に隠れて押せてもいないので、出さない
            mapTypeControl: false,
            // ズームボタンは地理院版（MapLibreのNavigationControl）と同じ右上に置く
            zoomControl: true,
            zoomControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
            // ⚠️ **小数ズームは切る。** 許すとタイルが端数pxに置かれ、
            //    隣り合う浸水タイルの境目に線（隙間または二重塗り）が出る
            //    （ユーザー指摘、2026-08-24。実測で1px単位の隙間を確認）。
            //    代償として fitBounds が地理院版より1段引きになることがあるが、
            //    地図に格子状の線が出るほうが実害が大きい
            isFractionalZoomEnabled: false,
          })
          infoWindow = new google.maps.InfoWindow()
          map.addListener('zoom_changed', queueReoffset)
          map.addListener('bounds_changed', queueViewport)
          map.addListener('idle', () => {
            if (viewportTimer) clearTimeout(viewportTimer)
            viewportTimer = null
            emitViewport()
          })
          map.addListener('contextmenu', (event: any) => {
            if (event.latLng && longPressCb) {
              longPressCb([event.latLng.lng(), event.latLng.lat()])
            }
          })
          resolveReady?.()
        })
        // スクリプト取得・地図生成の失敗はアプリへ伝え、灰色のまま待たず
        // MapLibreへ切り替える。ローダー自身の失敗は固定メッセージ `script` で
        // 区別できる（その他は Maps SDK 初期化中の例外）。
        .then(undefined, (error) =>
          reportGoogleMapsUnavailable(
            error instanceof Error && error.message === 'script' ? 'script' : 'initialization',
            error,
          ),
        )

      return ready
    },

    addRasterLayer(_id, url, opts = {}) {
      const { minzoom = MINZ_DEFAULT, maxzoom = MAXZ_DEFAULT, opacity = 1 } = opts
      if (!map) return
      floodOpacity = opacity
      flood = makeFloodType(url, minzoom, maxzoom, opacity)
      floodIndex = map.overlayMapTypes.getLength()
      map.overlayMapTypes.push(flood)
      flood._minz = minzoom
      flood._maxz = maxzoom
      flood._url = url
      flood._target = opacity
    },

    // タイルURLは差し替えられないので、オーバーレイを作り直す
    setRasterTiles(_id, url) {
      if (!map || floodIndex < 0) return
      const target = flood._target ?? floodOpacity,
        minz = flood._minz,
        maxz = flood._maxz
      flood = makeFloodType(url, minz, maxz, target)
      flood._minz = minz
      flood._maxz = maxz
      flood._url = url
      flood._target = target
      map.overlayMapTypes.setAt(floodIndex, flood)
    },

    // v は「見え方の強さ（0〜1）」。⚠️ 地震と浸水で**同じ意味**にする
    setLayerOpacity(id, v) {
      if (id === 'quake') {
        for (const p of quakePolys) p.setOptions(areaStyle(v))
        return
      }
      floodOpacity = v
      if (!flood || !map) return
      // ⚠️ **重ねる枚数が変わるならタイルを作り直す。** 枚数は `getTile` が
      //    描くときに決まるので、既存のタイルのCSSを触るだけでは変わらない
      const before = paintPlan(flood._target ?? v)
      const after = paintPlan(v)
      flood._target = v
      if (before.paints !== after.paints && floodIndex >= 0) {
        const rebuilt = makeFloodType(flood._url, flood._minz, flood._maxz, v)
        rebuilt._minz = flood._minz
        rebuilt._maxz = flood._maxz
        rebuilt._url = flood._url
        rebuilt._target = v
        flood = rebuilt
        map.overlayMapTypes.setAt(floodIndex, flood)
        return
      }
      flood.setOpacity(after.opacity)
    },

    // 面のベクタレイヤ（地震の町丁目）。**Polygon を1枚ずつ置く。**
    //
    // ⚠️ **google.maps.Data は使えない。** Maps JS 3.65 では Data レイヤに
    //    フィーチャを入れても**何も描かれず**、map.js / main.js から
    //    `Uncaught TypeError: Cannot read properties of undefined` が飛ぶ。
    //    1件でも 221件でも 5,192件でも同じなので**件数の問題ではない**。
    //    同じ座標で google.maps.Polygon を置くと正常に描かれる（2026-08-17 実測）。
    //    詳細は docs/findings/地図基盤の比較.md。
    //
    // ⚠️ **件数がそのまま重さになる。** 都内全域は 5,192件（MultiPolygon を
    //    ばらすと 5,254枚）。いまはこれを全部置いている（本人の判断。全都を出す）。
    //    重くなったら**呼ぶ側で bbox に絞る**こと。アダプタ側では絞らない
    //    （どこを見せたいかは表示側の判断で、地図基盤の都合ではないため）。
    setVectorAreas(_id, geojson: any, { opacity = 0.55, colorProperty = 'color' } = {}) {
      if (!map) return
      for (const p of quakePolys) p.setMap(null)
      quakePolys.length = 0

      for (const f of geojson?.features ?? []) {
        const g = f.geometry
        if (!g) continue
        // Polygon は [外周, 穴...]、MultiPolygon はその配列。
        // Google の paths は「2本目以降が穴」なので、Polygon 1つ = paths 1組で渡す
        const rings: number[][][][] =
          g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []
        for (const poly of rings) {
          const p = new google.maps.Polygon({
            map,
            paths: poly.map((ring) => toPath(ring)),
            ...areaStyle(opacity, f.properties?.[colorProperty]),
          })
          p.addListener('click', (e: any) => {
            if (areaClickCb)
              areaClickCb({
                lngLat: [e.latLng.lng(), e.latLng.lat()],
                properties: f.properties ?? {},
              })
          })
          quakePolys.push(p)
        }
      }
    },

    setLayerVisible(id, on) {
      if (id === 'quake') {
        for (const p of quakePolys) p.setVisible(on)
        return
      }
      if (id === 'flood' && flood) flood.setOpacity(on ? floodOpacity : 0)
    },

    // 対象エリアの枠。Rectangle は塗りを消せる（fillOpacity 0）ので線だけにする
    setAreaOutline(bbox) {
      if (!map) return
      if (!bbox) {
        if (areaRect) {
          areaRect.setMap(null)
          areaRect = null
        }
        return
      }
      const [[w, s], [e, n]] = bbox
      const bounds = { west: w, south: s, east: e, north: n }
      if (areaRect) {
        areaRect.setBounds(bounds)
        return
      }
      areaRect = new google.maps.Rectangle({
        map,
        bounds,
        clickable: false,
        fillOpacity: 0,
        strokeColor: '#334155',
        strokeOpacity: 0.55,
        strokeWeight: 1.5,
        // 経路より下に置く。Google は zIndex で決まる（Polyline は 10〜 を使っている）
        zIndex: 1,
      })
    },

    onAreaClick(cb) {
      areaClickCb = cb
    },

    // 経路は kind:"route" の線だけを置く。区間（kind:"segment"）は数百本あり、
    // 1本ずつ Polyline にすると重い。区間の特定は app.js が座標から行う
    setRoutes(geojson: any, styleMap: any, drawOrder: any) {
      if (!map) return
      for (const k in layers) {
        for (const p of [layers[k].casing, layers[k].main, layers[k].hit]) {
          if (p) p.setMap(null)
        }
        delete layers[k]
      }
      const byRoute: Record<string, any> = {}
      for (const f of geojson.features) {
        if (f.properties.kind !== 'route') continue
        byRoute[f.properties.route] = f
      }

      drawOrder.forEach((id: string, i: number) => {
        const f = byRoute[id]
        if (!f) return
        const s = styleMap[id]
        const z = 10 + i * 10
        const coords = f.geometry.coordinates
        const path = toPath(offsetPath(coords, s.offset * currentMPerPx()))

        const L: any = { style: s, z, coords, on: true, width: s.width }
        if (s.casing) {
          L.casing = polyline(
            path,
            { strokeColor: '#ffffff', strokeWeight: s.width + 3.5, strokeOpacity: 0.9 },
            z,
            false,
          )
        }
        L.main = polyline(path, mainOpts(s, s.width), z + 1, false)
        // 当たり判定。指で押せる幅を確保する。zIndex を線より上に置くので、
        // 重なった区間では drawOrder の後ろ（最前面）の経路が拾われる
        L.hit = polyline(
          path,
          { strokeColor: s.color, strokeWeight: 18, strokeOpacity: 0.01 },
          z + 2,
          true,
        )
        L.hit.addListener('click', (e: any) => {
          if (clickCb)
            clickCb({ lngLat: [e.latLng.lng(), e.latLng.lat()], route: id as RouteClick['route'] })
        })
        layers[id] = L
      })
      reoffset()
    },

    setVisible(routeId, on) {
      const L = layers[routeId]
      if (!L) return
      L.on = on
      for (const p of [L.casing, L.main, L.hit]) if (p) p.setOptions({ visible: on })
    },

    setLineWidth(routeId, w) {
      const L = layers[routeId]
      if (!L?.main) return
      L.width = w
      L.main.setOptions(mainOpts(L.style, w))
      if (L.casing) L.casing.setOptions({ strokeWeight: w + 3.5 })
    },

    setMarkers(list) {
      if (!map) return
      while (markers.length) markers.pop().setMap(null)
      for (const m of list) {
        const color = m.role === 'destination' ? '#dc2626' : '#2563eb'
        const svg = encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="white"/></svg>`,
        )
        const mk = new google.maps.Marker({
          position: { lat: m.lngLat[1], lng: m.lngLat[0] },
          map,
          title: m.label,
          icon: { url: `data:image/svg+xml,${svg}`, scaledSize: new google.maps.Size(24, 36) },
        })
        const iw = new google.maps.InfoWindow({ content: m.label })
        mk.addListener('click', () => {
          iw.open(map, mk)
          m.onClick?.()
        })
        markers.push(mk)
      }
    },

    // 避難先のピン。**押しても経路探索は始めない**（まず詳細を見せる）。
    //
    // ⚠️ 吹き出しは**1つを使い回す**。マーカーごとに持たせると、押した数だけ
    //    開きっぱなしになり、地図が読めなくなる（以前は押した瞬間に画面が
    //    切り替わっていたので問題にならなかった）。
    setShelterMarkers(list: ShelterMarkerSpec[]) {
      if (!map) return
      // ⚠️ **開いている詳細を勝手に閉じない。** 地図を少し動かすたびにここへ来る。
      //    まだ視界にいる施設なら、作り直したピンへ開き直す
      const reopen = list.find((m) => m.id === shelterInfoId)
      if (!reopen) {
        shelterInfo?.close()
        shelterInfoId = null
      }
      while (shelterMarkers.length) shelterMarkers.pop().setMap(null)
      for (const m of list) {
        const color = m.shelterType === 'urgent' ? '#16a34a' : '#ca8a04'
        const svg = encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="white"/></svg>`,
        )
        const mk = new google.maps.Marker({
          position: { lat: m.lngLat[1], lng: m.lngLat[0] },
          map,
          title: m.label,
          icon: { url: `data:image/svg+xml,${svg}`, scaledSize: new google.maps.Size(24, 36) },
        })
        mk.addListener('click', () => {
          openShelterInfo(m, mk)
          m.onShow?.()
        })
        if (m.id === shelterInfoId) openShelterInfo(m, mk)
        shelterMarkers.push(mk)
      }
    },

    showPopup(lngLat, html) {
      if (!infoWindow) return
      infoWindow.setContent(html)
      infoWindow.setPosition({ lat: lngLat[1], lng: lngLat[0] })
      infoWindow.open(map)
    },

    // 出しっぱなしの要約。渡し直すたびに全部作り直す（マーカーと同じ扱い）
    setCallouts(list: CalloutSpec[]) {
      if (!map) return
      while (callouts.length) callouts.pop().setMap(null)
      for (const c of list) callouts.push(makeCallout(c))
    },

    onClick(cb) {
      clickCb = cb
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

    // Google の fitBounds に duration は無い（常に即時）。共通側の値は無視する
    fitBounds([[w, s], [e, n]], { padding }: any = {}) {
      if (!map) return
      const b = new google.maps.LatLngBounds(
        new google.maps.LatLng(s, w),
        new google.maps.LatLng(n, e),
      )
      const p: any = { ...padding }
      // 地図コンテナ自体を持ち上げてある分は余白から引く（二重に確保しない）
      p.bottom = Math.max(8, (p.bottom || 0) - reserved)
      map.fitBounds(b, p)
      queueReoffset() // ズームが動くのでオフセットを引き直す
    },
    flyTo([lng, lat], zoom) {
      if (!map) return
      map.panTo({ lat, lng })
      if (zoom !== undefined) map.setZoom(zoom + Z_SHIFT)
    },

    lockGestures(on) {
      if (!map) return
      map.setOptions({ gestureHandling: on ? 'none' : 'auto' })
    },

    // Googleのロゴ・「地図データ ©」・「利用規約」は地図の中に描かれ、消せない。
    // 規約上これを覆ってはいけないので、地図コンテナの下端そのものを持ち上げる。
    // （シートを開いている間は覆うが、既定の折りたたみ状態では必ず見える）
    reserveBottom(px) {
      reserved = px
      if (container) container.style.bottom = `${px}px`
      if (map) google.maps.event.trigger(map, 'resize')
    },

    size() {
      const el = container || document.body
      return { w: el.clientWidth, h: el.clientHeight }
    },
  }
}
