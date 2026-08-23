/** 「どの災害で経路を引くか」の入力。**検索前も検索後も同じ部品を使う。**
 *
 * ⚠️ **浸水想定は「全河川（想定最大）」固定で、選ばせない**（2026-08-23の判断）。
 * 単一河川の想定図（神田川・隅田川）は流域の外を一切評価していないので、
 * 流域外を出発地にすると「この経路の100.0%は整備対象流域の外です」となり、
 * 危険が無いのか判断材料が無いのかを利用者が読み分けられない
 * （江戸川区平井×神田川で実際にそうなった）。包絡なら都内10流域を覆う。
 * データ自体は残してあるので、戻すならここへ選択UIを足すだけでよい。
 *
 * ⚠️ **変更は1つのコールバックで、次の条件をまとめて渡す。**
 * いまは種別しか変わらないが、条件が増えたときに呼び出し側が
 * 「新しい種別 ＋ 古い何か」で再検索するのを防ぐため、形は崩さない
 * （Reactのstateは同じイベント内では更新前の値のままなので、押した直後に読めない）。
 *
 * ⚠️ **種別名をここに書かない。** 地震/浸水の出し分けは `HazardPicker` が持つ。
 */
import { HazardPicker } from './HazardPicker'

export type HazardChoice = 'quake' | 'flood'

export interface Condition {
  hazard: HazardChoice
}

interface Props extends Condition {
  /** 次の条件 */
  onChange: (next: Condition) => void
  title?: string
  /** 補足。検索後は「切り替えると引き直す」ことを伝える */
  note?: string
  /** 再検索中。二重に投げさせない */
  busy?: boolean
}

export function HazardCondition({
  hazard,
  onChange,
  title = '考慮する災害',
  note,
  busy = false,
}: Props) {
  return (
    <section
      aria-busy={busy}
      className="mb-2.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 [&>div]:mr-auto"
    >
      <div>
        <strong className="block text-[10px]">{title}</strong>
        {note && <small className="mt-0.5 block text-[8px] text-slate-500">{note}</small>}
      </div>
      <HazardPicker
        compact
        value={hazard}
        onChange={(next) => !busy && onChange({ hazard: next })}
      />
    </section>
  )
}
