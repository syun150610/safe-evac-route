#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

FLOOD_DIR="$REPO_ROOT/data/raw/tokyoto_kensetsukyoku"
QUAKE_DIR="$REPO_ROOT/data/raw/tokyoto_toshiseibikyoku"

scope="all"
force=0

usage() {
  cat <<'EOF'
Usage: scripts/prep/download-raw.sh [all|flood|quake] [--force]

  all      建設局の浸水CSV 17件と都市整備局の地震SHPを取得（既定）
  flood    建設局の浸水CSV 17件だけ取得
  quake    都市整備局の地震SHPだけ取得
  --force  既存ファイルも再取得

保存先はリポジトリ直下の data/raw/ 固定です。
EOF
}

for arg in "$@"; do
  case "$arg" in
    all | flood | quake)
      scope="$arg"
      ;;
    --force)
      force=1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v curl >/dev/null || {
  echo "curl is required" >&2
  exit 1
}
command -v python3 >/dev/null || {
  echo "python3 is required" >&2
  exit 1
}

validate_download() {
  local path=$1
  local kind=$2

  if [[ ! -s "$path" ]]; then
    echo "Downloaded file is empty: $path" >&2
    return 1
  fi

  case "$kind" in
    csv)
      local prefix
      prefix=$(head -c 512 "$path" | tr '[:upper:]' '[:lower:]')
      if [[ "$prefix" == *"<html"* || "$prefix" == *"<!doctype"* ]]; then
        echo "The server returned HTML instead of CSV: $path" >&2
        return 1
      fi
      ;;
    zip)
      python3 -m zipfile -t "$path" >/dev/null
      ;;
  esac
}

download() {
  local url=$1
  local destination=$2
  local kind=$3
  local partial="${destination}.part"

  if [[ -s "$destination" && "$force" -eq 0 ]]; then
    echo "skip: ${destination#"$REPO_ROOT/"}"
    return
  fi

  mkdir -p -- "$(dirname -- "$destination")"
  echo "download: ${destination#"$REPO_ROOT/"}"
  curl \
    --fail \
    --location \
    --retry 3 \
    --retry-all-errors \
    --connect-timeout 20 \
    --silent \
    --show-error \
    "$url" \
    --output "$partial"
  validate_download "$partial" "$kind"
  mv -f -- "$partial" "$destination"
  sha256sum "$destination"
}

download_flood() {
  local base_r3="https://www.opendata.metro.tokyo.lg.jp/kensetsu/R3"
  local base_r4="https://www.opendata.metro.tokyo.lg.jp/kensetsu/R4"
  local filename

  local -a r3_files=(
    "shinsui_kandagawa.csv"
    "shinsui_sumidagawa.csv"
    "shinsui_syakujiigawa.csv"
    "shinsui_jyounantiku.csv"
    "shinsui_koutounaibu.csv"
    "shinsui_nogawa.csv"
    "shinsui_kuromegawa.csv"
    "shinsui_zanborigawa.csv"
    "shinsui_sakaigawa.csv"
    "shinsui_nakagawa.csv"
    "shinsui_tsurumigawa.csv"
    "shinsui_asakawa.csv"
    "shinsui_tamagawa.csv"
    "shinsui_akikawa.csv"
  )
  local -a r4_files=(
    "shinsui_akikawa(1).csv"
    "shinsui_akikawa(2).csv"
    "shinsui_akikawa(3).csv"
  )

  for filename in "${r3_files[@]}"; do
    download "$base_r3/$filename" "$FLOOD_DIR/$filename" csv
  done
  for filename in "${r4_files[@]}"; do
    download "$base_r4/$filename" "$FLOOD_DIR/$filename" csv
  done
}

download_quake() {
  # all2.csv は属性表だけで町丁目ポリゴンが無い。公式SHPを一次入力にする。
  download \
    "https://www.toshiseibi.metro.tokyo.lg.jp/bosai/chousa_6/download/all2.zip" \
    "$QUAKE_DIR/all2.zip" \
    zip
}

case "$scope" in
  all)
    download_flood
    download_quake
    ;;
  flood)
    download_flood
    ;;
  quake)
    download_quake
    ;;
esac

echo "Download completed."
