/** Google アダプタの単体テスト（`test_adapter_google.html` の36項目を vitest に移植）。
 *
 * google.maps を最小限だけ差し替えて、**アダプタ自身の計算**を確かめる:
 * ズームの1段ズレ / overzoom の象限切り出し / 経度のラップ / タイル差し替え /
 * レイヤ構成 / ズーム追従オフセット / クリック契約 / 余白の相殺。
 *
 * 実際の描画は確かめられない（それは実キーでの目視確認）。
 * **キー不要・無課金**で走るので、移植や改修の回帰テストとして先に流すとよい。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteStyle } from '../constants'
import type { RouteId } from '../types'
import { createGoogleAdapter } from './google'

interface Created {
  lines: FakePolyline[]
  markers: { o: Record<string, unknown> }[]
  mapOpts: Record<string, unknown> | null
  overlays: FloodType[]
}

interface FloodType {
  getTile(coord: { x: number; y: number }, zoom: number, doc: Document): HTMLElement
  setOpacity(v: number): void
  _opacity: number
}

class FakePolyline {
  o: Record<string, any>
  listeners: Record<string, (e: unknown) => void> = {}
  constructor(o: Record<string, unknown>) {
    this.o = { ...o }
    created.lines.push(this)
  }
  setOptions(o: Record<string, unknown>) {
    Object.assign(this.o, o)
  }
  setPath(p: unknown) {
    this.o.path = p
  }
  addListener(ev: string, cb: (e: unknown) => void) {
    this.listeners[ev] = cb
  }
  setMap(m: unknown) {
    this.o.map = m
  }
}

let created: Created
let fakeMap: any

function installStub() {
  created = { lines: [], markers: [], mapOpts: null, overlays: [] }
  class FakeMap {
    el: HTMLElement
    fits: { b: any; p: any }[] = []
    opts: Record<string, unknown> = {}
    listeners: Record<string, (event?: any) => void> = {}
    _zoom: number
    _bounds: any
    overlayMapTypes: {
      getLength(): number
      push(v: FloodType): void
      setAt(i: number, v: FloodType): void
    }
    constructor(el: HTMLElement, o: Record<string, unknown>) {
      this.el = el
      created.mapOpts = o
      this._zoom = o.zoom as number
      this._bounds = {
        getSouthWest: () => ({ lat: () => 35.68, lng: () => 139.72 }),
        getNorthEast: () => ({ lat: () => 35.78, lng: () => 139.86 }),
      }
      this.overlayMapTypes = {
        getLength: () => created.overlays.length,
        push: (v) => {
          created.overlays.push(v)
        },
        setAt: (i, v) => {
          created.overlays[i] = v
        },
      }
    }
    fitBounds(b: unknown, p: unknown) {
      this.fits.push({ b, p })
    }
    addListener(event: string, callback: (event?: any) => void) {
      this.listeners[event] = callback
    }
    getZoom() {
      return this._zoom
    }
    getBounds() {
      return this._bounds
    }
    getCenter() {
      return { lat: () => 35.73 }
    }
    setOptions(o: Record<string, unknown>) {
      this.opts = { ...this.opts, ...o }
    }
  }
  ;(globalThis as any).google = {
    maps: {
      Size: class {
        w: number
        h: number
        constructor(w: number, h: number) {
          this.w = w
          this.h = h
        }
      },
      LatLng: class {
        _lat: number
        _lng: number
        constructor(lat: number, lng: number) {
          this._lat = lat
          this._lng = lng
        }
        lat() {
          return this._lat
        }
        lng() {
          return this._lng
        }
      },
      LatLngBounds: class {
        sw: any
        ne: any
        constructor(sw: any, ne: any) {
          this.sw = sw
          this.ne = ne
        }
      },
      // new で呼ばれてもオブジェクトを返せばそれが結果になる。
      // こうするとテスト側から生成物を掴める（this を外へ持ち出さない）
      // biome-ignore lint/complexity/useArrowFunction: new で呼ばれるのでアローにできない
      Map: function (el: HTMLElement, o: Record<string, unknown>) {
        fakeMap = new FakeMap(el, o)
        return fakeMap
      } as unknown as new (
        el: HTMLElement,
        o: Record<string, unknown>,
      ) => unknown,
      Polyline: FakePolyline,
      Marker: class {
        o: Record<string, unknown>
        constructor(o: Record<string, unknown>) {
          this.o = o
          created.markers.push(this)
        }
        addListener() {}
        setMap() {}
      },
      InfoWindow: class {
        html?: string
        pos?: unknown
        opened = false
        constructor(_o?: Record<string, unknown>) {}
        setContent(h: string) {
          this.html = h
        }
        setPosition(p: unknown) {
          this.pos = p
        }
        open() {
          this.opened = true
        }
      },
      event: { trigger() {} },
      ControlPosition: { TOP_RIGHT: 'TOP_RIGHT' },
    },
  }
  // Maps JS API を本当に読みに行かせない（課金・ネットワーク依存を持ち込まない）
  vi.spyOn(document.head, 'appendChild').mockImplementation(((el: any) => el) as any)
}

const STYLE: Record<string, RouteStyle> = {
  baseline: { color: '#6b7280', width: 3.5, offset: 5, dash: [2, 1.6], casing: false },
  flood: { color: '#1f6fd0', width: 4.0, offset: 0, dash: null, casing: true },
  combined: { color: '#0b8a3d', width: 5.5, offset: -5, dash: null, casing: true },
}
const ORDER = ['baseline', 'flood', 'combined'] as RouteId[]

const line = (route: string, kind: string) => ({
  type: 'Feature',
  properties: { kind, route },
  geometry: {
    type: 'LineString',
    coordinates: [
      [139.8, 35.75],
      [139.79, 35.74],
      [139.78, 35.73],
    ],
  },
})

/** ⚠️ **async にしてある。** アダプタは Maps のスクリプト読み込みを Promise で
 *  待つようになったので（`loadMapsScript`。スクリプトを2枚入れないため）、
 *  `init()` の直後にはまだ地図ができていない。呼び出し側は必ず await すること。 */
async function makeAdapter() {
  const el = document.createElement('div')
  el.id = 'map'
  document.body.appendChild(el)
  const a = createGoogleAdapter()
  await a.init('map', { center: [139.792, 35.733], zoom: 13 })
  return a
}

describe('adapter_google（スタブ）', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    // import.meta.env はビルド時に埋め込まれるので、実行時の代入では効かない。
    // vitest の stubEnv を使う（キーは実在しないダミー。ネットワークにも出ない）
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'dummy-for-stub')
    installStub()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('ズームの1段ズレを吸収する（MapLibre z13 = Google z14）', async () => {
    const a = await makeAdapter()
    expect(created.mapOpts!.zoom).toBe(14)
    expect((created.mapOpts!.center as any).lat).toBe(35.733)
    expect((created.mapOpts!.center as any).lng).toBe(139.792)

    const onViewportChange = vi.fn()
    a.onViewportChange(onViewportChange)
    expect(onViewportChange).toHaveBeenLastCalledWith({
      bbox: [
        [139.72, 35.68],
        [139.86, 35.78],
      ],
      zoom: 13,
    })

    fakeMap._zoom = 13
    fakeMap.listeners.idle()
    expect(onViewportChange).toHaveBeenLastCalledWith({
      bbox: [
        [139.72, 35.68],
        [139.86, 35.78],
      ],
      zoom: 12,
    })
  })

  it('表示範囲の変更をdebounceし、購読解除後は通知しない', async () => {
    vi.useFakeTimers()
    const a = await makeAdapter()
    const callback = vi.fn()
    const unsubscribe = a.onViewportChange(callback)
    callback.mockClear()

    fakeMap._bounds = {
      getSouthWest: () => ({ lat: () => 35.7, lng: () => 139.74 }),
      getNorthEast: () => ({ lat: () => 35.8, lng: () => 139.88 }),
    }
    fakeMap.listeners.bounds_changed()
    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(callback).toHaveBeenCalledOnce()

    callback.mockClear()
    fakeMap._bounds = {
      getSouthWest: () => ({ lat: () => 35.71, lng: () => 139.75 }),
      getNorthEast: () => ({ lat: () => 35.81, lng: () => 139.89 }),
    }
    fakeMap.listeners.bounds_changed()
    fakeMap.listeners.idle()
    expect(callback).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    expect(callback).toHaveBeenCalledOnce()

    unsubscribe()
    fakeMap.listeners.idle()
    expect(callback).toHaveBeenCalledOnce()
  })

  it('初期化直後にboundsが未確定でも例外にしない', async () => {
    const a = await makeAdapter()
    fakeMap._bounds = undefined
    const callback = vi.fn()
    expect(() => a.onViewportChange(callback)).not.toThrow()
    expect(callback).not.toHaveBeenCalled()

    fakeMap._bounds = {
      getSouthWest: () => ({ lat: () => 35.68, lng: () => 139.72 }),
      getNorthEast: () => ({ lat: () => 35.78, lng: () => 139.86 }),
    }
    fakeMap.listeners.idle()
    expect(callback).toHaveBeenCalledOnce()
  })

  it('航空写真に切り替えさせない / ズームボタンは右上', async () => {
    await makeAdapter()
    expect(created.mapOpts!.mapTypeControl).toBe(false)
    expect(created.mapOpts!.zoomControl).toBe(true)
    expect((created.mapOpts!.zoomControlOptions as any).position).toBe('TOP_RIGHT')
  })

  it('contextmenu の座標を長押し地点として通知する', async () => {
    const adapter = await makeAdapter()
    const callback = vi.fn()
    adapter.onLongPress(callback)

    fakeMap.listeners.contextmenu({
      latLng: { lat: () => 35.714, lng: () => 139.777 },
    })

    expect(callback).toHaveBeenCalledWith([139.777, 35.714])
  })

  it('小数ズームを有効にしている（fitBounds を地理院版に合わせる）', async () => {
    await makeAdapter()
    expect(created.mapOpts!.isFractionalZoomEnabled).toBe(true)
  })

  describe('タイル（overzoom / ラップ / 差し替え）', () => {
    const url = '../var/tiles/flood/envelope/{z}/{x}/{y}.png'

    it('同ズームはそのまま / 拡大なし', async () => {
      const a = await makeAdapter()
      a.addRasterLayer('flood', url, { minzoom: 12, maxzoom: 17, opacity: 0.7 })
      const t = created.overlays[0].getTile({ x: 14552, y: 6446 }, 14, document)
      expect(t.style.backgroundImage).toContain('/14/14552/6446.png')
      expect(t.style.backgroundSize).toBe('256px 256px')
      expect(t.style.opacity).toBe('0.7')
    })

    it('maxzoom超過は親タイルの象限を切り出す', async () => {
      const a = await makeAdapter()
      a.addRasterLayer('flood', url, { minzoom: 12, maxzoom: 17, opacity: 0.7 })
      // z19 → 親 z17。shift=2, scale=4。116417>>2=29104, 51571>>2=12892
      const t = created.overlays[0].getTile({ x: 116417, y: 51571 }, 19, document)
      expect(t.style.backgroundImage).toContain('/17/29104/12892.png')
      expect(t.style.backgroundSize).toBe('1024px 1024px')
      expect(t.style.backgroundPosition).toBe('-256px -768px') // 116417%4=1, 51571%4=3
    })

    it('範囲外は空タイル / 経度をラップする', async () => {
      const a = await makeAdapter()
      a.addRasterLayer('flood', url, { minzoom: 12, maxzoom: 17, opacity: 0.7 })
      const g = created.overlays[0]
      expect(g.getTile({ x: 100, y: 100 }, 11, document).style.backgroundImage).toBe('')
      expect(g.getTile({ x: 10, y: -1 }, 14, document).style.backgroundImage).toBe('')
      expect(g.getTile({ x: 1 << 14, y: 6446 }, 14, document).style.backgroundImage).toContain(
        '/14/0/6446.png',
      )
    })

    it('差し替えで overlay を作り直し、不透明度を引き継ぐ', async () => {
      const a = await makeAdapter()
      a.addRasterLayer('flood', url, { minzoom: 12, maxzoom: 17, opacity: 0.7 })
      const before = created.overlays[0]
      a.setLayerOpacity('flood', 0.4)
      a.setRasterTiles('flood', '../var/tiles/flood/kandagawa/{z}/{x}/{y}.png')
      const after = created.overlays[0]
      expect(after).not.toBe(before)
      const t = after.getTile({ x: 14552, y: 6446 }, 14, document)
      expect(t.style.backgroundImage).toContain('kandagawa')
      expect(t.style.opacity).toBe('0.4')
    })
  })

  describe('経路', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        line('baseline', 'route'),
        line('flood', 'route'),
        line('combined', 'route'),
        line('flood', 'segment'),
        line('flood', 'segment'),
        line('combined', 'segment'),
      ],
    }

    it('区間は線にしない（8本）／各線は3点', async () => {
      const a = await makeAdapter()
      created.lines.length = 0
      a.setRoutes(fc, STYLE as Record<RouteId, RouteStyle>, ORDER)
      // baseline: main+hit / flood: casing+main+hit / combined: casing+main+hit
      expect(created.lines).toHaveLength(8)
      expect(created.lines.every((p) => (p.o.path as unknown[]).length === 3)).toBe(true)
    })

    it('当たり判定は経路ごとに1つの太い透明線で、描画順が zIndex になる', async () => {
      const a = await makeAdapter()
      created.lines.length = 0
      a.setRoutes(fc, STYLE as Record<RouteId, RouteStyle>, ORDER)
      const hits = created.lines.filter((p) => p.o.clickable)
      expect(hits).toHaveLength(3)
      expect(hits.every((p) => p.o.strokeWeight === 18 && p.o.strokeOpacity === 0.01)).toBe(true)
      const zs = hits.map((p) => p.o.zIndex as number)
      expect(zs[0]).toBeLessThan(zs[1])
      expect(zs[1]).toBeLessThan(zs[2])
    })

    it('破線はシンボルの繰り返しで作る', async () => {
      const a = await makeAdapter()
      created.lines.length = 0
      a.setRoutes(fc, STYLE as Record<RouteId, RouteStyle>, ORDER)
      const dashed = created.lines.find((p) => p.o.icons)
      expect(dashed).toBeDefined()
      expect(dashed!.o.strokeOpacity).toBe(0)
    })

    it('オフセットは 0 なら動かさず、±px はズームに追従して縮む', async () => {
      const a = await makeAdapter()
      created.lines.length = 0
      a.setRoutes(fc, STYLE as Record<RouteId, RouteStyle>, ORDER)
      const mainOf = (c: string) =>
        created.lines.find((p) => p.o.strokeColor === c && !p.o.clickable)!
      expect((mainOf('#1f6fd0').o.path as any)[1].lng).toBe(139.79)

      const comb = mainOf('#0b8a3d')
      const zoomTo = async (z: number) => {
        fakeMap._zoom = z
        a.fitBounds(
          [
            [139.77, 35.71],
            [139.81, 35.75],
          ],
          { padding: { top: 0, bottom: 0, left: 0, right: 0 } },
        )
        await new Promise((r) => requestAnimationFrame(r))
        return Math.abs((comb.o.path as any)[1].lng - 139.79)
      }

      // ⚠️ 上限（MAX_OFFSET_M）に掛からない範囲どうしで比べる。
      //    引きの画は下のテストの担当
      const d16 = await zoomTo(16)
      expect(d16).toBeGreaterThan(1e-6)
      const d18 = await zoomTo(18)
      expect(d18).toBeLessThan(d16 / 3)
    })

    it('引きの画でもオフセットが暴れない（上限で頭打ちにする）', async () => {
      // ⚠️ 素朴な法線オフセットなので、ずらす距離が頂点間隔を超えると角で線が裏返り、
      //    経路が巨大なギザギザになる（z11 で実際に起きた）。上限で止める
      const a = await makeAdapter()
      created.lines.length = 0
      a.setRoutes(fc, STYLE as Record<RouteId, RouteStyle>, ORDER)
      const comb = created.lines.find((p) => p.o.strokeColor === '#0b8a3d' && !p.o.clickable)!
      const at = async (z: number) => {
        fakeMap._zoom = z
        a.fitBounds(
          [
            [139.77, 35.71],
            [139.81, 35.75],
          ],
          { padding: { top: 0, bottom: 0, left: 0, right: 0 } },
        )
        await new Promise((r) => requestAnimationFrame(r))
        return Math.abs((comb.o.path as any)[1].lng - 139.79)
      }
      // 経度 12m ぶん ≒ 0.000133度（緯度35.7で cos 補正）。上限なので z11 でも超えない
      const cap = (12 / (111320 * Math.cos((35.73 * Math.PI) / 180))) * 1.05
      expect(await at(11)).toBeLessThan(cap)
      expect(await at(14)).toBeLessThan(cap)
    })

    it('クリックは経路IDと座標を返す', async () => {
      const a = await makeAdapter()
      created.lines.length = 0
      a.setRoutes(fc, STYLE as Record<RouteId, RouteStyle>, ORDER)
      let got: unknown = null
      a.onClick((e) => {
        got = e
      })
      const hits = created.lines.filter((p) => p.o.clickable)
      hits[2].listeners.click({ latLng: new (globalThis as any).google.maps.LatLng(35.74, 139.79) })
      expect(got).toEqual({ lngLat: [139.79, 35.74], route: 'combined' })
    })

    it('表示切替とホバー強調（白フチも一緒に太る）', async () => {
      const a = await makeAdapter()
      created.lines.length = 0
      a.setRoutes(fc, STYLE as Record<RouteId, RouteStyle>, ORDER)
      a.setVisible('flood', false)
      expect(created.lines.filter((p) => p.o.visible === false)).toHaveLength(3)
      a.setVisible('flood', true)
      expect(created.lines.filter((p) => p.o.visible === false)).toHaveLength(0)

      a.setLineWidth('combined', 8.5)
      expect(
        created.lines.some((p) => p.o.strokeColor === '#0b8a3d' && p.o.strokeWeight === 8.5),
      ).toBe(true)
      expect(
        created.lines.some((p) => p.o.strokeColor === '#ffffff' && p.o.strokeWeight === 12),
      ).toBe(true)
    })
  })

  it('シートが覆う分だけ地図を持ち上げ、fitBounds の余白から引く', async () => {
    const a = await makeAdapter()
    a.reserveBottom(75)
    expect(document.getElementById('map')!.style.bottom).toBe('75px')
    a.fitBounds(
      [
        [139.77, 35.71],
        [139.81, 35.75],
      ],
      { padding: { top: 50, bottom: 91, left: 24, right: 24 } },
    )
    const last = fakeMap.fits[fakeMap.fits.length - 1]
    expect(last.p.bottom).toBe(16) // 91 - 75
    expect(last.b.sw.lat()).toBe(35.71)
    expect(last.b.ne.lng()).toBe(139.81)
  })

  it('ジェスチャの抑止と復帰', async () => {
    const a = await makeAdapter()
    a.lockGestures(true)
    expect(fakeMap.opts.gestureHandling).toBe('none')
    a.lockGestures(false)
    expect(fakeMap.opts.gestureHandling).toBe('auto')
  })

  it('マーカーの lng/lat が入れ替わらない', async () => {
    const a = await makeAdapter()
    a.setMarkers([{ lngLat: [139.805, 35.7497], label: '北千住駅' }])
    const pos = created.markers[0].o.position as any
    expect(pos.lat).toBe(35.7497)
    expect(pos.lng).toBe(139.805)
  })
})
