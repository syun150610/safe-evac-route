/** 避難先探索（POST /api/evac-routes/search/shelter）の結果。
 *
 * ## 見せ方の考え方
 *
 * **推奨1件を主役にし、ほかは「比較材料」として下に置く。** 地図に描く経路は
 * 1本しかないので、主役は必ず1つ要る。
 *
 * ⚠️ **通し番号の順位を振らない。** APIの並びは
 * 「推奨 → 危険が小さい順（`basis: 'hazard'`）→ 近い順（`basis: 'length'`）」の
 * 連結で、**全体を貫く一つのものさしが無い**（片方はハザードコスト、
 * もう片方は距離）。1位2位…と振ると、別のものさしで並べたものを
 * 一列の優劣として見せることになる。ここでは群ごとに見出しを付けて分ける。
 *
 * ⚠️ **危険区間の呼び名と統計キーをここに書かない。** `/api/hazards` の
 * `hazards[].risk` が配る（RouteTable と同じ規則）。種別が増えても無変更。
 *
 * ⚠️ **未評価区間を落とさない。** 危険区間0%でも整備範囲の外なら「安全」ではなく
 * 「判断材料が無い」。候補ごとに `coverage_key` の割合を出す。
 *
 * ⚠️ **足切りしたことを黙らない。** `fell_back_to_nearest` のとき、
 * 「近所に安全な避難先がある」と読ませない一文を必ず出す。
 */
import type { HazardRisk, RouteStats, ShelterCandidate, ShelterInfo, ShelterQuery } from '../types'

interface Props {
  shelter: ShelterInfo
  candidates: ShelterCandidate[]
  query: ShelterQuery
  /** 表示中の災害の危険区間定義。カタログ未取得のあいだは undefined */
  risk?: HazardRisk
  /** 候補をタップしたとき。その避難所を目的地にして引き直す */
  onSelect: (candidate: ShelterCandidate) => void
}

/** APIが配るキー名で `stats` を引く（RouteTable の `num` と同じ理由）。 */
function num(stats: RouteStats, key: string): number {
  const v = (stats as unknown as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : 0
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const km = (m: number) => `${(m / 1000).toFixed(2)} km`

/** 群の見出し。**何のものさしで並んでいるか**を必ず書く */
const GROUP = {
  hazard: { title: '危険が小さい順', note: '選んだ災害の重みで引いた経路の比較です' },
  length: { title: '近い順', note: '距離だけで引いた経路の比較です' },
} as const

function CandidateRow({
  candidate,
  risk,
  onSelect,
}: {
  candidate: ShelterCandidate
  risk?: HazardRisk
  onSelect: (c: ShelterCandidate) => void
}) {
  const unevaluated = risk ? num(candidate.stats, risk.coverage_key) : 0
  return (
    <li>
      <button
        type="button"
        className="grid w-full cursor-pointer gap-0.5 rounded-lg border border-slate-200 bg-white p-2.5 text-left"
        onClick={() => onSelect(candidate)}
      >
        <span className="flex items-center justify-between gap-2">
          <strong className="text-[11px]">{candidate.name}</strong>
          {!candidate.within_limit && (
            <em className="shrink-0 rounded-full bg-amber-50 px-1.5 text-[8px] text-amber-800 not-italic">
              遠い
            </em>
          )}
        </span>
        <small className="text-[9px] text-slate-500">
          {`${candidate.municipality}・徒歩約${Math.round(candidate.stats.duration_min_60)}分・${km(candidate.stats.distance_m)}`}
        </small>
        {risk && (
          <span className="text-[9px] font-bold text-[#07156f]">
            {`${risk.label} ${pct(num(candidate.stats, risk.ratio_key))}`}
          </span>
        )}
        {/* 危険区間0%を「安全」と読ませないための但し書き */}
        {unevaluated > 0 && (
          <span className="text-[9px] text-amber-700">{`※${pct(unevaluated)}は評価範囲外`}</span>
        )}
      </button>
    </li>
  )
}

export function ShelterResult({ shelter, candidates, query, risk, onSelect }: Props) {
  const recommended = candidates.find((c) => c.id === shelter.id)
  const others = candidates.filter((c) => c.id !== shelter.id)
  const groups = (['hazard', 'length'] as const)
    .map((basis) => ({ basis, rows: others.filter((c) => c.basis === basis) }))
    .filter((g) => g.rows.length > 0)
  const unevaluated = recommended && risk ? num(recommended.stats, risk.coverage_key) : 0

  return (
    <section className="mb-4">
      <h3 className="mt-5 mb-2 text-[13px]">この災害での避難先</h3>

      <article className="mb-3 grid gap-1 rounded-[10px] border border-indigo-300 bg-indigo-50/60 p-3">
        <span className="flex items-center gap-1.5">
          <em className="rounded-full bg-[#07156f] px-1.5 py-px text-[8px] font-bold text-white not-italic">
            おすすめ
          </em>
          <span className="rounded-full bg-white px-1.5 text-[8px] text-slate-600">
            {shelter.type_label}
          </span>
        </span>
        <strong className="text-[13px]">{shelter.name}</strong>
        <small className="text-[9px] text-slate-600">{shelter.address}</small>
        {recommended && (
          <span className="mt-0.5 text-[10px] text-slate-700">
            {`徒歩約${Math.round(recommended.stats.duration_min_60)}分・${km(recommended.stats.distance_m)}`}
            {risk && ` ・ ${risk.label} ${pct(num(recommended.stats, risk.ratio_key))}`}
          </span>
        )}
        {unevaluated > 0 && (
          <span className="text-[9px] text-amber-700">
            {`※この経路の${pct(unevaluated)}は評価範囲外です（安全という意味ではありません）`}
          </span>
        )}
      </article>

      {/* ⚠️ 足切りしたことを黙らない */}
      {query.fell_back_to_nearest && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[9px] leading-relaxed text-amber-900">
          {`近くの避難先はどれもこの災害の想定範囲にかかっています。より危険の小さい避難先は${km(query.detour_limit_m)}より遠いため、いちばん近い避難先を出しています。下の候補も確認してください。`}
        </p>
      )}
      {query.at_origin.length > 0 && (
        <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-[9px] leading-relaxed text-[#07156f]">
          {`出発地はすでに${query.at_origin.join('・')}の場所です。`}
        </p>
      )}

      {groups.map(({ basis, rows }) => (
        <div className="mb-3" key={basis}>
          <p className="mb-1 text-[10px] font-bold text-slate-500">
            {`ほかの候補（${GROUP[basis].title}）`}
          </p>
          <p className="mb-1.5 text-[8px] text-slate-400">{GROUP[basis].note}</p>
          <ul className="grid list-none gap-1.5 p-0">
            {rows.map((candidate) => (
              <CandidateRow
                candidate={candidate}
                key={candidate.id}
                risk={risk}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ))}

      <p className="text-[8px] leading-relaxed text-slate-400">
        {`${query.pool}件の指定緊急避難場所から、経路を引けた${query.reachable}件を比較しました。距離の上限は${km(query.detour_limit_m)}（いちばん近い避難先の${query.detour_ratio}倍＋${query.detour_slack_m}m）です。`}
      </p>
    </section>
  )
}
