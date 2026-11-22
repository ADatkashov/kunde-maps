"""Routing API tests against a stub Valhalla (canned responses in Valhalla's real JSON shape) and the graph provisioner."""
import hashlib
import io
import json
import os
import sys
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "search"))  # shared protection.py / apikeys.py / provision_index.py

import apikeys  # noqa: E402
import polyline  # noqa: E402
import provision_graph  # noqa: E402
import route_server as server  # noqa: E402
from protection import TokenBuckets  # noqa: E402

# Republic Square -> Green Bazaar-like line with a dense straight section that simplification must collapse
SHAPE = [(43.2380 + i * 0.0001, 76.9456 + i * 0.00005) for i in range(200)] + [(43.2580 + i * 0.0005, 76.9556) for i in range(5)]
STUB_RESPONSE = {"trip": {"summary": {"length": 3.51, "time": 312.4}, "legs": [{
    "shape": polyline.encode(SHAPE),
    "maneuvers": [
        {"instruction": "Head north on Dostyk Avenue.", "type": 1, "street_names": ["Dostyk Avenue"], "length": 3.2, "time": 280.0, "begin_shape_index": 0},
        {"instruction": "Your destination is on the right.", "type": 5, "length": 0.0, "time": 0.0, "begin_shape_index": len(SHAPE) - 1}]}]}}


class Stub(BaseHTTPRequestHandler):
    mode = "ok"
    last_request = None

    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"{}")

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Stub.last_request = body
        status, payload = 200, STUB_RESPONSE
        if Stub.mode == "no_path":
            status, payload = 400, {"error_code": 442, "error": "No path could be found for input"}
        elif Stub.mode == "no_road":
            status, payload = 400, {"error_code": 171, "error": "No suitable edges near location"}
        elif Stub.mode == "too_long":
            status, payload = 400, {"error_code": 154, "error": "Path distance exceeds the max distance limit"}
        elif Stub.mode == "broken":
            status, payload = 500, {"error": "boom"}
        elif Stub.mode == "garbage":
            payload = {"trip": {}}
        data = json.dumps(payload).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)


class RoutingApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stub = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=cls.stub.serve_forever, daemon=True).start()
        cls.saved = (server.VALHALLA_URL, server.LIMITER, server.KEYRING, server.KEY_LIMITERS)
        server.VALHALLA_URL = f"http://127.0.0.1:{cls.stub.server_port}"
        cls.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.api.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.api.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.api.shutdown(); cls.stub.shutdown()
        server.VALHALLA_URL, server.LIMITER, server.KEYRING, server.KEY_LIMITERS = cls.saved

    def setUp(self):
        Stub.mode = "ok"
        server.LIMITER = TokenBuckets(6000, 1000)

    def get(self, query, headers=None):
        try:
            with urlopen(Request(self.base + query, headers=headers or {})) as response:
                return response.status, json.load(response), response.headers
        except HTTPError as err:
            return err.code, json.load(err), err.headers

    GOOD = "/v1/route?from=43.2380,76.9456&to=43.2610,76.9567"

    def test_route_reply_is_normalized_and_simplified(self):
        status, body, headers = self.get(self.GOOD + "&mode=bike&lang=en")
        self.assertEqual(status, 200)
        self.assertEqual((body["mode"], body["distance_m"], body["duration_s"]), ("bike", 3510, 312))
        self.assertEqual(Stub.last_request["costing"], "bicycle")
        self.assertEqual(Stub.last_request["language"], "en-US")
        coords = body["geometry"]["coordinates"]
        self.assertLess(len(coords), 12)  # 205 shape points collapsed by simplification
        self.assertEqual(coords[0], [76.9456, 43.238])
        self.assertEqual(coords[-1], [round(SHAPE[-1][1], 6), round(SHAPE[-1][0], 6)])  # endpoints kept
        self.assertEqual([s["type"] for s in body["steps"]], [1, 5])
        self.assertEqual(body["steps"][0]["street"], "Dostyk Avenue")
        self.assertEqual(body["steps"][0]["location"], [76.9456, 43.238])  # maneuver position comes from the original shape
        self.assertIn("no traffic", body["note"])
        self.assertIn("OpenStreetMap", body["attribution"])
        self.assertEqual(body["instruction_language"], "en")
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_kazakh_falls_back_to_russian_narrative_and_says_so(self):
        status, body, _ = self.get(self.GOOD + "&lang=kk")
        self.assertEqual((status, body["instruction_language"]), (200, "ru"))
        self.assertEqual(Stub.last_request["language"], "ru-RU")

    def test_validation(self):
        for query, code in [
            ("/v1/route?to=43.2,76.9", "from_must_be_lat,lon"),
            ("/v1/route?from=a,b&to=43.2,76.9", "from_must_be_lat,lon"),
            ("/v1/route?from=95,76&to=43.2,76.9", "from_out_of_range"),
            ("/v1/route?from=nan,76&to=43.2,76.9", "from_out_of_range"),
            ("/v1/route?from=48.85,2.35&to=43.2,76.9", "outside_coverage"),  # Paris: graph covers Kazakhstan only
            (self.GOOD + "&mode=plane", "mode_must_be_car_foot_or_bike"),
            (self.GOOD + "&lang=de", "lang_must_be_ru_kk_or_en"),
            ("/v1/route?from=43.2380,76.9456&to=43.23801,76.94561", "points_too_close"),
        ]:
            status, body, _ = self.get(query)
            self.assertEqual((status, body["error"]), (400, code), query)

    def test_engine_errors_are_mapped_not_leaked(self):
        for mode, status, code in [("no_path", 404, "no_route"), ("no_road", 404, "no_road_near_point"),
                                   ("too_long", 400, "route_too_long"), ("broken", 502, "routing_unavailable"),
                                   ("garbage", 502, "routing_unavailable")]:
            Stub.mode = mode
            got, body, headers = self.get(self.GOOD)
            self.assertEqual((got, body["error"]), (status, code), mode)
            self.assertNotIn("boom", json.dumps(body))
            if status == 502:
                self.assertEqual(headers["Retry-After"], "5")

    def test_engine_down_is_502(self):
        saved = server.VALHALLA_URL
        server.VALHALLA_URL = "http://127.0.0.1:1"
        try:
            status, body, _ = self.get(self.GOOD)
            self.assertEqual((status, body["error"]), (502, "routing_unavailable"))
        finally:
            server.VALHALLA_URL = saved

    def test_rate_limit_keys_and_cors(self):
        server.LIMITER = TokenBuckets(60, 2)
        self.assertEqual([self.get(self.GOOD)[0] for _ in range(3)], [200, 200, 429])
        status, body, headers = self.get(self.GOOD)
        self.assertEqual((status, body["error"]), (429, "rate_limited"))
        self.assertTrue(int(headers["Retry-After"]) >= 1)
        secret, entry = apikeys.generate("partner", 600)
        server.KEYRING = apikeys.KeyRing(apikeys.parse(entry))
        server.KEY_LIMITERS = {"partner": TokenBuckets(600, 20)}
        self.assertEqual(self.get(self.GOOD, {"X-API-Key": secret})[0], 200)  # own quota while anonymous is exhausted
        self.assertEqual(self.get(self.GOOD, {"X-API-Key": "kmk_nope"})[0], 401)
        server.KEYRING, server.KEY_LIMITERS = apikeys.KeyRing({}), {}
        server.LIMITER = TokenBuckets(6000, 1000)
        _, _, headers = self.get(self.GOOD, {"Origin": "https://kunde-maps-web-dev.onrender.com"})
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://kunde-maps-web-dev.onrender.com")
        _, _, headers = self.get(self.GOOD, {"Origin": "https://evil.example"})
        self.assertIsNone(headers["Access-Control-Allow-Origin"])

    def test_health_metrics_and_privacy(self):
        status, body, _ = self.get("/health")
        self.assertEqual((status, body["engine_ready"]), (200, True))
        self.assertEqual(self.get("/metrics")[0], 404)  # no token configured -> not exposed
        self.assertEqual(self.get("/nothing")[0], 404)
        server.METRICS.render()  # renders without coordinates: labels are route and status class only
        self.assertNotIn("43.2", server.METRICS.render())


class PolylineTest(unittest.TestCase):
    def test_roundtrip_and_simplify(self):
        pts = [(43.238, 76.9456), (43.239, 76.947), (-12.5, -70.25)]
        self.assertEqual(polyline.decode(polyline.encode(pts)), pts)
        with self.assertRaises(ValueError):
            polyline.decode("_p~iF~ps|U_")  # truncated
        line = [(i * 0.001, 0.0) for i in range(100)]  # perfectly straight
        self.assertEqual(polyline.simplify(line, 0.00001), [0, 99])
        bend = [(0.0, 0.0), (0.0, 0.01), (0.01, 0.01)]
        self.assertEqual(polyline.simplify(bend, 0.0001), [0, 1, 2])


class ProvisionTest(unittest.TestCase):
    def test_provision_download_verify_reuse_and_reject(self):
        with tempfile.TemporaryDirectory() as folder:
            tar_path = Path(folder) / "g.tar"
            with tarfile.open(tar_path, "w") as archive:
                info = tarfile.TarInfo("0/000/000.gph"); data = b"x" * 4096; info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
            digest = hashlib.sha256(tar_path.read_bytes()).hexdigest()
            (Path(folder) / "g.sha256").write_text(digest + "  g.tar\n")

            class Files(BaseHTTPRequestHandler):
                def log_message(self, *a):
                    pass

                def do_GET(self):
                    path = Path(folder) / self.path.lstrip("/")
                    if not path.is_file():
                        self.send_response(404); self.end_headers(); return
                    data = path.read_bytes()
                    self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
            files = ThreadingHTTPServer(("127.0.0.1", 0), Files)
            threading.Thread(target=files.serve_forever, daemon=True).start()
            dest = Path(folder) / "out" / "valhalla-tiles.tar"
            env = {"MAPS_ROUTING_GRAPH_URL": f"http://127.0.0.1:{files.server_port}/g.tar", "MAPS_ROUTING_GRAPH": str(dest),
                   "MAPS_ROUTING_MIN_BYTES": "1000"}
            try:
                self.assertEqual(provision_graph.provision(env), dest)
                self.assertEqual(hashlib.sha256(dest.read_bytes()).hexdigest(), digest)
                mtime = dest.stat().st_mtime_ns
                provision_graph.provision(env)  # verified copy is reused, not downloaded again
                self.assertEqual(dest.stat().st_mtime_ns, mtime)
                dest.write_bytes(b"corrupt")
                provision_graph.provision(env)  # corrupt local copy is replaced
                self.assertEqual(hashlib.sha256(dest.read_bytes()).hexdigest(), digest)
                (Path(folder) / "g.sha256").write_text("0" * 64 + "\n")
                dest.unlink()
                with self.assertRaises(SystemExit) as failed:
                    provision_graph.provision(env)  # checksum mismatch: nothing is installed
                self.assertIn("SHA256 mismatch", str(failed.exception))
                self.assertFalse(dest.exists())
                with self.assertRaises(SystemExit):
                    provision_graph.provision({**env, "MAPS_ROUTING_MIN_BYTES": "999999999"})
                with self.assertRaises(SystemExit):
                    provision_graph.provision({"MAPS_ROUTING_GRAPH_URL": "http://example.com/g.tar"})  # plain http to a remote host
            finally:
                files.shutdown()


if __name__ == "__main__":
    unittest.main()
