/** ① 地点1つぶんの入力。住所サジェスト＋現在地。
 *
 * 決まった地点は `value`（確定した Place）で持ち、入力中の文字列とは別にする。
 * 同じ state にすると「サジェストを選んだ瞬間にまた検索が走る」ので分けている。
 *
 * ⚠️ **対象エリアの外はここで弾く。** 選ばせてから探索して 422 を出すより、
 * 選ぶ時点で候補に印を付ける方が親切（最終判定は API 側。二重に持つのは意図的）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { inArea } from '../hooks/useArea'
import { useGeocode } from '../hooks/useGeocode'
import { currentPosition, type Place } from '../lib/gsi'
import type { Area } from '../types'

/** 候補の表示件数。並べ替えたあとに切る */
const SHOW_MAX = 8

/** エリア外のときの文言。**範囲の説明はAPI（`Area.note`）が単一の出所。** */
function outsideMessage(area: Area | null): string {
  return `この地点は対象エリアの外です。${area?.note ?? ''}`
}

interface Props {
  id: string
  label: string
  value: Place | null
  onChange: (p: Place | null) => void
  area: Area | null
  /** APIが「この地点はエリア外」と言ってきたとき */
  rejected?: boolean
}

export function PlaceInput({ id, label, value, onChange, area, rejected }: Props) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // 確定済みのときは検索しない（選んだ直後に候補が開き直すのを防ぐ）
  const { places, error, loading } = useGeocode(text, open && !value)

  // 外側を押したら候補を閉じる
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(p: Place) {
    onChange(p)
    setText(p.title)
    setOpen(false)
    setGeoError(null)
  }

  function clear() {
    onChange(null)
    setText('')
    setGeoError(null)
  }

  async function here() {
    setLocating(true)
    setGeoError(null)
    try {
      pick(await currentPosition())
    } catch (e) {
      setGeoError((e as Error).message)
    } finally {
      setLocating(false)
    }
  }

  // ⚠️ **対象エリア内を先に出す。** 地理院の住所検索は全国を返すので、
  //    「上野駅」で引くと北海道・青森…の「上野」が上位を埋め、目当ての地点が
  //    スクロールしないと見えない（実際にそうなった）。順序だけ入れ替え、
  //    エリア外も**消さずに残す**（なぜ選べないのかが分かるように）
  const sorted = useMemo(() => {
    const inside = places.filter((p) => inArea(area, p.lat, p.lon))
    const out = places.filter((p) => !inArea(area, p.lat, p.lon))
    return [...inside, ...out].slice(0, SHOW_MAX)
  }, [places, area])

  const outside = value != null && !inArea(area, value.lat, value.lon)

  return (
    <div className="relative" ref={box}>
      <label htmlFor={id} className="mt-1.5 mb-0.5 block text-[11px] text-slate-600">
        {label}
      </label>
      <div className="flex gap-1">
        <input
          id={id}
          type="text"
          autoComplete="off"
          className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12.5px] min-w-0 flex-1"
          placeholder="住所・駅名・施設名"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onChange(null)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
        />
        {value ? (
          <button
            type="button"
            className="min-h-11 whitespace-nowrap rounded-md border border-slate-300 bg-slate-50 px-2.5 text-[11.5px] disabled:opacity-50"
            onClick={clear}
            title="消す"
          >
            ×
          </button>
        ) : (
          <button
            type="button"
            className="min-h-11 whitespace-nowrap rounded-md border border-slate-300 bg-slate-50 px-2.5 text-[11.5px] disabled:opacity-50"
            onClick={here}
            disabled={locating}
            title="現在地を使う"
          >
            {locating ? '…' : '現在地'}
          </button>
        )}
      </div>

      {open && !value && (loading || error || places.length > 0) && (
        <ul className="absolute inset-x-0 z-30 mt-0.5 max-h-56 list-none overflow-y-auto rounded-md border border-slate-300 bg-white p-0 shadow-[0_4px_12px_rgba(0,0,0,0.14)]">
          {loading && <li className="px-2.5 py-2 text-xs text-slate-500">検索中…</li>}
          {error && (
            <li className="px-2.5 py-2 text-xs text-slate-500 text-[12px] text-red-700">{error}</li>
          )}
          {sorted.map((p) => {
            const ok = inArea(area, p.lat, p.lon)
            return (
              <li
                key={`${p.title}-${p.lat},${p.lon}`}
                className="border-b border-slate-100 last:border-0"
              >
                <button
                  type="button"
                  onClick={() => pick(p)}
                  disabled={!ok}
                  className={`block w-full min-h-11 px-2.5 py-2 text-left text-[12.5px] ${ok ? 'hover:bg-blue-50' : 'text-slate-400 cursor-default'}`}
                >
                  {p.title}
                  {!ok && (
                    <span className="float-right text-[10.5px] text-red-700">対象エリア外</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {value && (
        <p
          className={`mt-1 text-[11px] ${outside || rejected ? 'text-red-700' : 'text-slate-600'}`}
        >
          {outside || rejected
            ? // ⚠️ **引ける範囲の呼び名をここに書かない。** APIの `note` を出す。
              // フロントに書くと、探索範囲を広げたときにここだけ古い範囲名が残る
              // （実際に「北千住↔上野」が残っていた）。areaがまだ来ていないときは
              // 範囲名に触れない一文だけにする。
              outsideMessage(area)
            : `${value.lat.toFixed(5)}, ${value.lon.toFixed(5)}`}
        </p>
      )}
      {geoError && (
        <p className="mt-1 text-[11px] text-slate-600 text-[12px] text-red-700">{geoError}</p>
      )}
    </div>
  )
}
