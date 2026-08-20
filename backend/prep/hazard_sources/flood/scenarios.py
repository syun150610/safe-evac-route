"""浸水シナリオの定義 — どの建設局CSVをどう合成するか。

タイル生成（tile_render）とグラフ構築（route_search）の両方がここを見る。
入力ファイルを各処理へ重複して書かず、この定義を単一の出所にする。
"""

from prep.paths import data_path

KENSETSU_DATASET_URL = (
    "https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d0000000029"
)
FLOOD_SOURCE_ID = "kensetsu"
FLOOD_SOURCE_LABEL = "東京都建設局 浸水予想区域図"


def kensetsu_csv(filename):
    return data_path("tokyoto_kensetsukyoku", filename)


# ---------------- シナリオ定義 ----------------
# 建設局が配布する17 CSVは download-raw.sh で取得する。現在の3シナリオが参照するのは
# 下の4ファイルだけで、残り13ファイルは東京都内の対応範囲を広げるときに割り当てる。
# CSV 1件をそのままシナリオ1件として公開する設計ではない。
SCENARIOS = {
    # ---- 包絡（既定） ----
    "envelope": {
        "label": "包絡（複数河川の最大値）",
        "csv": [
            kensetsu_csv("shinsui_sumidagawa.csv"),
            kensetsu_csv("shinsui_kandagawa.csv"),
            kensetsu_csv("shinsui_nakagawa.csv"),
            kensetsu_csv("shinsui_koutounaibu.csv"),
        ],
        "source_dataset_url": KENSETSU_DATASET_URL,
        "precision_note": "神田川は東京都の公開値をメートルとしてそのまま採用",
    },
    # ---- 単一河川シナリオ（切替オプション） ----
    "sumidagawa": {
        "label": "隅田川及び新河岸川流域",
        "csv": [kensetsu_csv("shinsui_sumidagawa.csv")],
        "source_dataset_url": KENSETSU_DATASET_URL,
    },
    "kandagawa": {
        "label": "神田川流域",
        "csv": [kensetsu_csv("shinsui_kandagawa.csv")],
        "source_dataset_url": KENSETSU_DATASET_URL,
        "precision_note": "東京都の公開値をメートルとしてそのまま採用",
    },
}

# 移行前の下水道局CSVを --csv で直接指定する場合だけ使う互換用の警告対象。
# 現在の建設局3シナリオはどのファイルも該当しない。自動変換は行わない。
SUSPECT_DATUM = {
    "2_jonankaiseicsv1.csv",
    "3_jonankaiseicsv2.csv",
    "4_syakujii-sirako.csv",
    "5_nogawa.csv",
}
