#!/bin/bash
# Routing engine experiment: build a graph from a PBF, measure time/peak RAM/disk, serve it, run test routes.
# Usage: run-engine.sh ENGINE PBF OUT_DIR      ENGINE: osrm | valhalla | graphhopper
# Writes OUT_DIR/results.md (human summary) and OUT_DIR/routes-*.json. Needs docker (and java 17+ for graphhopper).
set -uo pipefail
engine=$1; pbf=$(readlink -f "$2"); out=$(readlink -f "$3"); mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
work=$out/work; mkdir -p "$work"; cp "$pbf" "$work/data.osm.pbf"
pbf_mb=$(du -m "$work/data.osm.pbf" | cut -f1)
report=$out/results.md
echo "### $engine ($(basename "$pbf"), ${pbf_mb} MB PBF, runner: $(nproc) CPU / $(free -g | awk '/Mem/{print $2}') GB RAM)" > "$report"
echo "| step | wall s | peak RAM MiB | disk MB |" >> "$report"; echo "|---|---|---|---|" >> "$report"

timed_container() {  # timed_container LABEL DISK_PATH IMAGE ENTRYPOINT-CMD...   (work dir mounted at /data)
  local label=$1 disk=$2 image=$3; shift 3
  local name="bench-$engine-$RANDOM" start end code peak
  start=$(date +%s)
  docker run -d --name "$name" --network host -v "$work:/data" --entrypoint bash "$image" -lc "$*" > /dev/null
  "$here/sample-mem.sh" "$name" "$out/peak.$name" &
  local sampler=$!
  code=$(docker wait "$name"); end=$(date +%s)
  wait $sampler 2>/dev/null
  peak=$(cat "$out/peak.$name" 2>/dev/null || echo 0)
  [ "$code" = 0 ] || { echo "BUILD STEP FAILED ($label, exit $code)"; docker logs --tail 40 "$name" 2>&1 | sed 's/^/  | /'; }
  docker rm "$name" > /dev/null
  echo "| $label | $((end - start)) | $peak | $(du -sm "$work/$disk" 2>/dev/null | cut -f1) |" >> "$report"
  return "$code"
}

serve_and_bench() {  # serve_and_bench LABEL PROFILE PORT READY_URL IMAGE ENTRYPOINT-CMD...
  local label=$1 profile=$2 port=$3 ready=$4 image=$5; shift 5
  local name="serve-$engine-$profile"
  docker run -d --name "$name" --network host -v "$work:/data" --entrypoint bash "$image" -lc "$*" > /dev/null
  for _ in $(seq 1 120); do curl -fs -o /dev/null "http://127.0.0.1:$port$ready" && break; sleep 1; done
  python3 "$here/bench.py" "$engine" "http://127.0.0.1:$port" "$profile" 20 > "$out/routes-$engine-$profile.json" || true
  local mem; mem=$(docker stats --no-stream --format '{{.MemUsage}}' "$name" | awk '{print $1}')
  echo "| serve $label (idle RAM after queries) | - | $mem | - |" >> "$report"
  docker logs --tail 5 "$name" 2>&1 | sed 's/^/  | /'
  docker rm -f "$name" > /dev/null
}

case $engine in
osrm)
  img=ghcr.io/project-osrm/osrm-backend:v5.27.1
  declare -A lua=([car]=car [foot]=foot [bike]=bicycle) port=([car]=5001 [foot]=5002 [bike]=5003)
  for p in car foot bike; do
    mkdir -p "$work/$p"; cp "$work/data.osm.pbf" "$work/$p/d.osm.pbf"
    timed_container "build $p (extract+partition+customize)" "$p" "$img" \
      "cd /data/$p && osrm-extract -p /opt/${lua[$p]}.lua d.osm.pbf && osrm-partition d.osrm && osrm-customize d.osrm" || continue
    serve_and_bench "$p" "$p" "${port[$p]}" "/route/v1/driving/76.94,43.23;76.95,43.24" "$img" \
      "cd /data/$p && osrm-routed --algorithm mld --port ${port[$p]} d.osrm"
  done ;;
valhalla)
  img=ghcr.io/gis-ops/docker-valhalla/valhalla:latest
  timed_container "build tiles (all profiles)" valhalla_tiles "$img" \
    "valhalla_build_config --mjolnir-tile-dir /data/valhalla_tiles --httpd-service-listen 'tcp://*:8002' > /data/valhalla.json && valhalla_build_tiles -c /data/valhalla.json /data/data.osm.pbf" || exit 0
  docker run -d --name serve-valhalla --network host -v "$work:/data" --entrypoint bash "$img" -lc "valhalla_service /data/valhalla.json 1" > /dev/null
  for _ in $(seq 1 120); do curl -fs -o /dev/null http://127.0.0.1:8002/status && break; sleep 1; done
  for p in car foot bike; do python3 "$here/bench.py" valhalla http://127.0.0.1:8002 "$p" 20 > "$out/routes-valhalla-$p.json" || true; done
  echo "| serve (RAM after queries, all profiles) | - | $(docker stats --no-stream --format '{{.MemUsage}}' serve-valhalla | awk '{print $1}') | - |" >> "$report"
  docker logs --tail 5 serve-valhalla 2>&1 | sed 's/^/  | /'; docker rm -f serve-valhalla > /dev/null ;;
graphhopper)
  ver=10.2
  curl -fsSL -o "$work/gh.jar" "https://github.com/graphhopper/graphhopper/releases/download/$ver/graphhopper-web-$ver.jar" || { echo "jar download failed"; exit 0; }
  curl -fsSL -o "$work/config.yml" "https://raw.githubusercontent.com/graphhopper/graphhopper/$ver/config-example.yml" || { echo "config download failed"; exit 0; }
  python3 "$here/gh-config.py" "$work/config.yml" "$work/data.osm.pbf" "$work/graph-cache" || exit 0
  start=$(date +%s)
  ( cd "$work" && /usr/bin/time -v java -Xmx6g -jar gh.jar import config.yml > "$out/gh-import.log" 2> "$out/gh-import.time" )
  end=$(date +%s)
  rss=$(awk -F: '/Maximum resident/{printf "%d",$2/1024}' "$out/gh-import.time")
  echo "| build all profiles (import) | $((end - start)) | $rss | $(du -sm "$work/graph-cache" | cut -f1) |" >> "$report"
  ( cd "$work" && java -Xmx2g -jar gh.jar server config.yml > "$out/gh-server.log" 2>&1 ) &
  srv=$!
  for _ in $(seq 1 120); do curl -fs -o /dev/null http://127.0.0.1:8989/health && break; sleep 1; done
  for p in car foot bike; do python3 "$here/bench.py" graphhopper http://127.0.0.1:8989 "$p" 20 > "$out/routes-graphhopper-$p.json" || true; done
  pid=$(pgrep -f 'gh.jar server' | head -1); echo "| serve (RSS after queries, -Xmx2g) | - | $(awk '/VmRSS/{printf "%d",$2/1024}' /proc/$pid/status) | - |" >> "$report"
  kill $srv 2>/dev/null; pkill -f 'gh.jar server' || true ;;
*) echo "unknown engine $engine"; exit 2 ;;
esac
echo >> "$report"
for f in "$out"/routes-*.json; do [ -s "$f" ] && python3 - "$f" >> "$report" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(f"\n{d['engine']} / {d['profile']}:")
for r in d["routes"]:
    print("-", r["route"], (f"{r['km']} km, {r['min']} min, p50 {r['p50_ms']} ms (max {r['max_ms']} ms)" if "km" in r else "ERROR " + r["error"]))
PY
done
cat "$report"
