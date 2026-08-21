"""探索エンジンの回帰テスト。**正しさの証明ではなく、変化の検知。**

⚠️ **期待値はいまの実装（CSR配列版）自身の出力から作った自己参照である。**
比較対象のNetworkX版は、新スコープのグラフ（652,828ノード / 1,905,380エッジ）
ではメモリに載らないため、新スコープで「同じ答えか」を確かめる相手がいない。

移植の正しさを担保しているのは**現行スコープ（北千住↔上野）の240ケース**で、
そちらはNetworkX版の出力と1e-9まで完全一致することを確認済みである
（`studies/graph_array/expected/nx_*.json.gz`、コミット 39ee7c8）。
**あの期待値ファイルは削除しないこと。**

このテストの役割は、今後の変更が意図せず経路・統計・rationaleを
変えていないかを検知することだけである。

全ケースを回す場合:

    cd backend && python -m studies.graph_array.verify --impl prod   # 現行スコープ用
"""

import gzip
import json
import pathlib
import sys

BACKEND = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from studies.graph_array import compare  # noqa: E402
from studies.graph_array.verify import run_prod  # noqa: E402

EXPECTED = BACKEND / "studies/graph_array/expected/csr_newscope_primary.json.gz"
N_OD = 4
N_CASES = 12


def test_primary_cases_are_unchanged():
    from studies.graph_array import od_set

    with gzip.open(EXPECTED, "rt", encoding="utf-8") as f:
        payload = json.load(f)
    expected = payload["cases"]
    assert payload["scope"] == "tokyo-23ku-tama-shigaika"

    actual = run_prod("primary", od_set.load()[:N_OD])
    assert len(actual) == N_CASES

    bad, lines = compare.report(expected, actual)
    assert bad == 0, "\n".join(lines)
