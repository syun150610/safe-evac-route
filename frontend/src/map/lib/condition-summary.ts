import { kindsSummary, type ShelterKind } from '../components/ShelterTypePicker'

/** 畳んだ「検索の条件」に出す一行。
 *
 * ⚠️ **避難先の種類は、避難先を探すときだけ書く。** 行き先を自分で指定した経路では
 * 種類を変えても結果が変わらないので、書くと関係のある設定に見える（ユーザー指摘、
 * 2026-08-24）。開いたときに出す中身（`ShelterTypePicker`）も同じ条件で出し分けて
 * いるので、**畳んだ一行と開いた中身がずれないよう、判定はこの関数だけが持つ**。
 *
 * ⚠️ **災害の呼び名はAPI由来**（`/api/hazards` の `label`）を使う。ここで書かない。
 */
export function conditionSummary(
  hazardLabel: string | null,
  kinds: ShelterKind[],
  shelterSearch: boolean,
) {
  if (hazardLabel === null) return '検索条件を読み込み中…'
  const hazard = `${hazardLabel}を考慮`
  return shelterSearch ? `${hazard} ・ ${kindsSummary(kinds)}` : hazard
}
