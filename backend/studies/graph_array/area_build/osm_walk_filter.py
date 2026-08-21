"""pbf から **osmnx の walk フィルタと同じ条件**の道路だけを .osm XML へ抜き出す。

⚠️ このスクリプトだけ Python 3.12 + pyosmium で動かす（プロジェクト環境は3.14で
pyosmium が入らないため）。呼び出し方は build_area_graph.py を参照。

osmnx 2.1.1 の `_get_network_filter("walk")` は次の Overpass フィルタを出す。

    ["highway"]["area"!~"yes"]["access"!~"private"]
    ["highway"!~"abandoned|bus_guideway|construction|cycleway|motor|no|planned|
      platform|proposed|raceway|razed|rest_area|services"]
    ["foot"!~"no"]["service"!~"private"]
    ["sidewalk"!~"separate"]["sidewalk:both"!~"separate"]
    ["sidewalk:left"!~"separate"]["sidewalk:right"!~"separate"]

Overpass の `!~` は **アンカー無しの正規表現** で、**キーが無い場合は真**。
ここでも同じ規則で判定する（`re.search` を使い、キーが無ければ通す）。
"""

from __future__ import annotations

import re
import sys

import osmium

EXCLUDE = {
    "area": re.compile("yes"),
    "access": re.compile("private"),
    "highway": re.compile(
        "abandoned|bus_guideway|construction|cycleway|motor|no|planned|platform"
        "|proposed|raceway|razed|rest_area|services"
    ),
    "foot": re.compile("no"),
    "service": re.compile("private"),
    "sidewalk": re.compile("separate"),
    "sidewalk:both": re.compile("separate"),
    "sidewalk:left": re.compile("separate"),
    "sidewalk:right": re.compile("separate"),
}


def keep(tags) -> bool:
    if "highway" not in tags:
        return False
    for key, pattern in EXCLUDE.items():
        value = tags.get(key)
        if value is not None and pattern.search(value):
            return False
    return True


class WayCollector(osmium.SimpleHandler):
    """1回目: 残す way のIDと、参照しているノードIDを集める。"""

    def __init__(self):
        super().__init__()
        self.way_ids: set[int] = set()
        self.node_ids: set[int] = set()
        self.seen = 0

    def way(self, w):
        self.seen += 1
        if self.seen % 500_000 == 0:
            print(f"  pass1 ways={self.seen:,} keep={len(self.way_ids):,}", flush=True)
        if keep(w.tags):
            self.way_ids.add(w.id)
            for n in w.nodes:
                self.node_ids.add(n.ref)


class Writer(osmium.SimpleHandler):
    """2回目: 集めたノードと way だけを書き出す。"""

    def __init__(self, writer, way_ids, node_ids):
        super().__init__()
        self.writer = writer
        self.way_ids = way_ids
        self.node_ids = node_ids
        self.n_nodes = 0
        self.n_ways = 0

    def node(self, n):
        if n.id in self.node_ids:
            self.writer.add_node(n)
            self.n_nodes += 1
            if self.n_nodes % 1_000_000 == 0:
                print(f"  pass2 nodes={self.n_nodes:,}", flush=True)

    def way(self, w):
        if w.id in self.way_ids:
            self.writer.add_way(w)
            self.n_ways += 1


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    print(f"pass1: {src}", flush=True)
    collector = WayCollector()
    collector.apply_file(src)
    print(f"  残す way {len(collector.way_ids):,}", flush=True)
    print(f"  参照ノード {len(collector.node_ids):,}", flush=True)

    print(f"pass2 -> {dst}", flush=True)
    writer = osmium.SimpleWriter(dst)
    w = Writer(writer, collector.way_ids, collector.node_ids)
    w.apply_file(src)
    writer.close()
    print(f"  書き出し nodes={w.n_nodes:,} ways={w.n_ways:,}", flush=True)


if __name__ == "__main__":
    main()
