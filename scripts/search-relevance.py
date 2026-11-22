#!/usr/bin/env python3
"""Measure Search API relevance and latency on real Kazakhstan places.

  python3 scripts/search-relevance.py --db path/to/index.sqlite3          # direct, no network
  python3 scripts/search-relevance.py --url https://kunde-maps-search-dev.onrender.com   # live API (paced)

Expectations are real geography (city kind + coordinates within 0.5 degrees), never invented ratings.
Exit code 1 if top-1 accuracy is below --min-top1 (default 0.9). Query text is only printed locally.
"""
import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# (query, expected kind, lat, lon)
CASES = [
    ("Алматы", "city", 43.24, 76.95), ("Almaty", "city", 43.24, 76.95), ("Almati", "city", 43.24, 76.95),
    ("Алмата", "city", 43.24, 76.95),
    ("Астана", "city", 51.13, 71.43), ("Astana", "city", 51.13, 71.43),
    ("Шымкент", "city", 42.32, 69.59), ("Shymkent", "city", 42.32, 69.59),
    ("Қарағанды", "city", 49.8, 73.1), ("Karaganda", "city", 49.8, 73.1), ("Qaraghandy", "city", 49.8, 73.1),
    ("Атырау", "city", 47.1, 51.9), ("Atyrau", "city", 47.1, 51.9),
    ("Түркістан", "city", 43.3, 68.25), ("Turkistan", "city", 43.3, 68.25),
    ("Семей", "city", 50.4, 80.25), ("Semey", "city", 50.4, 80.25),
    ("Павлодар", "city", 52.28, 76.97), ("Pavlodar", "city", 52.28, 76.97),
    ("Ақтөбе", "city", 50.28, 57.2), ("Aktobe", "city", 50.28, 57.2),
    ("Өскемен", "city", 49.95, 82.6), ("Oskemen", "city", 49.95, 82.6),
    ("Тараз", "city", 42.9, 71.37), ("Taraz", "city", 42.9, 71.37),
    ("Қостанай", "city", 53.2, 63.6), ("Kostanay", "city", 53.2, 63.6),
    ("Ақтау", "city", 43.65, 51.15), ("Aktau", "city", 43.65, 51.15),
    ("Петропавловск", "city", 54.87, 69.15), ("Қызылорда", "city", 44.85, 65.5), ("Kyzylorda", "city", 44.85, 65.5),
    ("Қазақстан", "country", 48.0, 67.0), ("Kazakhstan", "country", 48.0, 67.0), ("Qazaqstan", "country", 48.0, 67.0),
    ("Казахстан", "country", 48.0, 67.0),
]


def local_search(db):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "search"))
    import server
    return lambda q: server.search(db, q, 10)


def http_search(base):
    def run(q):
        url = base.rstrip("/") + "/v1/search?" + urllib.parse.urlencode({"q": q, "limit": 10})
        request = urllib.request.Request(url, headers={"User-Agent": "kunde-maps-relevance/1.0", "Accept": "application/json"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return json.load(response)["results"]
            except urllib.error.HTTPError as error:
                if error.code == 429 and attempt < 3:
                    time.sleep(int(error.headers.get("Retry-After", "2")) + 1)
                    continue
                raise
    return run


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--db")
    group.add_argument("--url")
    parser.add_argument("--pause", type=float, default=0.75, help="seconds between live requests (rate limit friendly)")
    parser.add_argument("--min-top1", type=float, default=0.9)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    search = local_search(args.db) if args.db else http_search(args.url)

    hits, rr, latencies, misses = 0, [], [], []
    for query, kind, lat, lon in CASES:
        if args.url:
            time.sleep(args.pause)  # rate-limit pacing, deliberately outside the timed region
        started = time.perf_counter()
        results = search(query)
        latencies.append((time.perf_counter() - started) * 1000)
        ok = lambda r: r["kind"] == kind and abs(r["lat"] - lat) < 0.5 and abs(r["lon"] - lon) < 0.5
        rank = next((i + 1 for i, r in enumerate(results) if ok(r)), None)
        rr.append(1 / rank if rank else 0.0)
        hits += rank == 1
        if rank != 1:
            misses.append((query, rank, [(r["name"], r["kind"]) for r in results[:3]]))
        elif args.verbose:
            print("ok  ", query)
    latencies.sort()
    n = len(CASES)
    print(f"cases={n} top1={hits / n:.3f} mrr={statistics.mean(rr):.3f} "
          f"latency_ms p50={statistics.median(latencies):.0f} p95={latencies[int(0.95 * (n - 1))]:.0f} max={latencies[-1]:.0f}")
    for query, rank, top in misses:
        print(f"MISS {query!r}: rank={rank} top3={top}")
    return 0 if hits / n >= args.min_top1 else 1


if __name__ == "__main__":
    sys.exit(main())
