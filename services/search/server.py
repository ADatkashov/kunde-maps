"""KUNDE Maps search API: SQLite FTS5, offline-generated index, no public geocoder."""
import hmac
import json
import math
import os
import re
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import places
import textnorm
import addresses
import apikeys
from protection import BusyError, ConcurrencyGate, Metrics, TokenBuckets, client_ip, env_int

DB_PATH = Path(os.environ.get("MAPS_SEARCH_DB", "/data/search.sqlite3"))
PORT = int(os.environ.get("PORT", "8081"))
DEFAULT_LIMIT = 10
MAX_RESULTS = 20
ALLOWED_ORIGINS = {"https://kunde-maps-web-dev.onrender.com"}
# Abuse protection (all configurable; see docs/search-prototype.md).
RATE_PER_MINUTE = env_int(os.environ, "MAPS_RATE_LIMIT_PER_MINUTE", 120, 1, 100000)
RATE_BURST = env_int(os.environ, "MAPS_RATE_LIMIT_BURST", 30, 1, 10000)
MAX_CONCURRENT = env_int(os.environ, "MAPS_MAX_CONCURRENT_SEARCHES", 16, 1, 256)
TRUSTED_HOPS = env_int(os.environ, "MAPS_TRUSTED_PROXY_HOPS", 1, 0, 5)
METRICS_TOKEN = os.environ.get("MAPS_METRICS_TOKEN", "")
LIMITER = TokenBuckets(RATE_PER_MINUTE, RATE_BURST)
try:
    KEYRING = apikeys.KeyRing(apikeys.parse(os.environ.get("MAPS_API_KEYS", "")))
except ValueError as exc:  # fail closed at startup: a typo must not silently disable keys or quotas
    raise SystemExit(f"MAPS_API_KEYS invalid: {exc}")
KEY_LIMITERS = {name: TokenBuckets(rate, max(30, rate // 4)) for name, rate in KEYRING.limits().items()}
GATE = ConcurrencyGate(MAX_CONCURRENT)
METRICS = Metrics()
# Settlements outrank POIs/addresses with the same name; bm25 breaks ties.
KIND_RANK = """CASE p.kind WHEN 'city' THEN 0 WHEN 'town' THEN 1 WHEN 'state' THEN 2
               WHEN 'village' THEN 3 WHEN 'suburb' THEN 4 WHEN 'neighbourhood' THEN 4
               WHEN 'hamlet' THEN 5 ELSE 6 END"""


CANDIDATES = 150
ADDRESS_CANDIDATES = 1500
LANGS = ("ru", "kk", "en")


def _schema_version(connection):
    try:
        row = connection.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        return int(row[0]) if row else 1
    except sqlite3.Error:
        return 1  # legacy index without a meta table


def _distance_km(a_lat, a_lon, b_lat, b_lon):
    dx = (a_lon - b_lon) * math.cos(math.radians((a_lat + b_lat) / 2)) * 111.32
    dy = (a_lat - b_lat) * 110.57
    return math.hypot(dx, dy)


def _fts_rows(connection, tokens, limit, version=2):
    expression = " AND ".join('skel : "' + token + '"*' for token in tokens)
    extra = "p.osm_id, p.category, p.subtype" if version >= 3 else "'' AS osm_id, '' AS category, '' AS subtype"
    return connection.execute(
        f"""SELECT p.id, p.name, p.name_ru, p.name_kk, p.name_en, p.alt, p.kind, p.lat, p.lon, p.importance, {extra}
           FROM places_fts f JOIN places p ON p.id = f.rowid
           WHERE places_fts MATCH ? ORDER BY p.importance DESC, bm25(places_fts) LIMIT ?""",
        (expression, limit),
    ).fetchall()


def _edit_distance_at_most_one(a, b):
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    i = j = 0
    edits = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1; j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        if len(a) == len(b):
            i += 1
        j += 1
    return edits + (len(b) - j) + (len(a) - i) <= 1


def _search_v2(connection, db_path, query, limit, lang, center, version=2):
    tokens = textnorm.skeleton_tokens(query)[:8]
    if not tokens:
        return []
    full = " ".join(tokens)
    # Street-type words (улица, проспект, көшесі...) are optional in what people type and in OSM names: retrieve and match on the core.
    search_tokens = addresses.core_tokens(tokens)
    core_full = " ".join(search_tokens)
    # House-number queries match many equal-importance rows across the country: look at more of them so proximity can pick.
    pool = ADDRESS_CANDIDATES if any(any(ch.isdigit() for ch in t) for t in tokens) else CANDIDATES
    rows = list(_fts_rows(connection, search_tokens, pool, version))
    names_of = lambda row: [row["name"], row["name_ru"], row["name_kk"], row["name_en"]] + (row["alt"] or "").split(";")
    skeletons_of = {row["id"]: [sk for sk in (textnorm.skeleton(n) for n in names_of(row) if n) if sk] for row in rows}
    # Typo tolerance without a second index: when nothing matches exactly, also try the query without its last
    # letter (Алмата -> almat* reaches Алматы). Candidates within edit distance 1 of the query then rank next to exact.
    if len(search_tokens[-1]) >= 4 and not any(full in sks for sks in skeletons_of.values()):
        seen = {row["id"] for row in rows}
        for row in _fts_rows(connection, search_tokens[:-1] + [search_tokens[-1][:-1]], CANDIDATES, version):
            if row["id"] not in seen:
                rows.append(row)
                skeletons_of[row["id"]] = [sk for sk in (textnorm.skeleton(n) for n in names_of(row) if n) if sk]
    ranked = []
    for row in rows:
        skeletons = skeletons_of[row["id"]]
        exact = full in skeletons
        # same name without the street-type word: 'Абая 150' vs 'проспект Абая 150' (a hair below a spelling-exact match)
        exact_core = not exact and any(addresses.core(sk) == core_full for sk in skeletons)
        near = not exact and len(full) >= 5 and any(_edit_distance_at_most_one(full, sk) for sk in skeletons)
        prefix = any(sk.startswith(full) for sk in skeletons)
        score = (10000 if exact else 9900 if exact_core else 8000 if near else 4000 if prefix else 0) + row["importance"]
        own = {"ru": row["name_ru"], "kk": row["name_kk"], "en": row["name_en"]}.get(lang)
        if exact and own and textnorm.skeleton(own) == full:
            score += 80  # the user's own language spelling matches
        if center is not None:
            score += 250 * max(0.0, 1.0 - _distance_km(center[0], center[1], row["lat"], row["lon"]) / 150.0)
        ranked.append((score, row["id"], row))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    keys = ("id", "name", "name_ru", "name_kk", "name_en", "kind", "lat", "lon")
    results = []
    for _, _, row in ranked[:limit]:
        item = {k: row[k] for k in keys}
        if version >= 3:  # stable id + category let the web app open the full place card (/v1/places/{place_id})
            item["place_id"] = row["osm_id"] or None
            item["category"] = row["category"] or None
            if row["kind"] == "address":
                place = addresses.locality(connection, db_path, row["lat"], row["lon"], lang)
                if place:
                    item["locality"] = place
        results.append(item)
    return results


def _search_v1(connection, query, limit):
    # FTS5 prefix search; quote every token to avoid FTS syntax injection.
    tokens = re.findall(r"[^\W_]+", query, flags=re.UNICODE)
    if not tokens:
        return []
    expression = " AND ".join('"' + token + '"*' for token in tokens[:8])
    rows = connection.execute(
        """SELECT p.id, p.name, p.name_ru, p.name_kk, p.kind, p.lat, p.lon
           FROM places_fts f JOIN places p ON p.id = f.rowid
           WHERE places_fts MATCH ? ORDER BY """ + KIND_RANK + """, bm25(places_fts) LIMIT ?""",
        (expression, limit),
    ).fetchall()
    return [dict(row) for row in rows]


def search(db_path, query, limit=DEFAULT_LIMIT, lang="ru", center=None):
    query = " ".join(query.split()).strip()
    if len(query) < 2 or len(query) > 100:
        return []
    limit = min(max(1, int(limit)), MAX_RESULTS)
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        version = _schema_version(connection)
        if version >= 2:
            return _search_v2(connection, db_path, query, limit, lang if lang in LANGS else "ru", center, version)
        return _search_v1(connection, query, limit)
    finally:
        connection.close()


class Handler(BaseHTTPRequestHandler):
    timeout = 15  # drop stalled/slowloris connections instead of holding a thread forever
    _code = 0

    def log_message(self, format, *args):
        # Never log search queries, URL parameters, IP addresses or coordinates.
        pass

    def do_GET(self):
        started = time.perf_counter()
        route = "other"
        try:
            route = self._dispatch()
        finally:
            elapsed = time.perf_counter() - started
            METRICS.observe(route, self._code, elapsed)
            if route != "health":
                # Structured, privacy-safe access log: route + status + latency only.
                print(json.dumps({"route": route, "status": self._code, "ms": round(elapsed * 1000, 1)}), flush=True)

    def _dispatch(self):
        if len(self.path) > 2048:
            self.reply(414, {"error": "request_uri_too_long"})
            return "other"
        # http.server decodes the request line as latin-1; recover raw UTF-8 clients.
        try:
            raw_path = self.path.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            raw_path = self.path
        parsed = urlparse(raw_path)
        if parsed.path == "/health":
            ready = DB_PATH.is_file()
            self.reply(200 if ready else 503, {"status": "ok" if ready else "not_ready", "index_ready": ready})
            return "health"
        if parsed.path == "/metrics":
            self._metrics()
            return "metrics"
        if parsed.path == "/debug/client":
            self._debug_client()
            return "metrics"
        is_places = parsed.path in ("/v1/places", "/v1/categories") or parsed.path.startswith("/v1/places/")
        if parsed.path != "/v1/search" and not is_places:
            self.reply(404, {"error": "not_found"})
            return "other"
        route = "places" if is_places else "search"
        ip = client_ip(self.headers.get("X-Forwarded-For"), self.client_address[0], TRUSTED_HOPS)
        presented = self.headers.get("X-API-Key")
        if presented is not None:
            key = KEYRING.lookup(presented)
            if key is None:
                METRICS.incr("invalid_keys")
                self.reply(401, {"error": "invalid_api_key"})
                return route
            METRICS.key_used(key[0])
            allowed, retry_after = KEY_LIMITERS[key[0]].check(key[0])  # quota is per key, shared by all of its client IPs
        else:
            allowed, retry_after = LIMITER.check(ip)
        if not allowed:
            METRICS.incr("rate_limited")
            self.reply(429, {"error": "rate_limited", "retry_after": retry_after}, {"Retry-After": str(retry_after)})
            return route
        if is_places:
            self._places(parsed)
            return route
        if not DB_PATH.is_file():
            self.reply(503, {"error": "index_unavailable"}, {"Retry-After": "5"})
            return "search"
        params = parse_qs(parsed.query)
        query = params.get("q", [""])[0]
        if len(query.strip()) < 2 or len(query) > 100:
            self.reply(400, {"error": "query_must_be_2_to_100_characters"})
            return "search"
        raw_limit = params.get("limit", [str(DEFAULT_LIMIT)])[0]
        if not raw_limit.isascii() or not raw_limit.isdigit() or not 1 <= int(raw_limit) <= MAX_RESULTS:
            self.reply(400, {"error": f"limit_must_be_1_to_{MAX_RESULTS}"})
            return "search"
        lang = params.get("lang", ["ru"])[0]
        if lang not in LANGS:
            self.reply(400, {"error": "lang_must_be_ru_kk_or_en"})
            return "search"
        center = None
        if "lat" in params or "lon" in params:
            try:
                center = (float(params["lat"][0]), float(params["lon"][0]))
            except (KeyError, ValueError, IndexError):
                center = None
            if center is None or not (-90 <= center[0] <= 90 and -180 <= center[1] <= 180) or not all(map(math.isfinite, center)):
                self.reply(400, {"error": "lat_lon_must_be_valid_coordinates"})
                return "search"
        try:
            with GATE:
                results = search(DB_PATH, query, int(raw_limit), lang, center)
            if not results:
                METRICS.incr("empty_results")
            self.reply(200, {"results": results})
        except BusyError:
            METRICS.incr("busy")
            self.reply(503, {"error": "busy"}, {"Retry-After": "1"})
        except sqlite3.Error:
            self.reply(503, {"error": "index_unavailable"}, {"Retry-After": "5"})
        return "search"

    def _places(self, parsed):
        """Places API (index schema v3): viewport, nearby, details, categories. Parameters are validated, never logged."""
        if not DB_PATH.is_file():
            self.reply(503, {"error": "index_unavailable"}, {"Retry-After": "5"})
            return
        params = parse_qs(parsed.query)
        first = lambda name: params.get(name, [None])[0]
        try:
            connection = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
            connection.row_factory = sqlite3.Row
            try:
                if _schema_version(connection) < 3:
                    self.reply(503, {"error": "places_unavailable"})
                    return
                with GATE:
                    if parsed.path == "/v1/categories":
                        self.reply(200, {"categories": places.category_info(connection), "attribution": places.ATTRIBUTION})
                    elif parsed.path.startswith("/v1/places/"):
                        place = places.by_id(connection, parsed.path[len("/v1/places/"):])
                        if place is None:
                            self.reply(404, {"error": "place_not_found"})
                        else:
                            self.reply(200, {"place": place, "attribution": places.ATTRIBUTION})
                    else:
                        cats = places.parse_categories(first("category"))
                        limit = places.parse_limit(first("limit"))
                        if first("bbox") is not None:
                            box = places.parse_bbox(first("bbox"))
                            center = None
                            if first("lat") is not None or first("lon") is not None:
                                center = (places.parse_float(first("lat"), "lat", -90, 90), places.parse_float(first("lon"), "lon", -180, 180))
                            results, truncated = places.in_viewport(connection, box, cats, limit, center)
                        elif first("lat") is not None and first("lon") is not None:
                            lat, lon = places.parse_float(first("lat"), "lat", -90, 90), places.parse_float(first("lon"), "lon", -180, 180)
                            radius = places.DEFAULT_RADIUS_M
                            if first("radius") is not None:
                                radius = int(places.parse_float(first("radius"), "radius", 50, places.MAX_RADIUS_M))
                            results, truncated = places.nearby(connection, lat, lon, radius, cats, limit)
                        else:
                            raise places.ParamError("bbox_or_lat_lon_required")
                        self.reply(200, {"places": results, "count": len(results), "truncated": truncated, "attribution": places.ATTRIBUTION})
            finally:
                connection.close()
        except places.ParamError as error:
            self.reply(400, {"error": str(error)})
        except BusyError:
            METRICS.incr("busy")
            self.reply(503, {"error": "busy"}, {"Retry-After": "1"})
        except sqlite3.Error:
            self.reply(503, {"error": "index_unavailable"}, {"Retry-After": "5"})

    def _metrics(self):
        if not METRICS_TOKEN:
            self.reply(404, {"error": "not_found"})  # disabled unless a token is configured
        elif not self._authorized():
            self.reply(401, {"error": "unauthorized"}, {"WWW-Authenticate": "Bearer"})
        else:
            body = METRICS.render({"rate_limit_keys": LIMITER.size(), "index_ready": int(DB_PATH.is_file())}).encode()
            self.reply_raw(200, body, "text/plain; version=0.0.4; charset=utf-8")

    def _authorized(self):
        supplied = self.headers.get("Authorization", "")
        return bool(METRICS_TOKEN) and hmac.compare_digest(supplied.encode(), ("Bearer " + METRICS_TOKEN).encode())

    def _debug_client(self):
        """Token-protected: shows how THIS request's client address is derived, to verify MAPS_TRUSTED_PROXY_HOPS
        behind the hosting proxy. Returns only the caller's own request data and is never logged."""
        if not METRICS_TOKEN:
            self.reply(404, {"error": "not_found"})
        elif not self._authorized():
            self.reply(401, {"error": "unauthorized"}, {"WWW-Authenticate": "Bearer"})
        else:
            forwarded = self.headers.get("X-Forwarded-For", "")
            self.reply(200, {
                "x_forwarded_for_entries": [p.strip() for p in forwarded.split(",") if p.strip()],
                "peer": self.client_address[0], "trusted_hops": TRUSTED_HOPS,
                "chosen": client_ip(forwarded, self.client_address[0], TRUSTED_HOPS),
                "other_forwarding_headers": sorted(h for h in self.headers.keys()
                                                    if h.lower() in ("true-client-ip", "cf-connecting-ip", "x-real-ip", "forwarded", "x-forwarded-proto", "x-forwarded-host")),
            })

    def do_OPTIONS(self):
        self.reply(204, None)

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
        # Explicit allowlist for the DEV frontend; no wildcard cross-origin API.
        # CORS is a browser policy, not authentication: abuse is limited by rate limits above.
        origin = self.headers.get("Origin")
        self.send_header("Vary", "Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")
            # Browsers hide Retry-After from cross-origin scripts unless it is exposed.
            self.send_header("Access-Control-Expose-Headers", "Retry-After")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
