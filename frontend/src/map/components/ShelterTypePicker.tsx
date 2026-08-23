/** 「どの種類の避難先を探すか」の入力と、2種類の違いの説明。
 *
 * ## 2種類は役割が違う
 *
 *   指定緊急避難場所 … **まず逃げ込む**先。災害種別ごとに指定されている
 *   指定避難所       … **そのあと生活する**先。災害種別の指定は無い
 *
 * ⚠️ **既定では混ぜて探さない**（2026-08-23の判断）。混ぜると、逃げ込む先を
 * 探しているのに滞在用の施設が推奨されうる。両方を見たいときだけ両方ONにする。
 *
 * ⚠️ **両方OFFにはできない。** 探す対象が無くなるので、最後のひとつは外せない。
 *
 * ⚠️ **説明文をここ以外に散らさない。** 2種類の違いは利用者がいちばん誤解する
 * ところで、画面ごとに言い方が違うと余計に混乱する。文言はこのファイルだけが持つ。
 */
import { useId, useState } from 'react'

export type ShelterKind = 'urgent' | 'designated'
/** APIの `shelter_type`。両方選べば "all" */
export type ShelterTypeParam = ShelterKind | 'all'

/** ⚠️ 色は地図のピンと合わせること（`adapters/google.ts` の `setShelterMarkers`）。
 *  緑=指定緊急避難場所 / オレンジ=指定避難所 */
const KINDS = {
  urgent: {
    label: '指定緊急避難場所',
    short: '緊急避難場所',
    lead: 'まず逃げ込む先',
    body: '切迫した危険から命を守るために、いったん逃げ込む場所です。校庭・公園・河川敷などの広い場所が多く、市区町村が**災害の種類ごとに**指定しています。',
    on: 'border-green-600 bg-green-50 text-green-900',
    dot: 'bg-green-600',
  },
  designated: {
    label: '指定避難所',
    short: '避難所',
    lead: 'そのあと生活する先',
    body: '家に戻れなくなった人が、一定期間滞在する施設です。学校の体育館などが多く、元データに**災害の種類の指定はありません**。',
    on: 'border-amber-600 bg-amber-50 text-amber-900',
    dot: 'bg-amber-500',
  },
} as const

const ORDER: ShelterKind[] = ['urgent', 'designated']

export function toParam(selected: ShelterKind[]): ShelterTypeParam {
  return selected.length === 2 ? 'all' : selected[0]
}

/** 畳んだ「検索の条件」に出す短い呼び名。
 *
 * ⚠️ **呼び名はこのファイルだけが持つ**（上の `KINDS`）。畳んだときに何を
 * 探すのか読めないと、押した瞬間に既定で走ることに気づけない（#48 の指摘）。 */
export function kindsSummary(selected: ShelterKind[]): string {
  return ORDER.filter((kind) => selected.includes(kind))
    .map((kind) => KINDS[kind].short)
    .join('・')
}

interface Props {
  /** 選択中の種類。**空にはならない** */
  selected: ShelterKind[]
  onChange: (next: ShelterKind[]) => void
  /** 再検索中。二重に投げさせない */
  busy?: boolean
  title?: string
  note?: string
}

export function ShelterTypePicker({
  selected,
  onChange,
  busy = false,
  title = '探す避難先',
  note,
}: Props) {
  const [openHelp, setOpenHelp] = useState(false)
  const helpId = useId()

  function toggle(kind: ShelterKind) {
    if (busy) return
    const on = selected.includes(kind)
    // ⚠️ 最後のひとつは外せない（探す対象が無くなる）
    if (on && selected.length === 1) return
    const next = on ? selected.filter((k) => k !== kind) : [...selected, kind]
    onChange(ORDER.filter((k) => next.includes(k)))
  }

  return (
    <section
      aria-busy={busy}
      className="mb-2.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="mr-auto">
          <strong className="block text-[10px]">{title}</strong>
          {note && <small className="mt-0.5 block text-[8px] text-slate-500">{note}</small>}
        </div>
        {ORDER.map((kind) => {
          const on = selected.includes(kind)
          return (
            <button
              type="button"
              key={kind}
              aria-pressed={on}
              className={`inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[9px] ${
                on ? KINDS[kind].on : 'border-slate-200 bg-white text-slate-500'
              }`}
              onClick={() => toggle(kind)}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${on ? KINDS[kind].dot : 'bg-slate-300'}`}
              />
              {KINDS[kind].short}
            </button>
          )
        })}
        <button
          type="button"
          aria-expanded={openHelp}
          aria-controls={helpId}
          aria-label="避難先の種類の違いを見る"
          className="grid size-6 cursor-pointer place-items-center rounded-full border border-slate-300 bg-white text-[10px] text-slate-600"
          onClick={() => setOpenHelp((v) => !v)}
        >
          ?
        </button>
      </div>

      {openHelp && (
        <div
          className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-2.5"
          id={helpId}
        >
          {ORDER.map((kind) => (
            <div className="grid gap-0.5" key={kind}>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-2 rounded-full ${KINDS[kind].dot}`} />
                <strong className="text-[10px]">{KINDS[kind].label}</strong>
                <em className="text-[9px] text-slate-500 not-italic">{KINDS[kind].lead}</em>
              </span>
              <p className="text-[9px] leading-relaxed text-slate-600">
                {KINDS[kind].body.replace(/\*\*/g, '')}
              </p>
            </div>
          ))}
          <p className="text-[8px] leading-relaxed text-slate-500">
            同じ施設が両方に指定されていることもあります（都内で1,119件）。一方、調布市のように緊急避難場所を河川敷や公園だけに指定している市区町村もあります。
          </p>
          {/* ⚠️ 制度の説明は**一次情報へ**送る。この画面の要約だけで判断させない */}
          <a
            className="text-[9px] text-[#07156f] underline"
            href="https://www.bousai.go.jp/taisaku/hinanbasyo.html"
            rel="noreferrer"
            target="_blank"
          >
            内閣府「避難場所に関すること」で詳しく見る
          </a>
        </div>
      )}
    </section>
  )
}
