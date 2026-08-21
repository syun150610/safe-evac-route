FROM python:3.14-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=ghcr.io/astral-sh/uv:0.9.22 /uv /uvx /bin/

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY app/ ./app/
# ⚠️ **prep も要る。** app は prep から「置き場の解決（paths）」「ハザード種別の登録表」
#    「経路探索の中身」を import している。単一の出所にするため app 側に複製していない。
#    ⚠️ 重い依存（osmnx / geopandas / scipy）は [dependency-groups] prep にあり、
#    `uv sync --no-dev` では入らないので**イメージには入らない**。
#    それらを使う prep/route_search/graph.py 等は実行時に import されない
#    （tests/test_layering.py が機械的に確認している）
COPY prep/ ./prep/
# 任意地点探索用の圧縮グラフ（約1.6MB×3）。前処理pickleは同梱しない。
COPY graph/ ./graph/
# 初期表示と固定OD比較に使う事前計算済みプリセット。
# data/processed/bundles はgitignore対象なので、本番配布用を明示的に同梱する。
COPY bundles/ ./bundles/
# 避難所・避難場所データ（GeoJSON）。
COPY shelters/ ./shelters/

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
