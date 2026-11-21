#!/bin/sh
set -eu
# Optional public tile URL. This value is not a credential.
if [ -z "${MAPS_TILE_URL:-}" ]; then
  printf '{"styleUrl":"/style.json"}\n' > /srv/kunde-web/config.json
  exit 0
fi
# Restrict to simple public HTTPS PMTiles URLs; prevents JSON injection and
# accidental disclosure of signed/private URLs in the public config endpoint.
if ! printf '%s' "$MAPS_TILE_URL" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9_./%-]*[.]pmtiles([?][A-Za-z0-9_=&%-]+)?$'; then
  echo 'MAPS_TILE_URL must be a public HTTPS .pmtiles URL' >&2
  exit 1
fi
printf '{"styleUrl":"/style.json","tileUrl":"%s"}\n' "$MAPS_TILE_URL" > /srv/kunde-web/config.json
