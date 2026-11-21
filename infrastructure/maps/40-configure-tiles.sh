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
# Both values are validated against a restricted URL character set above.
printf '{"styleUrl":"/style.json"' > /srv/kunde-web/config.json
if [ -n "$tile_url" ]; then
  printf ',"tileUrl":"%s"' "$tile_url" >> /srv/kunde-web/config.json
fi
if [ -n "$search_url" ]; then
  printf ',"searchUrl":"%s"' "$search_url" >> /srv/kunde-web/config.json
fi
printf '}\\n' >> /srv/kunde-web/config.json
