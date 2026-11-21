"""Provisioning tests against a local HTTP server that imitates Cloudflare's UA block."""
import hashlib
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from build_index import build
import provision_index


def make_index(root, rows=1001):
    source = root / "places.geojsonl"
    record = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [76.9, 43.2]},
              "properties": {"name": "Алматы"}}
    source.write_text("\n".join(json.dumps(record, ensure_ascii=False) for _ in range(rows)), encoding="utf-8")
    target = root / "origin.sqlite3"
    build(source, target)
    return target


class Origin:
    """Serves files; answers 403 to Python-urllib like Cloudflare error 1010."""
    def __init__(self, files):
        self.files, self.hits = files, []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                outer.hits.append(self.path)
                if self.headers.get("User-Agent", "").startswith("Python-urllib"):
                    return self.send_error(403, "error code: 1010")
                body = outer.files.get(self.path)
                if body is None:
                    return self.send_error(404)
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.base = f"http://127.0.0.1:{self.http.server_port}"
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def close(self):
        self.http.shutdown()
        self.http.server_close()


class ProvisionIndexTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data = make_index(self.root).read_bytes()
        self.sha = hashlib.sha256(self.data).hexdigest()
        self.dest = self.root / "run" / "index.sqlite3"
        patcher = patch.object(provision_index, "BACKOFF_SECONDS", 0)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def env(self, **extra):
        env = {"MAPS_SEARCH_DB": str(self.dest)}
        env.update(extra)
        return env

    def origin(self, files):
        origin = Origin(files)
        self.addCleanup(origin.close)
        return origin

    def test_rejects_missing_or_insecure_configuration(self):
        with self.assertRaises(SystemExit):
            provision_index.provision(self.env())
        with self.assertRaises(SystemExit):
            provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL="http://example.com/a.sqlite3",
                                               MAPS_SEARCH_INDEX_SHA256=self.sha))
        with self.assertRaises(SystemExit):
            provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL="https://example.com/a.sqlite3",
                                               MAPS_SEARCH_INDEX_SHA256="zz"))

    def test_downloads_with_custom_user_agent_and_sidecar(self):
        o = self.origin({"/i.sqlite3": self.data, "/i.sha256": f"{self.sha}  /tmp/x.sqlite3\n".encode()})
        provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL=o.base + "/i.sqlite3"))
        self.assertEqual(hashlib.sha256(self.dest.read_bytes()).hexdigest(), self.sha)
        self.assertFalse(self.dest.with_name(self.dest.name + ".download").exists())

    def test_default_urllib_user_agent_is_blocked_by_origin(self):
        # Regression: this is the production 403 (Cloudflare error 1010).
        import urllib.request, urllib.error
        o = self.origin({"/i.sha256": self.sha.encode()})
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(o.base + "/i.sha256")
        self.assertEqual(ctx.exception.code, 403)
        self.assertFalse(provision_index.USER_AGENT.startswith("Python-urllib"))

    def test_checksum_mismatch_is_rejected_and_nothing_is_installed(self):
        o = self.origin({"/i.sqlite3": self.data})
        with self.assertRaises(SystemExit) as ctx:
            provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL=o.base + "/i.sqlite3",
                                                MAPS_SEARCH_INDEX_SHA256="0" * 64))
        self.assertIn("SHA256 mismatch", str(ctx.exception))
        self.assertFalse(self.dest.exists())
        self.assertEqual(list(self.dest.parent.iterdir()), [])

    def test_corrupt_sqlite_with_matching_checksum_is_rejected(self):
        junk = b"not a database" * 1000
        o = self.origin({"/i.sqlite3": junk})
        with self.assertRaises(SystemExit):
            provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL=o.base + "/i.sqlite3",
                                                MAPS_SEARCH_INDEX_SHA256=hashlib.sha256(junk).hexdigest()))
        self.assertFalse(self.dest.exists())

    def test_truncated_sqlite_is_rejected(self):
        part = self.data[: len(self.data) // 2]
        o = self.origin({"/i.sqlite3": part})
        with self.assertRaises(SystemExit):
            provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL=o.base + "/i.sqlite3",
                                                MAPS_SEARCH_INDEX_SHA256=hashlib.sha256(part).hexdigest()))
        self.assertFalse(self.dest.exists())

    def test_falls_back_when_primary_is_missing(self):
        primary = self.origin({})
        fallback = self.origin({"/f.sqlite3": self.data})
        provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL=primary.base + "/i.sqlite3",
                                           MAPS_SEARCH_INDEX_FALLBACK_URL=fallback.base + "/f.sqlite3",
                                           MAPS_SEARCH_INDEX_SHA256=self.sha))
        self.assertTrue(self.dest.is_file())
        self.assertEqual(primary.hits.count("/i.sqlite3"), 1)  # 404 is not retried

    def test_reuses_verified_local_copy_without_downloading(self):
        o = self.origin({"/i.sqlite3": self.data})
        env = self.env(MAPS_SEARCH_INDEX_URL=o.base + "/i.sqlite3", MAPS_SEARCH_INDEX_SHA256=self.sha)
        provision_index.provision(env)
        provision_index.provision(env)
        self.assertEqual(o.hits.count("/i.sqlite3"), 1)

    def test_replaces_stale_or_damaged_local_copy(self):
        o = self.origin({"/i.sqlite3": self.data})
        self.dest.parent.mkdir(parents=True)
        self.dest.write_bytes(b"stale")
        provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL=o.base + "/i.sqlite3",
                                           MAPS_SEARCH_INDEX_SHA256=self.sha))
        self.assertEqual(hashlib.sha256(self.dest.read_bytes()).hexdigest(), self.sha)

    def test_retries_server_errors_then_gives_up(self):
        calls = []

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                calls.append(1)
                self.send_error(503)

        http = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        self.addCleanup(http.server_close)
        self.addCleanup(http.shutdown)
        with self.assertRaises(SystemExit):
            provision_index.provision(self.env(MAPS_SEARCH_INDEX_URL=f"http://127.0.0.1:{http.server_port}/i.sqlite3",
                                               MAPS_SEARCH_INDEX_SHA256=self.sha))
        self.assertEqual(len(calls), provision_index.ATTEMPTS)


if __name__ == "__main__":
    unittest.main()
