"""KUNDE Maps search API: SQLite FTS5, offline-generated index, no public geocoder."""
import hmac
import json
import os
import re
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from protection import BusyError, ConcurrencyGate, Metrics, TokenBuckets, client_ip, env_int

DB_PATH = Path(os.environ.get("MAPS_SEARCH_DB", "/data/search.sqlite3"))
PORT = int(os.environ.get("PORT", "8081"))
DEFAULT_LIMIT = 10
MAX_RESULTS = 20
ALLOWED_ORIGINS = {"https://kunde-maps-web-dev.onrender.com"}
# Abuse protection (all configurable; see docs/search-prototype.md).
RATE_PER_MINUTE = env_int(os.environ, "MAPS_RATE_LIMIT_PER_MINUTE", 60, 1, 100000)
RATE_BURST = env_int(os.environ, "MAPS_RATE_LIMIT_BURST", 20, 1, 10000)
MAX_CONCURRENT = env_int(os.environ, "MAPS_MAX_CONCURRENT_SEARCHES", 16, 1, 256)
TRUSTED_HOPS = env_int(os.environ, "MAPS_TRUSTED_PROXY_HOPS", 1, 0, 5)
METRICS_TOKEN = os.environ.get("MAPS_METRICS_TOKEN", "")
LIMITER = TokenBuckets(RATE_PER_MINUTE, RATE_BURST)
GATE = ConcurrencyGate(MAX_CONCURRENT)
METRICS = Metrics()
# Settlements outrank POIs/addresses with the same name; bm25 breaks ties.
KIND_RANK = """CASE p.kind WHEN 'city' THEN 0 WHEN 'town' THEN 1 WHEN 'state' THEN 2
               WHEN 'village' THEN 3 WHEN 'suburb' THEN 4 WHEN 'neighbourhood' THEN 4
               WHEN 'hamlet' THEN 5 ELSE 6 END"""


def search(db_path, query, limit=DEFAULT_LIMIT):
    query = " ".join(query.split()).strip()
    if len(query) < 2 or len(query) > 100:
        return []
    # FTS5 prefix search; quote every token to avoid FTS syntax injection.
    tokens = re.findall(r"[^\W_]+", query, flags=re.UNICODE)
    if not tokens:
        return []
    expression = " AND ".join('"' + token + '"*' for token in tokens[:8])
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """SELECT p.id, p.name, p.name_ru, p.name_kk, p.kind, p.lat, p.lon
               FROM places_fts f JOIN places p ON p.id = f.rowid
               WHERE places_fts MATCH ? ORDER BY """ + KIND_RANK + """, bm25(places_fts) LIMIT ?""",
            (expression, min(max(1, int(limit)), MAX_RESULTS)),
        ).fetchall()
        return [dict(row) for row in rows]
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
        if parsed.path != "/v1/search":
            self.reply(404, {"error": "not_found"})
            return "other"
        ip = client_ip(self.headers.get("X-Forwarded-For"), self.client_address[0], TRUSTED_HOPS)
        allowed, retry_after = LIMITER.check(ip)
        if not allowed:
            METRICS.incr("rate_limited")
            self.reply(429, {"error": "rate_limited", "retry_after": retry_after}, {"Retry-After": str(retry_after)})
            return "search"
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
        try:
            with GATE:
                results = search(DB_PATH, query, int(raw_limit))
            if not results:
                METRICS.incr("empty_results")
            self.reply(200, {"results": results})
        except BusyError:
            METRICS.incr("busy")
            self.reply(503, {"error": "busy"}, {"Retry-After": "1"})
        except sqlite3.Error:
            self.reply(503, {"error": "index_unavailable"}, {"Retry-After": "5"})
        return "search"

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
