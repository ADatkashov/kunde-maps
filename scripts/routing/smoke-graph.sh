#!/bin/bash
# Smoke test of a built graph: serve valhalla-tiles.tar with Valhalla and route car/foot/bike across Almaty (real landmarks).
# Usage: smoke-graph.sh DIR_WITH_valhalla-tiles.tar
set -euo pipefail
dir=$(readlink -f "$1"); img=${VALHALLA_IMAGE:-ghcr.io/gis-ops/docker-valhalla/valhalla:latest}
name=smoke-valhalla-$$
chmod a+r "$dir/valhalla-tiles.tar"
docker run -d --name "$name" --network host -v "$dir:/data:ro" --entrypoint bash "$img" -lc '
  valhalla_build_config --mjolnir-tile-extract /data/valhalla-tiles.tar --mjolnir-tile-dir /tmp/none --httpd-service-listen "tcp://127.0.0.1:8002" > /tmp/serve.json
  exec valhalla_service /tmp/serve.json 1' > /dev/null
trap 'docker rm -f "$name" > /dev/null 2>&1 || true' EXIT
for _ in $(seq 1 90); do curl -fs -o /dev/null http://127.0.0.1:8002/status && break; sleep 1; done
curl -fs http://127.0.0.1:8002/status | head -c 300; echo
for costing in auto pedestrian bicycle; do
  body='{"locations":[{"lat":43.2380,"lon":76.9456},{"lat":43.2610,"lon":76.9567}],"costing":"'$costing'","units":"kilometers"}'
  out=$(curl -fs -X POST http://127.0.0.1:8002/route -H 'Content-Type: application/json' -d "$body")
  python3 - "$costing" "$out" <<'PY'
import json, sys
costing, data = sys.argv[1], json.loads(sys.argv[2])
summary = data["trip"]["summary"]
km, minutes = summary["length"], summary["time"] / 60
print(f"{costing}: {km:.2f} km, {minutes:.1f} min")
assert 2.5 < km < 6.0, "Republic Square -> Green Bazaar should be ~3.5 km"
assert 3 < minutes < 90
PY
done
echo "graph smoke test OK"
