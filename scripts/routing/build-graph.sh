#!/bin/bash
# Build the production Valhalla graph for Kazakhstan: BUILD_DIR/valhalla-tiles.tar (+ .sha256, PROVENANCE.txt).
# Usage: build-graph.sh PBF OUT_DIR [SOURCE_URL]. Needs docker. The tar is a single mmap-able tile extract (what the service serves from).
set -euo pipefail
pbf=$(readlink -f "$1"); out=$(readlink -f "$2"); source_url=${3:-unknown}
img=${VALHALLA_IMAGE:-ghcr.io/gis-ops/docker-valhalla/valhalla:latest}
work=$out/work; mkdir -p "$work"; cp "$pbf" "$work/data.osm.pbf"; chmod -R a+rwX "$work"
docker run --rm --network none -v "$work:/data" --entrypoint bash "$img" -lc '
  set -euo pipefail
  valhalla_build_config --mjolnir-tile-dir /data/tiles --mjolnir-tile-extract /data/valhalla-tiles.tar > /data/build.json
  valhalla_build_tiles -c /data/build.json /data/data.osm.pbf
  valhalla_build_extract -c /data/build.json -v
' 2>&1 | tail -15
test -s "$work/valhalla-tiles.tar"
mv "$work/valhalla-tiles.tar" "$out/valhalla-tiles.tar"
(cd "$out" && sha256sum valhalla-tiles.tar | awk '{print $1}' > valhalla-tiles.sha256)
cat > "$out/PROVENANCE.txt" <<EOF
KUNDE Maps routing graph (Valhalla tile extract)
Source data: OpenStreetMap contributors, extract $source_url
Licence: Open Database License (ODbL) 1.0 - https://opendatacommons.org/licenses/odbl/ ; attribution: (c) OpenStreetMap contributors
Built: $(date -u +%Y-%m-%dT%H:%M:%SZ) with image $img
Profiles: auto, pedestrian, bicycle (no traffic, no restrictions beyond OSM tags)
SHA256: $(cat "$out/valhalla-tiles.sha256")
EOF
ls -l "$out"
