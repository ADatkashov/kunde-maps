#!/usr/bin/env python3
"""Test fetch-osm-extract.sh against a local Geofabrik imitation (no network)."""
import hashlib, subprocess, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPT = str(Path(__file__).with_name("fetch-osm-extract.sh"))
BODY = b"PBF" * 40  # tiny stand-in; MIN_BYTES lowered in the test


def serve(files, redirects):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _go(self, head):
            path = self.path
            if path in redirects:
                self.send_response(302); self.send_header("Location", redirects[path]); self.end_headers(); return
            body = files.get(path)
            if body is None:
                self.send_error(404); return
            self.send_response(200); self.send_header("Content-Length", str(len(body))); self.end_headers()
            if not head: self.wfile.write(body)
        def do_GET(self): self._go(False)
        def do_HEAD(self): self._go(True)
    s = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def run(files, redirects, cache_files=None, **env):
    s = serve(files, redirects)
    try:
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as c:
            for name, data in (cache_files or {}).items():
                Path(c, name).write_bytes(data)
            e = {"PATH": "/usr/bin:/bin", "GEOFABRIK_BASE": f"http://127.0.0.1:{s.server_port}/asia", "TODAY": "2026-11-22", "MIN_BYTES": "10", "OSM_CACHE_DIR": c, **env}
            r = subprocess.run(["sh", SCRIPT, d], capture_output=True, text=True, env=e, timeout=120)
            r.cache = {p.name: p.read_bytes() for p in Path(c).iterdir()}
            src = Path(d, "SOURCE_URL")
            return r, (src.read_text().strip() if src.exists() else None), (Path(d, "kazakhstan.osm.pbf").read_bytes() if Path(d, "kazakhstan.osm.pbf").exists() else None)
    finally:
        s.shutdown(); s.server_close()


def md5(b): return (hashlib.md5(b).hexdigest() + "  x.osm.pbf\n").encode()


class FetchTest(unittest.TestCase):
    def test_uses_latest_when_it_works(self):
        files = {"/asia/kazakhstan-261121.osm.pbf": BODY, "/asia/kazakhstan-261121.osm.pbf.md5": md5(BODY)}
        r, src, data = run(files, {"/asia/kazakhstan-latest.osm.pbf": "/asia/kazakhstan-261121.osm.pbf",
                                   "/asia/kazakhstan-latest.osm.pbf.md5": "/asia/kazakhstan-261121.osm.pbf.md5"})
        self.assertEqual((r.returncode, data), (0, BODY), r.stderr)
        self.assertTrue(src.endswith("kazakhstan-latest.osm.pbf"))

    def test_falls_back_to_dated_file_when_latest_redirects_to_404(self):
        # The real incident: latest -> /asia/kazakhstan/kazakhstan-261121.osm.pbf (404); yesterday exists elsewhere.
        files = {"/asia/kazakhstan-261120.osm.pbf": BODY, "/asia/kazakhstan-261120.osm.pbf.md5": md5(BODY)}
        r, src, data = run(files, {"/asia/kazakhstan-latest.osm.pbf": "/asia/kazakhstan/kazakhstan-261121.osm.pbf",
                                   "/asia/kazakhstan-latest.osm.pbf.md5": "/asia/kazakhstan/kazakhstan-261121.osm.pbf.md5"})
        self.assertEqual((r.returncode, data), (0, BODY), r.stderr)
        self.assertTrue(src.endswith("/asia/kazakhstan-261120.osm.pbf"), src)
        self.assertIn("Not available", r.stdout)

    def test_subdirectory_layout_is_found(self):
        files = {"/asia/kazakhstan/kazakhstan-261119.osm.pbf": BODY, "/asia/kazakhstan/kazakhstan-261119.osm.pbf.md5": md5(BODY)}
        r, src, _ = run(files, {})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(src.endswith("/asia/kazakhstan/kazakhstan-261119.osm.pbf"))

    def test_md5_mismatch_fails_and_records_no_source(self):
        files = {"/asia/kazakhstan-261121.osm.pbf": BODY, "/asia/kazakhstan-261121.osm.pbf.md5": b"0" * 32 + b"  x\n"}
        r, src, _ = run(files, {})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("MD5 mismatch", r.stderr)
        self.assertIsNone(src)

    def test_too_small_file_is_rejected(self):
        files = {"/asia/kazakhstan-261121.osm.pbf": BODY, "/asia/kazakhstan-261121.osm.pbf.md5": md5(BODY)}
        r, src, _ = run(files, {}, MIN_BYTES="100000")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not a PBF", r.stderr)

    def test_successful_download_refreshes_the_cache(self):
        files = {"/asia/kazakhstan-261121.osm.pbf": BODY, "/asia/kazakhstan-261121.osm.pbf.md5": md5(BODY)}
        r, src, _ = run(files, {})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.cache["kazakhstan.osm.pbf"], BODY)
        self.assertTrue(r.cache["SOURCE_URL"].decode().strip().endswith("kazakhstan-261121.osm.pbf"))

    def test_falls_back_to_the_verified_cache_when_geofabrik_is_unreachable(self):
        cached = {"kazakhstan.osm.pbf": BODY, "kazakhstan.osm.pbf.md5": md5(BODY), "SOURCE_URL": b"https://download.geofabrik.de/asia/kazakhstan-261120.osm.pbf\n"}
        r, src, data = run({}, {}, cache_files=cached)
        self.assertEqual((r.returncode, data), (0, BODY), r.stderr)
        self.assertEqual(src, "cache of https://download.geofabrik.de/asia/kazakhstan-261120.osm.pbf")
        self.assertIn("WARNING", r.stderr)
        self.assertIn("HTTP 404", r.stdout, "diagnostics include the status code")

    def test_a_corrupt_cache_is_never_used(self):
        cached = {"kazakhstan.osm.pbf": BODY, "kazakhstan.osm.pbf.md5": b"0" * 32 + b"  x\n", "SOURCE_URL": b"x\n"}
        r, src, data = run({}, {}, cache_files=cached)
        self.assertNotEqual(r.returncode, 0)
        self.assertIsNone(src)

    def test_nothing_available_fails_clearly(self):
        r, src, _ = run({}, {})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("No Geofabrik Kazakhstan extract", r.stderr)


if __name__ == "__main__":
    unittest.main()
