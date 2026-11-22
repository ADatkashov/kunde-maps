#!/bin/bash
# End-to-end test of the routing API container with a real graph: provisions valhalla-tiles.tar over (loopback) HTTP with checksum
# verification, starts Valhalla + the authenticated front and checks real routes. Usage: integration-api.sh GRAPH_DIR [IMAGE]
set -euo pipefail
dir=$(readlink -f "$1"); image=${2:-kunde-routing:ci}
(cd "$dir" && exec python3 -m http.server 8099 --bind 127.0.0.1 > /tmp/graph-http.log 2>&1) &
httpd=$!
cleanup() { kill $httpd 2>/dev/null || true; docker rm -f kunde-routing-it > /dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name kunde-routing-it --network host -e PORT=10000 \
  -e MAPS_ROUTING_GRAPH_URL=http://127.0.0.1:8099/valhalla-tiles.tar -e MAPS_ROUTING_MIN_BYTES=1000000 \
  -e MAPS_RATE_LIMIT_PER_MINUTE=600 -e MAPS_RATE_LIMIT_BURST=100 "$image" > /dev/null
for _ in $(seq 1 120); do curl -fs -o /dev/null http://127.0.0.1:10000/health && break; sleep 1; done
curl -fs http://127.0.0.1:10000/health; echo
get() { curl -s -o /tmp/it.json -w '%{http_code}' "http://127.0.0.1:10000$1"; }
check() {  # check NAME MODE MIN_KM MAX_KM
  code=$(get "/v1/route?from=43.2380,76.9456&to=43.3521,77.0405&mode=$2&lang=en")
  python3 - "$1" "$code" "$3" "$4" <<'PY'
import json, sys
name, code, lo, hi = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
body = json.load(open("/tmp/it.json"))
assert code == 200, (name, code, body)
km, minutes = body["distance_m"] / 1000, body["duration_s"] / 60
print(f"{name}: {km:.1f} km, {minutes:.0f} min, {len(body['geometry']['coordinates'])} points, {len(body['steps'])} steps")
print("  first steps:", json.dumps(body["steps"][:3], ensure_ascii=False))
assert lo < km < hi, "distance out of the plausible range"
assert body["steps"] and body["steps"][0]["instruction"], "no turn-by-turn steps"
assert body["geometry"]["coordinates"][0][0] > 76 and body["note"] and "OpenStreetMap" in body["attribution"]
PY
}
check "car Republic Square -> airport" car 17 25
check "foot" foot 15 25
check "bike" bike 15 25
test "$(get '/v1/route?from=48.85,2.35&to=43.2,76.9')" = 400
grep -q outside_coverage /tmp/it.json
test "$(get '/v1/route?from=43.2380,76.9456&to=43.2380,76.9456')" = 400
test "$(get '/metrics')" = 404
echo "routing API integration OK"
docker logs kunde-routing-it 2>&1 | grep -E 'coordinates|43\.2|76\.9' && { echo "coordinates leaked into logs"; exit 1; } || true
