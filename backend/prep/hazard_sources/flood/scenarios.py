"""浸水シナリオの定義 — どのCSVをどう合成するか。

make_tiles.py から切り出した（2026-08-16 の構成整理）。**中身は変えていない。**
タイル生成（tile_render）とグラフ構築（route_search）の両方がここを見る。
"""
from prep.paths import data_path

# ---------------- シナリオ定義 ----------------
# 1シナリオ = 1つの想定事象。複数CSVは「同一シナリオの地理的分割」の場合だけ結合する。
SCENARIOS = {
    # ---- 包絡（既定） ----
    # 採用規則: 実数値(m) かつ 世界測地系 のファイルのみ（docs/dev/03_ハザード拡張.md C-1）。
    # 対象コリドー（北千住↔上野）に点があるか、bboxが重なるものを選定した。
    "envelope": {
        "label": "包絡（複数河川の最大値）",
        "csv": [
            data_path("shinsui_sumidagawa.csv"),              # 隅田川及び新河岸川
            data_path("0_kandakaiseicsvnorth.csv"),           # 神田川（例外的に数字系列が実数値・世界測地系）
            data_path("1_kandakaiseicsvsouth.csv"),
            data_path("nakagawa_ayase_jiban_shinsui_1.csv"),  # 中川・綾瀬川（コリドー北端に501点）
            data_path("koutou_jiban_shinsui_1.csv"),          # 江東（bboxのみ重なる。念のため）
        ],
    },
    # ---- 単一河川シナリオ（切替オプション） ----
    "sumidagawa": {
        "label": "隅田川及び新河岸川流域",
        "csv": [data_path("shinsui_sumidagawa.csv")],
    },
    "kandagawa": {
        "label": "神田川流域",
        # 実数値の系列（改正版）を採用。kanda_jiban_shinsui_* は浸水深がランク値(0〜7)で、
        # 各ランクが何メートルかがデータから分からないため使わない（docs/findings/データ棚卸し.md 第4節）
        "csv": [data_path("0_kandakaiseicsvnorth.csv"), data_path("1_kandakaiseicsvsouth.csv")],
    },
}

# 旧日本測地系の疑いがあるファイル（docs/findings/データ棚卸し.md 第3節）。
# 読み込み時に警告するだけで、変換はしない。
SUSPECT_DATUM = {
    "2_jonankaiseicsv1.csv", "3_jonankaiseicsv2.csv",
    "4_syakujii-sirako.csv", "5_nogawa.csv",
}
