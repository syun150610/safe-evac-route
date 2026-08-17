/** アダプタの生成を1回だけ行う。
 *
 * ⚠️ **地図インスタンスを再レンダで作り直さない。** state が変わるたびに
 * `new Map()` されると、タイルを取り直して課金（Google側）と描画が跳ねる
 * （docs/dev/05_チーム移行案.md §9 落とし穴1）。
 * だから ref に持ち、生成は effect の1回だけにする。
 */
import { useEffect, useRef, useState } from 'react'

import { createMapLibreAdapter } from '../adapters/maplibre'
import type { LngLatTuple, MapAdapter } from '../adapters/types'

export type Platform = 'maplibre' | 'google'

export function useMapAdapter(
  platform: Platform,
  containerId: string,
  center: LngLatTuple,
  zoom: number,
) {
  const ref = useRef<MapAdapter | null>(null)
  const starting = useRef(false)
  const [ready, setReady] = useState(false)

  // ⚠️ 依存は platform だけ。center/zoom を入れると地図を作り直してしまう
  // biome-ignore lint/correctness/useExhaustiveDependencies: 地図を作り直さないため
  useEffect(() => {
    // ⚠️ **StrictMode は effect を2回走らせる。** 素直に書くと同じコンテナに
    //    地図が2つ作られ、後から来た方が前のスタイルを壊して
    //    「Style is not done loading」で落ちる（実際に落ちた）。
    //    地図はページに1つなので、生成済みなら作り直さない。
    //    破棄しないのは、init の待ち（isStyleLoaded のポーリング）を
    //    途中で止める口が無いため。ページ遷移でまとめて捨てる前提。
    //
    // ⚠️ **見張るのは `ref.current` ではなく `starting`。**
    //    `ref.current` は下の async の中、**await のあと**でしか入らない。
    //    Google は `await import()` が先に来るので、2回目の effect が走る時点では
    //    まだ null で、**ガードを素通りしてアダプタが2つできる**。すると
    //    `window.__initGoogleMap` を後から来た方が上書きし、Maps のスクリプトも
    //    2回読み込まれて、**地図のDOMが空の div だけ残る**（2026-08-17 に実際に起きた）。
    //    MapLibre は await が無いぶん先に代入されるので、これまで表面化しなかった。
    if (starting.current) {
      if (ref.current) setReady(true)
      return
    }
    starting.current = true
    ;(async () => {
      const adapter =
        platform === 'google'
          ? (await import('../adapters/google')).createGoogleAdapter()
          : createMapLibreAdapter()
      ref.current = adapter
      await adapter.init(containerId, { center, zoom })
      setReady(true)
    })()
    // 生成は1回だけ。center/zoom の変更で作り直さない（fitBounds で動かす）
  }, [platform])

  return { adapter: ref, ready }
}
