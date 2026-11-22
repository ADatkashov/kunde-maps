"""API keys: parsing, lookup, per-key quota and metrics over real HTTP."""
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import apikeys
import server
from build_index import build
from protection import TokenBuckets


class ParseTest(unittest.TestCase):
    def test_roundtrip_and_validation(self):
        secret, entry = apikeys.generate("partner-a", 600)
        self.assertTrue(secret.startswith("kmk_"))
        self.assertNotIn(secret, entry)  # only the hash is configured
        ring = apikeys.KeyRing(apikeys.parse(entry))
        self.assertEqual(ring.lookup(secret), ("partner-a", 600))
        self.assertIsNone(ring.lookup(secret + "x"))
        self.assertIsNone(ring.lookup(""))
        self.assertIsNone(ring.lookup("k" * 500))
        self.assertFalse(apikeys.KeyRing({}))

    def test_malformed_configuration_is_rejected(self):
        good = "a:" + "0" * 64 + ":10"
        self.assertEqual(len(apikeys.parse(good + ",b:" + "1" * 64 + ":5")), 2)
        for bad in ("a:short:10", "a:" + "0" * 64, "A:" + "0" * 64 + ":10", "a:" + "0" * 64 + ":0", "a:" + "0" * 64 + ":x",
                    "a:" + "G" * 64 + ":10", good + "," + good, "a b:" + "0" * 64 + ":10"):
            with self.assertRaises(ValueError, msg=bad):
                apikeys.parse(bad)
        self.assertEqual(apikeys.parse(""), {})


class HttpTest(unittest.TestCase):
    def test_keys_over_http(self):
        secret, entry = apikeys.generate("partner-a", 600)
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "p.geojsonl"
            source.write_text(json.dumps({"type": "Feature", "geometry": {"type": "Point", "coordinates": [76.9, 43.2]},
                                          "properties": {"name": "Абая"}}, ensure_ascii=False), encoding="utf-8")
            db = Path(folder) / "i.sqlite3"
            build(source, db)
            saved = (server.DB_PATH, server.KEYRING, server.KEY_LIMITERS, server.LIMITER)
            server.DB_PATH = db
            server.KEYRING = apikeys.KeyRing(apikeys.parse(entry))
            server.KEY_LIMITERS = {"partner-a": TokenBuckets(600, 30)}
            server.LIMITER = TokenBuckets(60, 2)  # anonymous: burst of 2 only
            http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            threading.Thread(target=http.serve_forever, daemon=True).start()
            base = f"http://127.0.0.1:{http.server_port}/v1/search?q=%D0%90%D0%B1%D0%B0%D1%8F"

            def status(headers=None):
                try:
                    with urlopen(Request(base, headers=headers or {})) as response:
                        return response.status
                except HTTPError as err:
                    return err.code
            try:
                anon = [status() for _ in range(4)]
                self.assertEqual(anon[:2], [200, 200])
                self.assertEqual(anon[-1], 429)  # anonymous bucket exhausted...
                self.assertEqual(status({"X-API-Key": secret}), 200)  # ...a key has its own quota
                self.assertEqual(status({"X-API-Key": "kmk_wrong"}), 401)  # never falls back to anonymous
                self.assertEqual(status({"X-API-Key": ""}), 401)
                for _ in range(20):
                    self.assertEqual(status({"X-API-Key": secret}), 200)
                text = server.METRICS.render()
                self.assertIn('kunde_search_key_requests_total{key="partner-a"} 21', text)
                self.assertIn("kunde_search_invalid_keys_total 2", text)
                self.assertNotIn(secret, text)  # secrets never reach metrics
                # CORS does not advertise the key header: keys are for servers, not for browser code
                request = Request(base, headers={"Origin": "https://kunde-maps-web-dev.onrender.com", "X-API-Key": secret})
                with urlopen(request) as response:
                    self.assertNotIn("X-API-Key", response.headers.get("Access-Control-Allow-Headers", ""))
            finally:
                http.shutdown()
                http.server_close()
                server.DB_PATH, server.KEYRING, server.KEY_LIMITERS, server.LIMITER = saved


if __name__ == "__main__":
    unittest.main()
