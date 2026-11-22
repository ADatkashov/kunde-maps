"""KUNDE Maps search API: SQLite FTS5, offline-generated index, no public geocoder."""
import json
import os
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

DB_PATH = Path(os.environ.get("MAPS_SEARCH_DB", "/data/search.sqlite3"))
PORT = int(os.environ.get("PORT", "8081"))
DEFAULT_LIMIT = 10
MAX_RESULTS = 20
ALLOWED_ORIGINS = {"https://kunde-maps-web-dev.onrender.com"}
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
    def log_message(self, format, *args):
        # Never log search queries or user-provided URL parameters.
        pass

    def do_GET(self):
        if len(self.path) > 2048:
            self.reply(414, {"error": "request_uri_too_long"})
            return
        # http.server decodes the request line as latin-1; recover raw UTF-8 clients.
        try:
            raw_path = self.path.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            raw_path = self.path
        parsed = urlparse(raw_path)
        if parsed.path == "/health":
            ready = DB_PATH.is_file()
            self.reply(200 if ready else 503, {"status": "ok" if ready else "not_ready", "index_ready": ready})
            return
        if parsed.path != "/v1/search":
            self.reply(404, {"error": "not_found"})
            return
        if not DB_PATH.is_file():
            self.reply(503, {"error": "index_unavailable"})
            return
        params = parse_qs(parsed.query)
        query = params.get("q", [""])[0]
        if len(query.strip()) < 2 or len(query) > 100:
            self.reply(400, {"error": "query_must_be_2_to_100_characters"})
            return
        raw_limit = params.get("limit", [str(DEFAULT_LIMIT)])[0]
        if not raw_limit.isascii() or not raw_limit.isdigit() or not 1 <= int(raw_limit) <= MAX_RESULTS:
            self.reply(400, {"error": f"limit_must_be_1_to_{MAX_RESULTS}"})
            return
        try:
            self.reply(200, {"results": search(DB_PATH, query, int(raw_limit))})
        except sqlite3.Error:
            self.reply(503, {"error": "index_unavailable"})

    def do_OPTIONS(self):
        self.reply(204, None)

    def reply(self, code, payload):
        body = b"" if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        # Explicit allowlist for the DEV frontend; no wildcard cross-origin API.
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
