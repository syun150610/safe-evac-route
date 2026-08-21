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


# ---------------- 採否の記録 ----------------
# 2026-08-21、探索範囲を23区+多摩（市街化区域）へ広げるにあたり、建設局17 CSVの
# うちどれを `envelope` に入れるかをユーザーが決めた。**入れなかったものと理由を
# ここに残す。** 後から「なぜ入れていないのか」を追えるようにするため。
#
# 採用（10ファイル / envelope）
#   隅田川・神田川・中川・江東内部 … 移行前からの4流域
#   浅川・多摩川・野川・石神井川白子川・城南 … 今回追加
#   秋川 … **接尾辞なしの shinsui_akikawa.csv を使う。**
#          shinsui_akikawa(1)(2)(3).csv は緯度列に139台・経度列に35台が入っており
#          （実測）、座標が反転している。接尾辞なしは向きが正しく、レンジが
#          (1)(2)(3)の和集合と一致するので結合版とみなす。
#          無効行10,512件は read_points の数値変換で落ちる。
#
# 不採用（4ファイル）
#   黒目川 shinsui_kuromegawa.csv
#     水深が空白の行が 575,227/1,092,979 = 52.6%（実測）。
#     半分以上が欠損したデータを「その地点を覆っている」と扱えないため。
#   残堀川 shinsui_zanborigawa.csv
#     同じく空白 418,263/689,614 = 60.7%（実測）。理由は黒目川と同じ。
#   境川 shinsui_sakaigawa.csv / 鶴見川 shinsui_tsurumigawa.csv
#     2ファイルはSHA256完全一致（1124fae2…、ともに11,648,316B）＝同一ファイル。
#     さらに座標不正が42,395/402,081 = 10.5%、水深列の最大が73.0m、整数率99.3%。
#     73mは浸水深としてあり得ず、この列が水深でない可能性が高いため使わない。
#
# ⚠️ 不採用の4流域は「安全だから外した」のではない。**その範囲は未評価**であり、
#    エッジの coverage は 0 のままになる。表示・判定は未評価として扱うこと。

# ---------------- シナリオ定義 ----------------
# 建設局が配布する17 CSVは download-raw.sh で取得する。
# CSV 1件をそのままシナリオ1件として公開する設計ではない。
SCENARIOS = {
    # ---- 包絡（既定） ----
    "envelope": {
        "label": "包絡（複数河川の最大値）",
        # ⚠️ 合成方式は現行と同じ（各地点で最大値を採る）。ファイルを増やしただけ。
        "csv": [
            kensetsu_csv("shinsui_sumidagawa.csv"),
            kensetsu_csv("shinsui_kandagawa.csv"),
            kensetsu_csv("shinsui_nakagawa.csv"),
            kensetsu_csv("shinsui_koutounaibu.csv"),
            # 2026-08-21追加（23区+多摩の市街化区域へ範囲を広げたため）
            kensetsu_csv("shinsui_asakawa.csv"),
            kensetsu_csv("shinsui_tamagawa.csv"),
            kensetsu_csv("shinsui_nogawa.csv"),
            kensetsu_csv("shinsui_syakujiigawa.csv"),
            kensetsu_csv("shinsui_jyounantiku.csv"),
            kensetsu_csv("shinsui_akikawa.csv"),
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
