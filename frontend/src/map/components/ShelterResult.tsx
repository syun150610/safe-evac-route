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
 *
 * ⚠️ **「その災害への登録が無い」を隠さない。** 指定避難所は元データに
 * 災害種別の欄が無く、`hazard_match` は必ず false になる。近くて経路も
 * 安全なので候補には入るが、**その災害に対応しているとは言えない**。
 * false を「対応していない」と読ませず、「登録が無い」と書く。
 *
 * ⚠️ **どれも危ないときに黙って推さない。** `all_candidates_dangerous` は
 * 「行き先は示すが、ここが安全だとは言っていない」状態。必ず断る。
 */
import type { HazardRisk, RouteStats, ShelterCandidate, ShelterInfo, ShelterQuery } from '../types'

interface Props {
  shelter: ShelterInfo
  /** 種類を両方選んだときの「もう一方の種類の最善」。地図には別の線で出ている */
  alt?: (ShelterInfo & { stats: RouteStats }) | null
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
        <span className="flex flex-wrap items-center gap-1">
          <em
            className={`rounded-full px-1.5 text-[8px] not-italic ${
              candidate.type === 'urgent'
                ? 'bg-green-50 text-green-800'
                : 'bg-amber-50 text-amber-800'
            }`}
          >
            {candidate.type_label}
          </em>
          {/* ⚠️ 「対応していない」ではなく「登録が無い」 */}
          {!candidate.hazard_match && (
            <em className="text-[8px] text-slate-500 not-italic">この災害の登録なし</em>
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

function KindHeader({ shelter }: { shelter: ShelterInfo }) {
  return (
    <header className="mb-2 flex min-h-8 items-center gap-1.5 border-slate-200 border-b pb-1.5">
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${shelter.type === 'urgent' ? 'bg-green-600' : 'bg-amber-500'}`}
      />
      <strong className="text-[10px] leading-tight text-slate-700">{shelter.type_label}</strong>
    </header>
  )
}

function DestinationCard({
  shelter,
  stats,
  featured,
  risk,
}: {
  shelter: ShelterInfo
  stats?: RouteStats
  featured: boolean
  risk?: HazardRisk
}) {
  const unevaluated = stats && risk ? num(stats, risk.coverage_key) : 0
  return (
    <article
      className={`mb-3 grid gap-1 rounded-[10px] border p-2.5 ${
        shelter.type === 'urgent'
          ? 'border-green-300 bg-green-50/60'
          : 'border-amber-300 bg-amber-50/60'
      }`}
    >
      <em className="w-fit rounded-full bg-[#07156f] px-1.5 py-px text-[8px] font-bold text-white not-italic">
        {featured ? 'おすすめ' : '種類別候補'}
      </em>
      <strong className="break-words text-[12px] leading-tight">{shelter.name}</strong>
      <small className="break-words text-[9px] text-slate-600">{shelter.address}</small>
      {stats && (
        <span className="mt-0.5 text-[9px] text-slate-700">
          {`徒歩約${Math.round(stats.duration_min_60)}分・${km(stats.distance_m)}`}
          {risk && ` ・ ${risk.label} ${pct(num(stats, risk.ratio_key))}`}
        </span>
      )}
      {unevaluated > 0 && (
        <span className="text-[9px] text-amber-700">
          {`※この経路の${pct(unevaluated)}は評価範囲外です（安全という意味ではありません）`}
        </span>
      )}
      {/* ⚠️ 施設がその災害に対応しているかは、指定避難所のデータからは分からない */}
      {!shelter.hazard_match && (
        <span className="text-[9px] text-slate-600">
          ※この施設にはこの災害への対応が登録されていません（対応していないという意味ではありません）
        </span>
      )}
    </article>
  )
}

function ResultColumn({
  shelter,
  stats,
  featured,
  candidates,
  risk,
  onSelect,
}: {
  shelter: ShelterInfo
  stats?: RouteStats
  featured: boolean
  candidates: ShelterCandidate[]
  risk?: HazardRisk
  onSelect: (candidate: ShelterCandidate) => void
}) {
  const groups = (['hazard', 'length'] as const)
    .map((basis) => ({ basis, rows: candidates.filter((candidate) => candidate.basis === basis) }))
    .filter((group) => group.rows.length > 0)

  return (
    <div className="min-w-0" data-shelter-kind={shelter.type}>
      <KindHeader shelter={shelter} />
      <DestinationCard featured={featured} risk={risk} shelter={shelter} stats={stats} />
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
                key={`${candidate.type}:${candidate.id}`}
                risk={risk}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function ShelterResult({ shelter, alt, candidates, query, risk, onSelect }: Props) {
  const recommended = candidates.find(
    (candidate) => candidate.id === shelter.id && candidate.type === shelter.type,
  )
  const selected = new Set([
    `${shelter.type}:${shelter.id}`,
    ...(alt ? [`${alt.type}:${alt.id}`] : []),
  ])
  const columns = [
    {
      shelter,
      stats: recommended?.stats,
      featured: true,
    },
    ...(alt
      ? [
          {
            shelter: alt,
            stats: alt.stats,
            featured: false,
          },
        ]
      : []),
  ].sort((a, b) => (a.shelter.type === 'urgent' ? -1 : b.shelter.type === 'urgent' ? 1 : 0))

  return (
    <section className="mb-4">
      {/* ⚠️ 見出しは3つのまとまり（検索の条件 / 経路を比較 / 避難先の候補）に
          合わせる。どこに何があるか、見出しだけで分かるようにする */}
      <h3 className="mt-5 mb-2 text-[13px]">避難先の候補</h3>

      {/* ⚠️ どれも危ないときに黙って推さない */}
      {query.all_candidates_dangerous && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[9px] leading-relaxed text-red-800">
          {`近くの避難先はどこへ向かっても、経路の${pct(query.danger_ratio_limit)}以上が危険区間になります。いちばん危険の少ない先を出していますが、安全な経路がある状態ではありません。`}
        </p>
      )}

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

      {/* ⚠️ **両方を選んだときは、全結果を種類ごとの列に閉じ込める。**
          左=まず逃げ込む緊急避難場所、右=その後生活する避難所。候補だけを
          ものさし別に混ぜると、上の経路比較との対応が分からなくなる。 */}
      <div className={`grid items-start gap-2 ${columns.length > 1 ? 'grid-cols-2' : ''}`}>
        {columns.map((column) => (
          <ResultColumn
            candidates={candidates.filter(
              (candidate) =>
                candidate.type === column.shelter.type &&
                !selected.has(`${candidate.type}:${candidate.id}`),
            )}
            featured={column.featured}
            key={column.shelter.type}
            onSelect={onSelect}
            risk={risk}
            shelter={column.shelter}
            stats={column.stats}
          />
        ))}
      </div>

      <p className="text-[8px] leading-relaxed text-slate-400">
        {`${query.pool}件の${query.type === 'all' ? '避難場所・避難所' : shelter.type_label}から、経路を引けた${query.reachable}件を比較しました。距離の上限は${km(query.detour_limit_m)}（いちばん近い避難先の${query.detour_ratio}倍＋${query.detour_slack_m}m）です。`}
      </p>
    </section>
  )
}
