"""浸水シナリオの定義 — どの建設局CSVをどう合成するか。

タイル生成（tile_render）とグラフ構築（route_search）の両方がここを見る。
入力ファイルを各処理へ重複して書かず、この定義を単一の出所にする。
"""

from prep.paths import data_path

KENSETSU_DATASET_URL = (
    "https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d0000000029"
)


def kensetsu_csv(filename):
    return data_path("tokyoto_kensetsukyoku", filename)


# ---------------- シナリオ定義 ----------------
# 建設局17 CSVを正式な一次入力とし、現在の3シナリオへ必要なファイルを割り当てる。
# 17 CSVを17シナリオとして公開するわけではない。
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

# 旧日本測地系の疑いがあるファイル（docs/findings/データ棚卸し.md 第3節）。
# 読み込み時に警告するだけで、変換はしない。
SUSPECT_DATUM = {
    "2_jonankaiseicsv1.csv",
    "3_jonankaiseicsv2.csv",
    "4_syakujii-sirako.csv",
    "5_nogawa.csv",
}
