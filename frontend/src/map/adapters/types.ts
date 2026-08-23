/** 地図基盤アダプタの契約（docs/dev/04_デモUI.md D-5 の TS 版）。
 *
 * app 側は maplibregl も google.maps も参照しない。差はここに閉じる。
 * **契約を増やしたら両方のアダプタに実装すること**（片方だけ直すと黙って壊れる）。
 *
 * ⚠️ ズームは論理値（MapLibre基準）で受ける。MapLibre z15 = Google z16 なので、
 * +1 するのは Google 側アダプタの仕事。共通側に漏らさない。
 */

import type { RouteStyle } from '../constants'
import type { RouteId } from '../types'

export interface LngLat {
  0: number
  1: number
  length: 2
}

export type LngLatTuple = [number, number]
export type BBox = [LngLatTuple, LngLatTuple]

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface RasterOptions {
  minzoom?: number
  maxzoom?: number
  opacity?: number
  attribution?: string
}

export interface MarkerSpec {
  lngLat: LngLatTuple
  label: string
  role?: 'origin' | 'destination'
}

export interface ShelterMarkerSpec {
  lngLat: LngLatTuple
  label: string
  /** urgent = 指定緊急避難場所（緑）/ designated = 指定避難所（黄） */
  shelterType: 'urgent' | 'designated'
  onClick?: () => void
}

/** 地図に出しっぱなしにする吹き出し（経路の要約）。
 *
 * ⚠️ **`showPopup` とは役割が違う。** あちらは押したときに1つだけ出る一時的な
 * 吹き出しで、`setCallouts` は検索結果の要約を出しっぱなしにする。
 * 一覧を渡すたびに**全部作り直す**（マーカーと同じ扱い）。
 *
 * ⚠️ **`html` はエスケープ済みのものを渡すこと。** 施設名は API 由来の文字列で、
 * ここへ素通しする（アダプタ側では組み立てない）。
 */
export interface CalloutSpec {
  id: string
  lngLat: LngLatTuple
  html: string
  /** 地点から見て**どちら側へ吹き出しを出すか**。経路とピンを避ける向きを
   * 呼び出し側が決める（アダプタは向きの意味を知っているだけ） */
  anchor: CalloutAnchor
}

/** 吹き出しを置く向き。`top` = 地点の上 */
export type CalloutAnchor = 'top' | 'bottom' | 'left' | 'right'

export interface RouteClick {
  lngLat: LngLatTuple
  route: RouteId
}

export interface AreaClick {
  lngLat: LngLatTuple
  properties: Record<string, unknown>
}

/** 現在の地図表示範囲。zoom はMapLibre基準の論理値 */
export interface MapViewport {
  bbox: BBox
  zoom: number
}

export interface MapAdapter {
  readonly name: 'maplibre' | 'google'

  init(container: string | HTMLElement, opts: { center: LngLatTuple; zoom: number }): Promise<void>

  addRasterLayer(id: string, url: string, opts?: RasterOptions): void
  setRasterTiles(id: string, url: string): void
  /** 面のベクタレイヤ（地震の町丁目など）。**経路より下に入れること** */
  setVectorAreas(
    id: string,
    geojson: unknown,
    opts?: { opacity?: number; colorProperty?: string },
  ): void
  setLayerOpacity(id: string, v: number): void
  setLayerVisible(id: string, on: boolean): void
  /** 対象エリアの枠。null で消す。
   *
   * **経路を引けるのは事前に焼いたグラフの範囲だけ**なので、どこまでが
   * 対象なのかを地図に出す（docs/dev/06_次セッションへの指示.md §2 (a)）。 */
  setAreaOutline(bbox: BBox | null): void

  /** 経路と区間をまとめて投入（差し替えも同じ） */
  setRoutes(geojson: unknown, styles: Record<RouteId, RouteStyle>, order: RouteId[]): void
  setVisible(routeId: RouteId, on: boolean): void
  /** ホバー強調 */
  setLineWidth(routeId: RouteId, w: number): void

  setMarkers(list: MarkerSpec[]): void
  /** 避難所・避難場所ピン。urgent=緑、designated=黄。空配列で全消し */
  setShelterMarkers(list: ShelterMarkerSpec[]): void
  showPopup(lngLat: LngLatTuple, html: string): void
  /** 経路の要約を出しっぱなしにする吹き出し。空配列で全消し */
  setCallouts(list: CalloutSpec[]): void

  /** cb は「押された経路ID + 座標」を受ける。区間の特定は共通側が座標から行う */
  onClick(cb: (e: RouteClick) => void): void
  onAreaClick(cb: (e: AreaClick) => void): void
  onLongPress(cb: (lngLat: LngLatTuple) => void): void
  /** 移動完了後の表示範囲を通知する。登録時にも現在値を通知し、戻り値で購読解除する */
  onViewportChange(cb: (viewport: MapViewport) => void): () => void

  fitBounds(bbox: BBox, opts?: { padding?: Padding; duration?: number }): void
  flyTo(lngLat: LngLatTuple, zoom?: number): void
  /** シート操作中の地図ジェスチャ抑止 */
  lockGestures(on: boolean): void
  /** シートが下端を覆う高さ。地理院版は帰属表示を持ち上げ、Google版は地図を持ち上げる */
  reserveBottom(px: number): void
  size(): { w: number; h: number }
}
