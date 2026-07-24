#!/usr/bin/env bash
set -euo pipefail

DEFAULT_GAS_SONGS_API_URL="https://script.google.com/macros/s/AKfycbyR0J5IjXT7lZjDT7SAIkM4TW8SP1k0iNy3wW0Q2YhIGON6ugsvdffm0zYI1cJzgIoP/exec?api=songs"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL:-$DEFAULT_GAS_SONGS_API_URL}"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL//$'\r'/}"
GAS_SONGS_API_URL="${GAS_SONGS_API_URL//$'\n'/}"

: "${R2_ENDPOINT_URL:?R2_ENDPOINT_URL is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_OBJECT_KEY:?R2_OBJECT_KEY is required}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

tmp_json="$(mktemp)"
tmp_r2="$(mktemp)"
run_id="$(date +%Y%m%d%H%M%S)"
verify_key="${R2_OBJECT_KEY%.json}.verify.${run_id}.json"
verify_uri="s3://${R2_BUCKET}/${verify_key}"
uploaded_verify_object=0

cleanup() {
  local exit_status=$?

  rm -f -- "$tmp_json" "$tmp_r2"

  if [[ "$uploaded_verify_object" -eq 1 ]]; then
    aws s3 rm "$verify_uri" --endpoint-url "$R2_ENDPOINT_URL" >/dev/null 2>&1 || {
      echo "Warning: 検証用オブジェクトの削除に失敗しました: $verify_uri" >&2
      true
    }
  fi

  exit "$exit_status"
}

trap cleanup EXIT

echo "[1/3] GASレスポンス・データ契約検証"
GAS_SONGS_API_URL="$GAS_SONGS_API_URL" \
SNAPSHOT_FILE="$tmp_json" \
node scripts/build_songs_snapshot.mjs

echo "[2/3] R2アップロード検証: $verify_uri"
aws s3 cp "$tmp_json" "$verify_uri" \
  --endpoint-url "$R2_ENDPOINT_URL" \
  --content-type "application/json" \
  --cache-control "no-cache" \
  --no-progress
uploaded_verify_object=1

echo "[3/3] R2読み取り・内容照合"
aws s3 cp "$verify_uri" "$tmp_r2" \
  --endpoint-url "$R2_ENDPOINT_URL" \
  --no-progress

if ! cmp -s "$tmp_json" "$tmp_r2"; then
  echo "R2から読み戻した内容がアップロード元と一致しません。" >&2
  exit 1
fi

if [[ -n "${WORKER_BASE_URL:-}" ]]; then
  echo "Note: WORKER_BASE_URL は廃止済みのため無視します（R2検証のみ実施）。"
fi

echo "検証完了: データ契約・upload・read-backはすべて正常です。"
