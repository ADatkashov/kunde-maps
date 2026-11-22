#!/usr/bin/env bash
set -euo pipefail
BASE="${MAP_BASE_URL:-http://127.0.0.1:8080}"
echo "Checking map web server: $BASE"
home_page="$(mktemp)"
trap 'rm -f "$home_page"' EXIT
curl --fail --silent --show-error --output "$home_page" "$BASE/"
grep -q 'KUNDE Maps' "$home_page"
curl --fail --silent --show-error "$BASE/style.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["version"]==8'
curl --fail --silent --show-error "$BASE/config.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["styleUrl"].startswith("http")'
if [ -f data/tiles/kazakhstan.pmtiles ]; then
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' -H 'Range: bytes=0-15' "$BASE/tiles/kazakhstan.pmtiles")"
  test "$status" = 206 || { echo "Expected HTTP 206 for PMTiles range, got $status"; exit 1; }
else
  echo "SKIP: PMTiles file absent; cannot validate range requests or rendering"
fi
echo "Local HTTP checks passed (not a browser rendering test)"
