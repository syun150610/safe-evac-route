"""現行スコープの回帰テスト。**配列版へ置き換えた探索が、置き換え前と同じ答えを返すか。**

期待値は移植前のNetworkX実装で固定したもの（`studies/graph_array/expected/`）。
ここでは時間の都合で primary の先頭12ケースだけを見る。全240ケースは

    cd backend && python -m studies.graph_array.verify --impl prod

で回す。⚠️ 期待値を作り直さないこと。作り直すと回帰テストの意味が無くなる。
"""

import gzip
import json
import pathlib
import sys

BACKEND = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from studies.graph_array import compare  # noqa: E402
from studies.graph_array.verify import run_prod  # noqa: E402

EXPECTED = BACKEND / "studies/graph_array/expected/nx_primary.json.gz"
N_CASES = 12


def test_primary_cases_match_pre_migration_expectations():
    from studies.graph_array import od_set

    with gzip.open(EXPECTED, "rt", encoding="utf-8") as f:
        expected = json.load(f)["cases"]

    od_list = od_set.load()[:4]  # 4組 × 3シナリオ = 12ケース
    actual = run_prod("primary", od_list)
    assert len(actual) == N_CASES

    bad, lines = compare.report(
        {k: v for k, v in expected.items() if k in actual}, actual
    )
    assert bad == 0, "\n".join(lines)
