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
MAX_RESULTS = 10


def search(db_path, query, limit=MAX_RESULTS):
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
               WHERE places_fts MATCH ? ORDER BY bm25(places_fts) LIMIT ?""",
            (expression, min(max(1, int(limit)), MAX_RESULTS)),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        connection.close()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
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
        try:
            self.reply(200, {"results": search(DB_PATH, query)})
        except sqlite3.Error:
            self.reply(503, {"error": "index_unavailable"})

    def reply(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        # Explicit allowlist for the DEV frontend; no wildcard cross-origin API.
        origin = self.headers.get("Origin")
        if origin == "https://kunde-maps-web-dev.onrender.com":
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
