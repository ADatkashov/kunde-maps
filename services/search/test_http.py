"""HTTP-level checks for the isolated search API."""
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server
from build_index import build


class SearchHTTPTest(unittest.TestCase):
    def test_api_readiness_and_search(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "points.geojsonl"
            source.write_text(json.dumps({
                "type": "Feature", "geometry": {"type": "Point", "coordinates": [76.945, 43.238]},
                "properties": {"name": "Абая", "name:kk": "Абай"}
            }, ensure_ascii=False), encoding="utf-8")
            db = Path(folder) / "index.sqlite3"
            build(source, db)
            previous = server.DB_PATH
            server.DB_PATH = db
            http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            worker = threading.Thread(target=http.serve_forever, daemon=True)
            worker.start()
            try:
                base = "http://127.0.0.1:" + str(http.server_port)
                with urlopen(base + "/health") as response:
                    self.assertEqual(response.status, 200)
                with urlopen(base + "/v1/search?q=%D0%90%D0%B1%D0%B0%D1%8F") as response:
                    results = json.load(response)["results"]
                    self.assertEqual(len(results), 1)
                    self.assertEqual(results[0]["name"], "Абая")
                with self.assertRaises(HTTPError) as invalid:
                    urlopen(base + "/v1/search?q=a")
                self.assertEqual(invalid.exception.code, 400)
                for bad in ("limit=0", "limit=999", "limit=abc", "limit=-1"):
                    with self.assertRaises(HTTPError) as bad_limit:
                        urlopen(base + "/v1/search?q=%D0%90%D0%B1%D0%B0%D1%8F&" + bad)
                    self.assertEqual(bad_limit.exception.code, 400, bad)
                with urlopen(base + "/v1/search?q=%D0%90%D0%B1%D0%B0%D1%8F&limit=1") as response:
                    self.assertEqual(len(json.load(response)["results"]), 1)
                # SQL/FTS injection strings must be inert and return valid JSON.
                for attack in ("%27%3B%20DROP%20TABLE%20places%3B--", "%22%20OR%20%2A", "NEAR%28a%20b%29"):
                    with urlopen(base + "/v1/search?q=" + attack) as response:
                        self.assertIsInstance(json.load(response)["results"], list)
                request = Request(base + "/v1/search?q=%D0%90%D0%B1%D0%B0%D1%8F",
                                  headers={"Origin": "https://kunde-maps-web-dev.onrender.com"})
                with urlopen(request) as response:
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"],
                                     "https://kunde-maps-web-dev.onrender.com")
                    self.assertEqual(response.headers["Access-Control-Expose-Headers"], "Retry-After")
                request = Request(base + "/v1/search?q=%D0%90%D0%B1%D0%B0%D1%8F", headers={"Origin": "https://evil.example"})
                with urlopen(request) as response:
                    self.assertIsNone(response.headers["Access-Control-Allow-Origin"])
                server.DB_PATH = Path(folder) / "missing.sqlite3"
                with self.assertRaises(HTTPError) as not_ready:
                    urlopen(base + "/health")
                self.assertEqual(not_ready.exception.code, 503)
            finally:
                http.shutdown()
                http.server_close()
                worker.join(timeout=5)
                server.DB_PATH = previous


if __name__ == "__main__":
    unittest.main()
