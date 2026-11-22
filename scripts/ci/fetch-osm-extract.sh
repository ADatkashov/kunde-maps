#!/bin/sh
# Download the Geofabrik Kazakhstan extract and verify its MD5. Usage: fetch-osm-extract.sh DEST_DIR
# Tries "latest" first, then dated files for the last 7 days under both known path layouts. Writes DEST_DIR/SOURCE_URL.
# Env: GEOFABRIK_BASE (default https://download.geofabrik.de/asia), TODAY (YYYY-MM-DD, tests), MIN_BYTES (default 50000000).
set -eu
dest=${1:?destination directory}
base=${GEOFABRIK_BASE:-https://download.geofabrik.de/asia}
min=${MIN_BYTES:-50000000}
today=${TODAY:-$(date -u +%Y-%m-%d)}
mkdir -p "$dest"

ok() {  # ok URL : the object exists (after redirects)
  code=$(curl --silent --head --location --output /dev/null --write-out '%{http_code}' --max-time 60 "$1" || echo 000)
  [ "$code" = 200 ]
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
    size=$(stat -c '%s' "$dest/kazakhstan.osm.pbf")
    if [ "$size" -le "$min" ]; then echo "Extract is only $size bytes (not a PBF)" >&2; head -c 300 "$dest/kazakhstan.osm.pbf" >&2; exit 1; fi
    expected=$(awk '{print $1}' "$dest/kazakhstan.osm.pbf.md5")
    actual=$(md5sum "$dest/kazakhstan.osm.pbf" | awk '{print $1}')
    [ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "MD5 mismatch: expected '$expected' got '$actual'" >&2; exit 1; }
    printf '%s\n' "$url" > "$dest/SOURCE_URL"
    exit 0
  fi
  echo "Not available: $url"
done
echo "No Geofabrik Kazakhstan extract found among candidates" >&2
exit 1
