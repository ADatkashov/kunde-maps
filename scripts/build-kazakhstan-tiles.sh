#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/osm data/tiles
PBF="data/osm/kazakhstan-latest.osm.pbf"
URL="https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf"
if [ ! -s "$PBF" ]; then
  echo "Downloading OSM Kazakhstan from Geofabrik..."
  curl --fail --location --retry 3 "$URL" --output "$PBF.tmp"
  mv "$PBF.tmp" "$PBF"
fi
echo "Input SHA256:"
sha256sum "$PBF"
echo "Generating vector tiles. Ensure sufficient disk space and RAM."
docker run --rm -v "$PWD/data:/data" ghcr.io/onthegomap/planetiler:latest \
  --osm-path=/data/osm/kazakhstan-latest.osm.pbf \
  --output=/data/tiles/kazakhstan.pmtiles \
  --force
echo "Created data/tiles/kazakhstan.pmtiles"
