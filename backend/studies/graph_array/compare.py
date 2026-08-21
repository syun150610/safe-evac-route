"""期待値と実測値の突き合わせ。**「ほぼ一致」を作らないための道具。**

⚠️ 数値の許容差は `TOL = 1e-9` だけ。それ以外の差（キーの有無、型、順序、文字列）は
すべて不一致として返す。呼び出し側で握りつぶさないこと。
"""

from __future__ import annotations

import math

TOL = 1e-9


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def diffs(expected, actual, path: str = "") -> list[str]:
    """一致しない箇所を人が読める形で列挙する。空リスト＝完全一致。"""
    out: list[str] = []
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return [f"{path}: 型が違う dict != {type(actual).__name__}"]
        for k in expected.keys() | actual.keys():
            if k not in expected:
                out.append(
                    f"{path}.{k}: 期待値に無いキーが出た（actual={actual[k]!r}）"
                )
            elif k not in actual:
                out.append(f"{path}.{k}: キーが欠けた（expected={expected[k]!r}）")
            else:
                out += diffs(expected[k], actual[k], f"{path}.{k}")
        return out
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return [f"{path}: 型が違う list != {type(actual).__name__}"]
        if len(expected) != len(actual):
            out.append(f"{path}: 要素数 {len(expected)} != {len(actual)}")
        for i, (e, a) in enumerate(zip(expected, actual, strict=False)):
            out += diffs(e, a, f"{path}[{i}]")
        return out
    if _is_num(expected) and _is_num(actual):
        if math.isnan(expected) and math.isnan(actual):
            return out
        if math.isinf(expected) or math.isinf(actual):
            if expected != actual:
                out.append(f"{path}: {expected!r} != {actual!r}")
            return out
        if abs(float(expected) - float(actual)) > TOL:
            gap = abs(float(expected) - float(actual))
            out.append(f"{path}: {expected!r} != {actual!r} (差 {gap:.3e})")
        return out
    if expected != actual or type(expected) is not type(actual):
        out.append(f"{path}: {expected!r} != {actual!r}")
    return out


def report(
    cases_expected: dict, cases_actual: dict, limit: int = 8
) -> tuple[int, list[str]]:
    """全ケースを比較し、(不一致ケース数, 表示用の行) を返す。"""
    lines: list[str] = []
    bad = 0
    for key in sorted(cases_expected.keys() | cases_actual.keys()):
        if key not in cases_actual:
            bad += 1
            lines.append(f"[欠落] {key}: 実測値が無い")
            continue
        if key not in cases_expected:
            bad += 1
            lines.append(f"[余分] {key}: 期待値に無いケース")
            continue
        d = diffs(cases_expected[key], cases_actual[key], key)
        if d:
            bad += 1
            lines.append(f"[不一致] {key}: {len(d)}箇所")
            lines += [f"    {x}" for x in d[:limit]]
            if len(d) > limit:
                lines.append(f"    ... 他 {len(d) - limit}箇所")
    return bad, lines
