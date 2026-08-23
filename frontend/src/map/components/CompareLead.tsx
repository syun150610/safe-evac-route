/** 「経路を比較」の要約1行。
 *
 * ⚠️ **同じことを3つの箱で言わない。** 以前は「危険区間◯m」「最短との差◯分」の
 * タイル2つと、根拠の箱が別々に並んでいた（ユーザー指摘、2026-08-24）。
 * ここは1行の概要だけを持ち、詳しい内訳は根拠の「詳細を見る」に任せる。
 *
 * ⚠️ **どちらの避難先の数字かを書く。** 2種類を両方選ぶと避難先が2つ出るが、
 * この数字は**おすすめの避難先について**のもの。もう一方には最短経路を
 * 引いていないので同じ比較はできない。
 *
 * ⚠️ **文言も数値もここで組み立て直さない。** 危険区間の呼び名はAPI、距離差の
 * 言い回しは `bottomSheetLogic.compareText` が単一の出所。
 */
interface Props {
  /** 危険区間の呼び名（"浸水30cm超"）。API由来 */
  riskLabel: string
  /** 選ばれた経路の危険区間(m) */
  afterM: number
  /** 最短経路の危険区間(m) */
  beforeM: number
  /** 「最短経路と比べて +0.47km, +8分」。差が無いときは空 */
  compare: string
  /** 避難先が2つ出ているときだけ渡す */
  shelterName?: string
}

const meters = (value: number) => `${Math.round(value).toLocaleString()}m`

export function CompareLead({ riskLabel, afterM, beforeM, compare, shelterName }: Props) {
  return (
    <span className="block leading-snug">
      {shelterName && (
        <span className="mb-0.5 block text-[10px] text-slate-500">
          {`${shelterName}への経路について`}
        </span>
      )}
      <strong className="text-[#07156f]">{`${riskLabel} ${meters(afterM)}`}</strong>
      <span className="text-slate-600">{`（最短経路は${meters(beforeM)}）`}</span>
      {compare && <span className="mt-0.5 block text-slate-600">{compare}</span>}
    </span>
  )
}
