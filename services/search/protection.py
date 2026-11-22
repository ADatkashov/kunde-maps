"""Abuse protection and privacy-safe observability for the Search API (stdlib only).

Nothing here stores or exposes search text, coordinates or raw IP addresses:
* rate-limit keys are salted SHA-256 prefixes held only in memory and never logged;
* metrics are aggregate counters/histograms labelled by route and status class.
"""
import hashlib
import ipaddress
import math
import os
import threading
import time
from collections import OrderedDict

LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)


def client_ip(forwarded_for, peer, trusted_hops):
    """Return the client IP. With N trusted proxy hops, the Nth entry from the right of
    X-Forwarded-For was appended by our own infrastructure; anything left of it is client-controlled
    and ignored. Invalid or missing values fall back to the socket peer."""
    if trusted_hops > 0 and forwarded_for:
        parts = [p.strip() for p in forwarded_for.split(",") if p.strip()]
        if len(parts) >= trusted_hops:
            candidate = parts[-trusted_hops]
            try:
                return str(ipaddress.ip_address(candidate))
            except ValueError:
                pass
    return peer


class TokenBuckets:
    """Per-key token bucket with bounded memory (LRU eviction)."""

    def __init__(self, per_minute, burst, max_keys=20000, salt=None, clock=time.monotonic):
        self.rate = per_minute / 60.0
        self.burst = float(burst)
        self.max_keys = max_keys
        self.salt = salt or os.urandom(16)
        self.clock = clock
        self._buckets = OrderedDict()
        self._lock = threading.Lock()

    def _key(self, identity):
        return hashlib.sha256(self.salt + identity.encode()).digest()[:12]

    def check(self, identity):
        """Consume one token. Returns (allowed, retry_after_seconds)."""
        key, now = self._key(identity), self.clock()
        with self._lock:
            tokens, last = self._buckets.get(key, (self.burst, now))
            tokens = min(self.burst, tokens + (now - last) * self.rate)
            if tokens >= 1.0:
                self._buckets[key] = (tokens - 1.0, now)
                self._buckets.move_to_end(key)
                allowed, retry = True, 0
            else:
                self._buckets[key] = (tokens, now)
                self._buckets.move_to_end(key)
                allowed, retry = False, max(1, math.ceil((1.0 - tokens) / self.rate)) if self.rate > 0 else 60
            while len(self._buckets) > self.max_keys:
                self._buckets.popitem(last=False)
            return allowed, retry

    def size(self):
        with self._lock:
            return len(self._buckets)


class ConcurrencyGate:
    """Caps simultaneous expensive requests so a burst cannot exhaust threads/CPU."""

    def __init__(self, limit):
        self._sem = threading.BoundedSemaphore(limit)

    def __enter__(self):
        if not self._sem.acquire(blocking=False):
            raise BusyError()
        return self

    def __exit__(self, *exc):
        self._sem.release()


class BusyError(Exception):
    pass


class Metrics:
    """Prometheus-style aggregate counters. Labels are route and status class only."""

    def __init__(self):
        self._lock = threading.Lock()
        self.requests = {}
        self.latency = {}
        self.rate_limited = 0
        self.busy = 0
        self.empty_results = 0
        self.started = time.time()

    def observe(self, route, status, seconds):
        label = (route, f"{status // 100}xx")
        with self._lock:
            self.requests[label] = self.requests.get(label, 0) + 1
            buckets, total, count = self.latency.setdefault(route, ([0] * len(LATENCY_BUCKETS), 0.0, 0))
            for i, bound in enumerate(LATENCY_BUCKETS):
                if seconds <= bound:
                    buckets[i] += 1
            self.latency[route] = (buckets, total + seconds, count + 1)

    def incr(self, name):
        with self._lock:
            setattr(self, name, getattr(self, name) + 1)

    def render(self, extra_gauges=None):
        lines = ["# TYPE kunde_search_requests_total counter"]
        with self._lock:
            for (route, klass), value in sorted(self.requests.items()):
                lines.append(f'kunde_search_requests_total{{route="{route}",status="{klass}"}} {value}')
            lines.append("# TYPE kunde_search_request_seconds histogram")
            for route, (buckets, total, count) in sorted(self.latency.items()):
                for bound, value in zip(LATENCY_BUCKETS, buckets):
                    lines.append(f'kunde_search_request_seconds_bucket{{route="{route}",le="{bound}"}} {value}')
                lines.append(f'kunde_search_request_seconds_bucket{{route="{route}",le="+Inf"}} {count}')
                lines.append(f'kunde_search_request_seconds_sum{{route="{route}"}} {total:.6f}')
                lines.append(f'kunde_search_request_seconds_count{{route="{route}"}} {count}')
            for name in ("rate_limited", "busy", "empty_results"):
                lines.append(f"# TYPE kunde_search_{name}_total counter")
                lines.append(f"kunde_search_{name}_total {getattr(self, name)}")
            lines.append(f"kunde_search_uptime_seconds {time.time() - self.started:.0f}")
        for name, value in (extra_gauges or {}).items():
            lines.append(f"kunde_search_{name} {value}")
        return "\n".join(lines) + "\n"


def env_int(env, name, default, low, high):
    try:
        value = int(env.get(name, default))
    except (TypeError, ValueError):
        raise SystemExit(f"{name} must be an integer")
    if not low <= value <= high:
        raise SystemExit(f"{name} must be between {low} and {high}")
    return value
