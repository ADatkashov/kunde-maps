#!/bin/sh
set -eu
# Public runtime configuration for the static web app. None of these values are credentials.
#   MAPS_TILE_URL    optional public HTTPS .pmtiles URL
#   MAPS_SEARCH_URL  optional public HTTPS origin of the Search API (no path, no query)
tile_json=''
search_json=''
if [ -n "${MAPS_TILE_URL:-}" ]; then
  # Restrict to simple public HTTPS PMTiles URLs; prevents JSON injection and
  # accidental disclosure of signed/private URLs in the public config endpoint.
  if ! printf '%s' "$MAPS_TILE_URL" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9_./%-]*[.]pmtiles([?][A-Za-z0-9_=&%-]+)?$'; then
    echo 'MAPS_TILE_URL must be a public HTTPS .pmtiles URL' >&2
    exit 1
  fi
  tile_json=$(printf ',"tileUrl":"%s"' "$MAPS_TILE_URL")
fi
if [ -n "${MAPS_SEARCH_URL:-}" ]; then
  if ! printf '%s' "$MAPS_SEARCH_URL" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$'; then
    echo 'MAPS_SEARCH_URL must be a public HTTPS origin such as https://search.example.com' >&2
    exit 1
  fi
  search_json=$(printf ',"searchUrl":"%s"' "${MAPS_SEARCH_URL%/}")
fi
printf '{"styleUrl":"/style.json"%s%s}\n' "$tile_json" "$search_json" > /srv/kunde-web/config.json

# Content-Security-Policy and friends, generated from the (already validated) public origins so the policy lists exactly the hosts
# the page talks to: our origin, the tile host, the Search API and the public glyph host. Nothing inline, nothing eval-able.
csp_file=${CSP_FILE:-/etc/nginx/security-headers.inc}
connect="'self' https://fonts.openmaptiles.org"
if [ -n "${MAPS_TILE_URL:-}" ]; then
  connect="$connect $(printf '%s' "$MAPS_TILE_URL" | sed -E 's#^(https://[^/]+)/.*#\1#')"
fi
if [ -n "${MAPS_SEARCH_URL:-}" ]; then
  connect="$connect ${MAPS_SEARCH_URL%/}"
fi
csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src $connect; worker-src blob:; child-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
mkdir -p "$(dirname "$csp_file")"
cat > "$csp_file" <<EOF
add_header Content-Security-Policy "$csp" always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header X-Frame-Options DENY always;
add_header Permissions-Policy "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" always;
add_header Strict-Transport-Security "max-age=31536000" always;
EOF
