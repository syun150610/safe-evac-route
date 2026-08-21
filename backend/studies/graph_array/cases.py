"""照合するケースの定義。**NetworkX版と配列版で同じ関数を使う。**

ケースID: `<od_id>|<scenario>|<hazards>|<include>`
"""

from __future__ import annotations

SCENARIOS = ("envelope", "sumidagawa", "kandagawa")

# セット名 -> (hazardsの作り方, include)
#   primary … Go/No-Go の本体。浸水×地震を掛けた経路と最短の2本
#   flood_only / quake_only … 種別1つだけ
#   minimax … minimax（二分探索）を含む重い版
SETS = {
    "primary": (lambda sc: {"flood": sc, "quake": "total"}, ["baseline", "selected"]),
    "flood_only": (lambda sc: {"flood": sc}, ["baseline", "selected"]),
    "quake_only": (lambda sc: {"quake": "total"}, ["baseline", "selected"]),
    "minimax": (
        lambda sc: {"flood": sc, "quake": "total"},
        ["baseline", "selected", "minimax"],
    ),
}


def case_id(od_id: str, scenario: str, set_name: str) -> str:
    hazards, include = SETS[set_name]
    hz = ",".join(f"{k}={v}" for k, v in sorted(hazards(scenario).items()))
    return f"{od_id}|{scenario}|{hz}|{'+'.join(include)}"


def iter_cases(od_list, set_name):
    """(case_id, od, scenario, hazards, include, scenario_arg) を回す"""
    hazards, include = SETS[set_name]
    for od in od_list:
        for sc in SCENARIOS:
            hz = hazards(sc)
            # 浸水を選ばないセットは、どの想定図で測るかを scenario 引数で渡す
            scenario_arg = None if "flood" in hz else sc
            yield (
                case_id(od["id"], sc, set_name),
                od,
                sc,
                hz,
                list(include),
                scenario_arg,
            )
