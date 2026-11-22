"""KUNDE Maps routing API: an authenticated, rate-limited front for a localhost-only Valhalla process.

Valhalla itself has no authentication, so it is never exposed: it listens on 127.0.0.1 inside the container and this server is the only
public endpoint (same protections as the Search API: per-IP token bucket, API keys with quotas, concurrency gate, safe metrics, CORS allowlist).
Never logs or stores coordinates, IPs or routes.
"""
import json
import math
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import apikeys
import polyline
from protection import BusyError, ConcurrencyGate, Metrics, TokenBuckets, client_ip, env_int

PORT = int(os.environ.get("PORT", "8082"))
VALHALLA_URL = os.environ.get("MAPS_VALHALLA_URL", "http://127.0.0.1:8002")
VALHALLA_TIMEOUT = 20
ALLOWED_ORIGINS = {"https://kunde-maps-web-dev.onrender.com"}
# Kazakhstan bounding box (the graph covers the country only): reject everything else early with a clear error.
BBOX = (46.4, 40.5, 87.4, 55.6)  # min_lon, min_lat, max_lon, max_lat
MIN_DISTANCE_M = 10
MODES = {"car": "auto", "foot": "pedestrian", "bike": "bicycle"}
LANGUAGES = {"ru": "ru-RU", "kk": "ru-RU", "en": "en-US"}  # Valhalla has no Kazakh narrative: kk falls back to Russian (reported in the reply)
RATE_PER_MINUTE = env_int(os.environ, "MAPS_RATE_LIMIT_PER_MINUTE", 60, 1, 100000)
RATE_BURST = env_int(os.environ, "MAPS_RATE_LIMIT_BURST", 20, 1, 10000)
MAX_CONCURRENT = env_int(os.environ, "MAPS_MAX_CONCURRENT_ROUTES", 6, 1, 64)
TRUSTED_HOPS = env_int(os.environ, "MAPS_TRUSTED_PROXY_HOPS", 1, 0, 5)
METRICS_TOKEN = os.environ.get("MAPS_METRICS_TOKEN", "")
SIMPLIFY_TOLERANCE_DEG = 0.00004  # ~4 m: invisible on a map, cuts long routes by an order of magnitude
ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
NOTE = "Typical travel time from OpenStreetMap speed data; no traffic, closures or live conditions."

LIMITER = TokenBuckets(RATE_PER_MINUTE, RATE_BURST)
try:
    KEYRING = apikeys.KeyRing(apikeys.parse(os.environ.get("MAPS_API_KEYS", "")))
except ValueError as exc:
    raise SystemExit(f"MAPS_API_KEYS invalid: {exc}")
KEY_LIMITERS = {name: TokenBuckets(rate, max(20, rate // 4)) for name, rate in KEYRING.limits().items()}
GATE = ConcurrencyGate(MAX_CONCURRENT)
METRICS = Metrics()


# Valhalla error codes that are the caller's situation rather than a fault: 442 no path, 170 unconnected regions,
# 171 no suitable road near a point, 154 over the configured distance limit.
VALHALLA_ERRORS = {442: "no_route", 170: "no_route", 171: "no_road_near_point", 154: "route_too_long"}


class RouteError(Exception):
    def __init__(self, status, code, extra=None):
        super().__init__(code)
        self.status, self.code, self.extra = status, code, extra or {}


def parse_point(value, name):
    parts = (value or "").split(",")
    if len(parts) != 2:
        raise RouteError(400, f"{name}_must_be_lat,lon")
    try:
        lat, lon = float(parts[0]), float(parts[1])
    except ValueError:
        raise RouteError(400, f"{name}_must_be_lat,lon") from None
    if not (math.isfinite(lat) and math.isfinite(lon)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise RouteError(400, f"{name}_out_of_range")
    if not (BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]):
        raise RouteError(400, "outside_coverage", {"coverage": "Kazakhstan"})
    return lat, lon


def haversine_m(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1.0, math.sqrt(h)))


def valhalla_request(payload):
    request = urllib.request.Request(VALHALLA_URL + "/route", json.dumps(payload).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=VALHALLA_TIMEOUT) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        try:
            body = json.load(err)
        except Exception:
            body = {}
        kind = VALHALLA_ERRORS.get(body.get("error_code"))
        if kind:
            raise RouteError(400 if kind == "route_too_long" else 404, kind) from None
        raise RouteError(502, "routing_unavailable") from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise RouteError(502, "routing_unavailable") from None


def route(origin, destination, mode, lang):
    payload = {"locations": [{"lat": origin[0], "lon": origin[1]}, {"lat": destination[0], "lon": destination[1]}],
               "costing": MODES[mode], "units": "kilometers", "language": LANGUAGES[lang], "directions_type": "instructions"}
    data = valhalla_request(payload)
    try:
        trip = data["trip"]
        leg = trip["legs"][0]
        points = polyline.decode(leg["shape"])
        kept = polyline.simplify(points, SIMPLIFY_TOLERANCE_DEG)
        steps = []
        for m in leg.get("maneuvers", []):
            idx = int(m.get("begin_shape_index", 0))
            if not 0 <= idx < len(points):
                continue
            lat, lon = points[idx]
            steps.append({"instruction": str(m.get("instruction", ""))[:300], "type": int(m.get("type", 0)),
                          "street": (m.get("street_names") or [""])[0][:120], "distance_m": round(float(m.get("length", 0)) * 1000),
                          "duration_s": round(float(m.get("time", 0))), "location": [round(lon, 6), round(lat, 6)]})
        summary = trip["summary"]
        lons = [p[1] for p in points]
        lats = [p[0] for p in points]
        return {
            "mode": mode, "distance_m": round(float(summary["length"]) * 1000), "duration_s": round(float(summary["time"])),
            "geometry": {"type": "LineString", "coordinates": [[round(points[i][1], 6), round(points[i][0], 6)] for i in kept]},
            "bbox": [min(lons), min(lats), max(lons), max(lats)], "steps": steps,
            "instruction_language": "ru" if lang == "kk" else lang, "note": NOTE, "attribution": ATTRIBUTION, "engine": "valhalla",
        }
    except (KeyError, IndexError, TypeError, ValueError):
        raise RouteError(502, "routing_unavailable") from None


def valhalla_ready():
    try:
        with urllib.request.urlopen(VALHALLA_URL + "/status", timeout=2):
            return True
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    timeout = 15
    _code = 0

    def log_message(self, format, *args):
        pass  # never log URLs: they contain coordinates

    def do_GET(self):
        started = time.perf_counter()
        route_name = "other"
        try:
            route_name = self._dispatch()
        finally:
            elapsed = time.perf_counter() - started
            METRICS.observe(route_name, self._code, elapsed)
            if route_name != "health":
                print(json.dumps({"route": route_name, "status": self._code, "ms": round(elapsed * 1000, 1)}), flush=True)

    def do_OPTIONS(self):
        self.reply(204, None)

    def _dispatch(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            ready = valhalla_ready()
            self.reply(200 if ready else 503, {"status": "ok" if ready else "not_ready", "engine_ready": ready})
            return "health"
        if parsed.path == "/metrics":
            token = self.headers.get("Authorization", "")
            if not METRICS_TOKEN or token != f"Bearer {METRICS_TOKEN}":
                self.reply(404, {"error": "not_found"})
            else:
                self.reply_raw(200, METRICS.render().encode(), "text/plain; version=0.0.4")
            return "metrics"
        if parsed.path != "/v1/route":
            self.reply(404, {"error": "not_found"})
            return "other"
        ip = client_ip(self.headers.get("X-Forwarded-For"), self.client_address[0], TRUSTED_HOPS)
        presented = self.headers.get("X-API-Key")
        if presented is not None:
            key = KEYRING.lookup(presented)
            if key is None:
                METRICS.incr("invalid_keys")
                self.reply(401, {"error": "invalid_api_key"})
                return "route"
            METRICS.key_used(key[0])
            allowed, retry = KEY_LIMITERS[key[0]].check(key[0])
        else:
            allowed, retry = LIMITER.check(ip)
        if not allowed:
            METRICS.incr("rate_limited")
            self.reply(429, {"error": "rate_limited", "retry_after": retry}, {"Retry-After": str(retry)})
            return "route"
        params = parse_qs(parsed.query)
        try:
            origin = parse_point(params.get("from", [""])[0], "from")
            destination = parse_point(params.get("to", [""])[0], "to")
            mode = params.get("mode", ["car"])[0]
            lang = params.get("lang", ["ru"])[0]
            if mode not in MODES:
                raise RouteError(400, "mode_must_be_car_foot_or_bike")
            if lang not in LANGUAGES:
                raise RouteError(400, "lang_must_be_ru_kk_or_en")
            if haversine_m(origin, destination) < MIN_DISTANCE_M:
                raise RouteError(400, "points_too_close")
            with GATE:
                result = route(origin, destination, mode, lang)
            self.reply(200, result)
        except RouteError as err:
            self.reply(err.status, {"error": err.code, **err.extra}, {"Retry-After": "5"} if err.status == 502 else None)
        except BusyError:
            METRICS.incr("busy")
            self.reply(503, {"error": "busy"}, {"Retry-After": "1"})
        return "route"

    def reply(self, code, payload, headers=None):
        body = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.reply_raw(code, body, "application/json; charset=utf-8", headers)

    def reply_raw(self, code, body, content_type, headers=None):
        self._code = code
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        origin = self.headers.get("Origin")
        self.send_header("Vary", "Origin")
        if origin in ALLOWED_ORIGINS:  # CORS is a browser policy, not authentication: abuse is limited by the limits above
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Access-Control-Expose-Headers", "Retry-After")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_valhalla(graph_path):
    """Run Valhalla bound to loopback with generous distance limits; returns the child process."""
    config = subprocess.run(
        ["valhalla_build_config", "--mjolnir-tile-extract", graph_path, "--mjolnir-tile-dir", "/tmp/unused",
         "--httpd-service-listen", "tcp://127.0.0.1:8002",
         "--service-limits-auto-max-distance", "2500000", "--service-limits-pedestrian-max-distance", "500000",
         "--service-limits-bicycle-max-distance", "1000000"], check=True, capture_output=True, text=True).stdout
    path = "/tmp/valhalla.json"
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(config)
    return subprocess.Popen(["valhalla_service", path, "1"])


def main():
    graph = os.environ.get("MAPS_ROUTING_GRAPH", "/data/valhalla-tiles.tar")
    if not os.path.isfile(graph):
        raise SystemExit(f"routing graph missing: {graph} (run provision_graph.py first)")
    child = start_valhalla(graph)

    def watchdog():  # if Valhalla dies the service is useless: exit so the platform restarts the container
        child.wait()
        print(json.dumps({"event": "valhalla_exited", "code": child.returncode}), flush=True)
        os._exit(1)
    threading.Thread(target=watchdog, daemon=True).start()
    for _ in range(120):
        if valhalla_ready():
            break
        time.sleep(1)
    else:
        raise SystemExit("Valhalla did not become ready")
    print(json.dumps({"event": "ready", "port": PORT}), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    sys.exit(main())
