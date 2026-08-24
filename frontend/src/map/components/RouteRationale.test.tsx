/** 根拠表示が「APIの文字列をそのまま出す」ことの確認。
 *
 * ⚠️ ここで文言そのものを検証しない。文言はAPIが単一の出所で、
 * `backend/tests/test_rationale.py` が4条件を全部踏んでいる。
 * この部品に求めるのは「渡されたものを落とさず出す」ことだけ。
 *
 * 新しい依存を足さないため、react-dom/server で文字列に落として見る。
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Rationale, RationaleHazard } from '../types'
import { RouteRationale } from './RouteRationale'

const HAZARD: RationaleHazard = {
  id: 'flood',
  label: '浸水',
  risk_label: '浸水30cm超',
  considered: true,
  verdict: 'partial',
  before_m: 1177.5,
  after_m: 108.5,
  before_ratio: 0.2162,
  after_ratio: 0.0187,
  unevaluated_ratio: 0.0,
  baseline_unevaluated_ratio: 0.0,
  unevaluated_stage: 'none',
  unevaluated_note: 'この経路は全区間が想定区域図の整備対象流域の中です',
  text: '浸水30cm超の区間が 1,178m → 109m。残り109mは迂回路がありません',
  detail: {
    route: '5.79km ・ 徒歩 約72分（平常時）/ 約96分（災害時60m/分）',
    risk: '浸水30cm超 109m（経路の1.9%）・未評価区間 0.0%',
    compare: '最短より +346m（+6.3%）。浸水30cm超 1,178m → 109m',
    condition: '浸水深0.3m超（歩行困難ライン）を危険区間として集計。想定図は全河川（想定最大）。',
  },
}

function render(hazards: RationaleHazard[]) {
  const rationale: Rationale = {
    baseline_route: 'baseline',
    selected_route: 'combined',
    distance: {
      baseline_m: 5445.9,
      selected_m: 5791.5,
      delta_m: 345.6,
      delta_ratio: 0.0635,
      baseline_min_80: 68.1,
      selected_min_80: 72.4,
      baseline_min_60: 90.8,
      selected_min_60: 96.5,
    },
    hazards,
  }
  return renderToStaticMarkup(<RouteRationale rationale={rationale} />)
}

describe('RouteRationale', () => {
  it('APIが返した短文をそのまま出す', () => {
    expect(render([HAZARD])).toContain(HAZARD.text)
  })

  it('詳細4行は閉じているあいだ出さない', () => {
    // タップ前は短文だけ。開いた状態は aria-controls で結び付けてある
    const html = render([HAZARD])
    expect(html).not.toContain(HAZARD.detail.condition)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="rationale-detail-flood"')
  })

  it('未評価の警告は、危険区間が0mでも落とさない', () => {
    const note = 'この経路の74.9%は想定区域図の整備対象流域の外です。安全という意味ではありません'
    const html = render([
      {
        ...HAZARD,
        verdict: 'already_safe',
        after_m: 0,
        before_m: 0,
        text: '最短経路が最も安全でした（浸水30cm超なし）',
        unevaluated_ratio: 0.749,
        unevaluated_stage: 'warn',
        unevaluated_note: note,
      },
    ])
    expect(html).toContain('最短経路が最も安全でした（浸水30cm超なし）')
    expect(html).toContain(note)
  })

  it('全区間評価済みの説明も隠さず、警告色にはしない', () => {
    const html = render([HAZARD])
    expect(html).toContain('この経路は全区間が想定区域図の整備対象流域の中です')
    expect(html).not.toContain('text-amber-700')
  })

  it('閾値超だけを警告色にする', () => {
    expect(render([{ ...HAZARD, unevaluated_stage: 'warn' }])).toContain('text-amber-700')
    expect(render([{ ...HAZARD, unevaluated_stage: 'some' }])).not.toContain('text-amber-700')
  })

  it('APIが並べた順をそのまま出す', () => {
    // 全区間評価済みの地震が先、未評価のある浸水が後
    const html = render([
      { ...HAZARD, id: 'quake', risk_label: '危険度4以上', text: '地震の根拠' },
      { ...HAZARD, unevaluated_stage: 'warn', text: '浸水の根拠' },
    ])
    expect(html.indexOf('地震の根拠')).toBeLessThan(html.indexOf('浸水の根拠'))
  })

  it('経路の重みに掛けていない種別はその旨を添える', () => {
    const html = render([{ ...HAZARD, considered: false }])
    expect(html).toContain('経路の重みには入れていません')
  })

  it('種別が増えても行が増えるだけ（種別IDを持たない）', () => {
    const html = render([
      HAZARD,
      {
        ...HAZARD,
        id: 'landslide',
        label: '土砂',
        risk_label: '急傾斜地',
        text: '土砂の根拠',
      },
    ])
    expect(html).toContain(HAZARD.text)
    expect(html).toContain('土砂の根拠')
    expect(html).toContain('aria-controls="rationale-detail-landslide"')
  })

  it('根拠が空なら何も描かない', () => {
    expect(render([])).toBe('')
  })

  it('開けることが文字で分かる（三角だけにしない）', () => {
    // ⚠️ 実機確認で「押せると気づかない」と指摘された。三角記号は aria-hidden の
    //    装飾なので、文字での明示を消さないこと。
    const html = render([HAZARD])
    expect(html).toContain('タップして詳細を見る')
    expect(html).toContain('aria-expanded="false"')
  })
})
