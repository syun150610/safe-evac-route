/** 地図の避難先ピンを押したときに出す詳細。
 *
 * ⚠️ **押しただけで経路探索を始めない。** 以前はピンを押した瞬間に目的地が決まり、
 * 検索画面へ飛んでいた。何の施設なのか（種別・住所）を見ないまま画面が切り替わるので、
 * 押し間違いに気づけず、地図を見ながら比べることもできない（ユーザー指摘、2026-08-23）。
 *
 * ⚠️ **種別の呼び名（`type_label`）はAPIのものを使う。** 「避難場所」「避難所」の
 * 使い分けは制度用語で、ここで言い換えると `ShelterTypePicker` の説明と食い違う。
 *
 * ⚠️ **対応災害（`hazard_types`）はここに出さない。** 指定避難所は元データに
 * その欄が無く必ず空になるので、出すと「対応していない」と読める。
 * 種別ごとの説明は `ShelterTypePicker` のヘルプが持つ。
 */
import type { ShelterProperties } from '../types'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 「ここに行く」の目印。**アダプタはこの属性で押された要素を見分ける。** */
export const GO_ACTION = 'go'

const BADGE = {
  urgent: 'background:#dcfce7;color:#166534',
  designated: 'background:#fef3c7;color:#92400e',
} as const

export function shelterPopupHtml(properties: ShelterProperties): string {
  const { name, type, type_label, address, municipality } = properties
  // 住所に自治体名が入っていることが多いので、重複するときは足さない
  const place = address.startsWith(municipality) ? address : `${municipality} ${address}`
  return [
    '<div style="min-width:150px;max-width:220px">',
    `<div class="map-text-9" style="display:inline-block;border-radius:999px;padding:1px 7px;font-weight:700;${BADGE[type]}">${escapeHtml(type_label)}</div>`,
    `<div class="map-text-13" style="margin-top:4px;font-weight:700;color:#0f172a;line-height:1.35">${escapeHtml(name)}</div>`,
    `<div class="map-text-10" style="margin-top:2px;color:#64748b;line-height:1.4">${escapeHtml(place)}</div>`,
    // ⚠️ ボタンは `<button>` にする。押せるものだと見て分かるだけでなく、
    //    キーボードでも届く（吹き出しの中は地図の当たり判定の外）
    `<button type="button" class="map-text-11" data-action="${GO_ACTION}" style="margin-top:8px;width:100%;cursor:pointer;border:0;border-radius:8px;background:#07156f;padding:7px 10px;font-weight:700;color:#fff">◇ ここへ行く</button>`,
    '</div>',
  ].join('')
}
