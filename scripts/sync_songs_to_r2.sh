#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${R2_ENDPOINT_URL:-}" || -z "${R2_BUCKET:-}" || -z "${R2_OBJECT_KEY:-}" ]]; then
  echo "R2_ENDPOINT_URL / R2_BUCKET / R2_OBJECT_KEY are required" >&2
  exit 1
fi

snapshot_file="${SNAPSHOT_FILE:-songs.generated.json}"
remote_uri="s3://${R2_BUCKET}/${R2_OBJECT_KEY}"
max_attempts="${UPLOAD_MAX_ATTEMPTS:-3}"
debug_enabled="${DEBUG_SYNC:-0}"

if [[ "$debug_enabled" == "1" ]]; then
  set -x
fi

if [[ ! -s "$snapshot_file" ]]; then
  echo "Snapshot file is missing or empty: $snapshot_file" >&2
  echo "Run scripts/build_songs_snapshot.mjs before this script." >&2
  exit 1
fi

if ! [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
  echo "UPLOAD_MAX_ATTEMPTS must be a positive integer" >&2
  exit 1
fi

read_valid_data_version() {
  node --input-type=module -e '
    import { createHash } from "node:crypto";
    import { readFileSync } from "node:fs";

    const data = JSON.parse(readFileSync(process.argv[1], "utf8"));
    if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
      throw new Error("snapshot.items must be an array");
    }
    if (!Number.isInteger(data.total) || data.total !== data.items.length) {
      throw new Error("snapshot.total must match snapshot.items.length");
    }
    if (data.schemaVersion !== 1) {
      throw new Error("snapshot.schemaVersion must be 1");
    }

    const canonical = JSON.stringify({
      schemaVersion: data.schemaVersion,
      items: data.items,
    });
    const expected = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    if (data.dataVersion !== expected) {
      throw new Error("snapshot.dataVersion does not match snapshot content");
    }
    process.stdout.write(expected);
  ' "$1"
}

upload_with_retry() {
  local attempt
  local delay_seconds

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    echo "Upload attempt ${attempt}/${max_attempts}: $remote_uri"
    if aws s3 cp "$snapshot_file" "$remote_uri" \
      --endpoint-url "$R2_ENDPOINT_URL" \
      --content-type "application/json" \
      --cache-control "no-cache" \
      --no-progress; then
      return 0
    fi

    if ((attempt < max_attempts)); then
      delay_seconds=$((attempt * 10))
      echo "Upload failed. Retrying in ${delay_seconds} seconds..." >&2
      sleep "$delay_seconds"
    fi
  done

  return 1
}

download_with_retry() {
  local destination="$1"
  local attempt
  local delay_seconds

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    if aws s3 cp "$remote_uri" "$destination" \
      --endpoint-url "$R2_ENDPOINT_URL" \
      --no-progress; then
      return 0
    fi

    if ((attempt < max_attempts)); then
      delay_seconds=$((attempt * 5))
      echo "Read-back failed. Retrying in ${delay_seconds} seconds..." >&2
      sleep "$delay_seconds"
    fi
  done

  return 1
}

local_data_version="$(read_valid_data_version "$snapshot_file")"
remote_current="$(mktemp)"
remote_verify="$(mktemp)"
trap 'rm -f -- "$remote_current" "$remote_verify"' EXIT

echo "Check current R2 snapshot..."
if aws s3 cp "$remote_uri" "$remote_current" \
  --endpoint-url "$R2_ENDPOINT_URL" \
  --no-progress >/dev/null 2>&1; then
  if remote_data_version="$(read_valid_data_version "$remote_current" 2>/dev/null)"; then
    if [[ "$remote_data_version" == "$local_data_version" ]]; then
      echo "No content change: $local_data_version"
      echo "R2 upload skipped."
      exit 0
    fi
  else
    echo "Warning: the current R2 object is invalid; it will be replaced." >&2
  fi
else
  echo "Current R2 object could not be read; continuing with upload."
fi

if ! upload_with_retry; then
  echo "R2 upload failed after ${max_attempts} attempts: $remote_uri" >&2
  exit 1
fi

echo "Verify uploaded snapshot..."
if ! download_with_retry "$remote_verify"; then
  echo "Could not read back the uploaded snapshot: $remote_uri" >&2
  exit 1
fi

verified_data_version="$(read_valid_data_version "$remote_verify")"
if [[ "$verified_data_version" != "$local_data_version" ]]; then
  echo "Uploaded dataVersion does not match the local snapshot." >&2
  exit 1
fi
if ! cmp -s "$snapshot_file" "$remote_verify"; then
  echo "Uploaded object bytes do not match the local snapshot." >&2
  exit 1
fi

echo "Done. uploaded and verified: $remote_uri"
echo "dataVersion: $local_data_version"

if [[ -n "${R2_PUBLIC_BASE_URL:-}" ]]; then
  public_base_url="${R2_PUBLIC_BASE_URL%/}"
  object_key_no_leading_slash="${R2_OBJECT_KEY#/}"
  echo "Public URL: ${public_base_url}/${object_key_no_leading_slash}"
fi
