#!/bin/sh
set -eu
# Optional public HTTPS tile archive and Search API endpoint.
tile_url="${MAPS_TILE_URL:-}"
search_url="${MAPS_SEARCH_URL:-}"
if [ -n "$tile_url" ] && ! printf '%s' "$tile_url" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9_./%-]*[.]pmtiles([?][A-Za-z0-9_=&%-]+)?$'; then
  echo 'MAPS_TILE_URL must be a public HTTPS .pmtiles URL' >&2
  exit 1
fi
if [ -n "$search_url" ] && ! printf '%s' "$search_url" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9_./%-]*([?][A-Za-z0-9_=&%-]+)?$'; then
  echo 'MAPS_SEARCH_URL must be a public HTTPS API endpoint' >&2
  exit 1
fi
python3 - "$tile_url" "$search_url" <<'PY'
import json
import sys
config = {"styleUrl": "/style.json"}
if sys.argv[1]:
    config["tileUrl"] = sys.argv[1]
if sys.argv[2]:
    config["searchUrl"] = sys.argv[2]
with open("/srv/kunde-web/config.json", "w", encoding="utf-8") as stream:
    json.dump(config, stream)
PY
