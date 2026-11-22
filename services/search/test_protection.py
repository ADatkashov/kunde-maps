"""Rate limiting, concurrency cap, metrics privacy and HTTP-level protection behaviour."""
import io
import json
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import protection
import server
from build_index import build


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class TokenBucketTest(unittest.TestCase):
    def test_burst_then_blocks_with_retry_after_and_refills(self):
        clock = FakeClock()
        limiter = protection.TokenBuckets(per_minute=60, burst=3, clock=clock)
        self.assertEqual([limiter.check("a")[0] for _ in range(3)], [True, True, True])
        allowed, retry = limiter.check("a")
        self.assertFalse(allowed)
        self.assertEqual(retry, 1)  # 1 token/second
        self.assertTrue(limiter.check("b")[0], "other clients are independent")
        clock.now += 1.0
        self.assertTrue(limiter.check("a")[0])
        self.assertFalse(limiter.check("a")[0])

    def test_retry_after_scales_with_rate(self):
        clock = FakeClock()
        limiter = protection.TokenBuckets(per_minute=6, burst=1, clock=clock)  # 1 token / 10 s
        limiter.check("a")
        self.assertEqual(limiter.check("a"), (False, 10))

    def test_memory_is_bounded_and_keys_are_hashed(self):
        limiter = protection.TokenBuckets(per_minute=60, burst=5, max_keys=100)
        for i in range(1000):
            limiter.check(f"10.0.{i // 256}.{i % 256}")
        self.assertEqual(limiter.size(), 100)
        self.assertNotIn(b"10.0.", b"".join(limiter._buckets.keys()))

    def test_thread_safety_never_exceeds_burst(self):
        limiter = protection.TokenBuckets(per_minute=1, burst=50, clock=FakeClock())
        results = []
        threads = [threading.Thread(target=lambda: results.append(limiter.check("x")[0])) for _ in range(200)]
        [t.start() for t in threads]; [t.join() for t in threads]
        self.assertEqual(sum(results), 50)


class ClientIpTest(unittest.TestCase):
    def test_uses_nth_from_right_and_ignores_client_supplied_prefix(self):
        self.assertEqual(protection.client_ip("6.6.6.6, 203.0.113.9", "10.0.0.1", 1), "203.0.113.9")
        self.assertEqual(protection.client_ip("6.6.6.6, 203.0.113.9, 10.1.1.1", "10.0.0.1", 2), "203.0.113.9")

    def test_falls_back_to_peer_when_header_is_missing_short_or_invalid(self):
        self.assertEqual(protection.client_ip(None, "10.0.0.1", 1), "10.0.0.1")
        self.assertEqual(protection.client_ip("1.1.1.1", "10.0.0.1", 2), "10.0.0.1")
        self.assertEqual(protection.client_ip("not-an-ip", "10.0.0.1", 1), "10.0.0.1")
        self.assertEqual(protection.client_ip("1.1.1.1", "10.0.0.1", 0), "10.0.0.1")

    def test_ipv6(self):
        self.assertEqual(protection.client_ip("2001:db8::1", "10.0.0.1", 1), "2001:db8::1")


class ConcurrencyGateTest(unittest.TestCase):
    def test_rejects_when_full_and_releases(self):
        gate = protection.ConcurrencyGate(1)
        with gate:
            with self.assertRaises(protection.BusyError):
                with gate:
                    pass
        with gate:
            pass


class MetricsTest(unittest.TestCase):
    def test_render_contains_aggregates_only(self):
        m = protection.Metrics()
        m.observe("search", 200, 0.03)
        m.observe("search", 429, 0.001)
        m.incr("rate_limited")
        text = m.render({"rate_limit_keys": 2})
        self.assertIn('kunde_search_requests_total{route="search",status="2xx"} 1', text)
        self.assertIn('kunde_search_requests_total{route="search",status="4xx"} 1', text)
        # histogram buckets are cumulative: 0.001 s falls in every bucket, 0.03 s from le=0.05 upward
        self.assertIn('kunde_search_request_seconds_bucket{route="search",le="0.005"} 1', text)
        self.assertIn('kunde_search_request_seconds_bucket{route="search",le="0.05"} 2', text)
        self.assertIn("kunde_search_rate_limited_total 1", text)
        self.assertIn("kunde_search_rate_limit_keys 2", text)

    def test_env_int_validation(self):
        self.assertEqual(protection.env_int({"X": "5"}, "X", 1, 1, 10), 5)
        with self.assertRaises(SystemExit):
            protection.env_int({"X": "abc"}, "X", 1, 1, 10)
        with self.assertRaises(SystemExit):
            protection.env_int({"X": "0"}, "X", 1, 1, 10)


class ProtectedServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        source = root / "p.geojsonl"
        source.write_text(json.dumps({"type": "Feature", "geometry": {"type": "Point", "coordinates": [76.9, 43.2]},
                                       "properties": {"name": "Секретныйзапрос"}}, ensure_ascii=False), encoding="utf-8")
        build(source, root / "i.sqlite3")
        self.saved = (server.DB_PATH, server.LIMITER, server.METRICS, server.METRICS_TOKEN, server.GATE, server.TRUSTED_HOPS)
        server.DB_PATH = root / "i.sqlite3"
        server.LIMITER = protection.TokenBuckets(per_minute=60, burst=3)
        server.METRICS = protection.Metrics()
        server.METRICS_TOKEN = ""
        server.GATE = protection.ConcurrencyGate(4)
        server.TRUSTED_HOPS = 1
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.http.server_port}"

    def tearDown(self):
        self.http.shutdown(); self.http.server_close()
        (server.DB_PATH, server.LIMITER, server.METRICS, server.METRICS_TOKEN, server.GATE, server.TRUSTED_HOPS) = self.saved
        self.tmp.cleanup()

    def get(self, path, headers=None):
        try:
            with urlopen(Request(self.base + path, headers=headers or {})) as r:
                return r.status, dict(r.headers), r.read()
        except HTTPError as e:
            return e.code, dict(e.headers), e.read()

    Q = "/v1/search?q=%D0%A1%D0%B5%D0%BA"  # "Сек"

    def test_429_after_burst_with_retry_after_cors_and_json(self):
        origin = {"Origin": "https://kunde-maps-web-dev.onrender.com"}
        codes = [self.get(self.Q, origin)[0] for _ in range(3)]
        self.assertEqual(codes, [200, 200, 200])
        status, headers, body = self.get(self.Q, origin)
        self.assertEqual(status, 429)
        self.assertEqual(headers["Retry-After"], "1")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://kunde-maps-web-dev.onrender.com")
        self.assertEqual(headers["Access-Control-Expose-Headers"], "Retry-After")
        self.assertEqual(json.loads(body), {"error": "rate_limited", "retry_after": 1})

    def test_health_is_never_rate_limited(self):
        for _ in range(10):
            self.assertEqual(self.get("/health")[0], 200)

    def test_spoofed_forwarded_for_prefix_does_not_bypass_limit(self):
        for i in range(3):
            self.get(self.Q, {"X-Forwarded-For": f"9.9.9.{i}, 203.0.113.7"})
        status = self.get(self.Q, {"X-Forwarded-For": "1.2.3.4, 203.0.113.7"})[0]
        self.assertEqual(status, 429)
        # a genuinely different client (different trusted hop value) is not affected
        self.assertEqual(self.get(self.Q, {"X-Forwarded-For": "1.2.3.4, 198.51.100.5"})[0], 200)

    def test_invalid_requests_also_consume_tokens(self):
        for _ in range(3):
            self.assertEqual(self.get("/v1/search?q=a")[0], 400)
        self.assertEqual(self.get("/v1/search?q=a")[0], 429)

    def test_security_headers_present(self):
        _, headers, _ = self.get("/health")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        self.assertIn("default-src 'none'", headers["Content-Security-Policy"])
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_metrics_disabled_without_token_and_protected_with_one(self):
        self.assertEqual(self.get("/metrics")[0], 404)
        server.METRICS_TOKEN = "s3cret-token"
        self.assertEqual(self.get("/metrics")[0], 401)
        self.assertEqual(self.get("/metrics", {"Authorization": "Bearer wrong"})[0], 401)
        self.get(self.Q)
        status, headers, body = self.get("/metrics", {"Authorization": "Bearer s3cret-token"})
        self.assertEqual(status, 200)
        text = body.decode()
        self.assertIn('kunde_search_requests_total{route="search",status="2xx"} 1', text)
        self.assertIn("kunde_search_index_ready 1", text)

    def test_metrics_and_logs_never_contain_query_text_or_ip(self):
        server.METRICS_TOKEN = "t"
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            self.get("/v1/search?q=%D0%A1%D0%B5%D0%BA%D1%80%D0%B5%D1%82%D0%BD%D1%8B%D0%B9", {"X-Forwarded-For": "198.51.100.77"})
            for _ in range(200):  # the access log line is written just after the response is sent
                if buffer.getvalue().strip():
                    break
                threading.Event().wait(0.01)
        _, _, body = self.get("/metrics", {"Authorization": "Bearer t"})
        for blob in (buffer.getvalue(), body.decode()):
            self.assertNotIn("Секретный", blob)
            self.assertNotIn("198.51.100.77", blob)
            self.assertNotIn("127.0.0.1", blob)
        line = json.loads(buffer.getvalue().strip().splitlines()[-1])
        self.assertEqual(set(line), {"route", "status", "ms"})

    def test_debug_client_is_token_protected_and_reports_derivation(self):
        self.assertEqual(self.get("/debug/client")[0], 404)
        server.METRICS_TOKEN = "tok"
        self.assertEqual(self.get("/debug/client")[0], 401)
        status, _, body = self.get("/debug/client", {"Authorization": "Bearer tok", "X-Forwarded-For": "6.6.6.6, 203.0.113.9"})
        data = json.loads(body)
        self.assertEqual((status, data["chosen"], data["x_forwarded_for_entries"]), (200, "203.0.113.9", ["6.6.6.6", "203.0.113.9"]))

    def test_busy_when_concurrency_gate_is_full(self):
        server.GATE = protection.ConcurrencyGate(1)
        server.GATE._sem.acquire()
        status, headers, body = self.get(self.Q)
        self.assertEqual((status, headers["Retry-After"], json.loads(body)["error"]), (503, "1", "busy"))
        server.GATE._sem.release()
        self.assertEqual(self.get(self.Q)[0], 200)


if __name__ == "__main__":
    unittest.main()
