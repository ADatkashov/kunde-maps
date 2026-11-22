#!/bin/sh
# Download the Geofabrik Kazakhstan extract and verify its MD5. Usage: fetch-osm-extract.sh DEST_DIR
# Tries "latest" first, then dated files for the last 7 days under both known path layouts. Writes DEST_DIR/SOURCE_URL.
# Env: GEOFABRIK_BASE (default https://download.geofabrik.de/asia), TODAY (YYYY-MM-DD, tests), MIN_BYTES (default 50000000),
#      OSM_CACHE_DIR (optional: last good extract; stored after a successful download, used when Geofabrik is unreachable).
set -eu
dest=${1:?destination directory}
base=${GEOFABRIK_BASE:-https://download.geofabrik.de/asia}
min=${MIN_BYTES:-50000000}
today=${TODAY:-$(date -u +%Y-%m-%d)}
mkdir -p "$dest"

cache=${OSM_CACHE_DIR:-}
last_code=000
ok() {  # ok URL : the object exists (after redirects); remembers the HTTP status for diagnostics
  last_code=$(curl --silent --head --location --output /dev/null --write-out '%{http_code}' --max-time 60 "$1" || echo 000)
  [ "$last_code" = 200 ]
}
verify() {  # verify DIR : size and MD5 of a downloaded or cached extract
  size=$(stat -c '%s' "$1/kazakhstan.osm.pbf")
  if [ "$size" -le "$min" ]; then echo "Extract is only $size bytes (not a PBF)" >&2; head -c 300 "$1/kazakhstan.osm.pbf" >&2; return 1; fi
  expected=$(awk '{print $1}' "$1/kazakhstan.osm.pbf.md5")
  actual=$(md5sum "$1/kazakhstan.osm.pbf" | awk '{print $1}')
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "MD5 mismatch: expected '$expected' got '$actual'" >&2; return 1; }
}
fetch() {
  curl --fail --location --silent --show-error --retry 5 --retry-all-errors --retry-delay 10 --max-time 1800 \
    --write-out '%{http_code} %{size_download} bytes <- %{url_effective}\n' --output "$2" "$1"
}

candidates="$base/kazakhstan-latest.osm.pbf"
i=0
while [ "$i" -le 7 ]; do
  d=$(date -u -d "$today - $i day" +%y%m%d)
  candidates="$candidates $base/kazakhstan-$d.osm.pbf $base/kazakhstan/kazakhstan-$d.osm.pbf"
  i=$((i + 1))
done

for url in $candidates; do
  if ok "$url" && ok "$url.md5"; then
    echo "Using $url"
    fetch "$url" "$dest/kazakhstan.osm.pbf"
    fetch "$url.md5" "$dest/kazakhstan.osm.pbf.md5"
    verify "$dest" || exit 1
    printf '%s\n' "$url" > "$dest/SOURCE_URL"
    if [ -n "$cache" ]; then
      mkdir -p "$cache" && cp "$dest/kazakhstan.osm.pbf" "$dest/kazakhstan.osm.pbf.md5" "$dest/SOURCE_URL" "$cache/" && echo "Cached the extract in $cache"
    fi
    exit 0
  fi
  echo "Not available (HTTP $last_code): $url"
done
# Geofabrik unreachable or restructured: fall back to the last verified extract, loudly, and record that in the source URL.
if [ -n "$cache" ] && [ -f "$cache/kazakhstan.osm.pbf" ] && [ -f "$cache/SOURCE_URL" ]; then
  if verify "$cache"; then
    echo "WARNING: no Geofabrik extract reachable; using the cached extract of $(cat "$cache/SOURCE_URL")" >&2
    cp "$cache/kazakhstan.osm.pbf" "$cache/kazakhstan.osm.pbf.md5" "$dest/"
    printf 'cache of %s\n' "$(cat "$cache/SOURCE_URL")" > "$dest/SOURCE_URL"
    exit 0
  fi
fi
echo "No Geofabrik Kazakhstan extract found among candidates" >&2
exit 1
