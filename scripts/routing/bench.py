#!/usr/bin/env python3
"""Query a routing engine for fixed test routes and report distance/duration/latency (stdlib only).
Usage: bench.py ENGINE BASE_URL PROFILE [REPEATS]   (ENGINE: osrm|valhalla|graphhopper; PROFILE: car|foot|bike)
Test points are real Almaty landmarks used only to exercise the engines; routes are snapped to the road network by the engine."""
import json, os, statistics, sys, time, urllib.request

POINTS = {  # (lon, lat)
    "republic_square": (76.9456, 43.2380),
    "airport": (77.0405, 43.3521),
    "medeu": (77.0589, 43.1575),
    "green_bazaar": (76.9567, 43.2610),
    "kok_tobe": (76.9747, 43.2330),
    "astana": (71.4304, 51.1282),
    "shymkent": (69.5901, 42.3417),
    "karaganda": (73.1021, 49.8047),
}
PAIRS = [("downtown_short", "republic_square", "green_bazaar"), ("city_to_airport", "republic_square", "airport"),
         ("city_to_medeu", "republic_square", "medeu"), ("hill_short", "republic_square", "kok_tobe")]
if os.environ.get("BENCH_LONG") == "1":  # country-scale extract: intercity routes (centres of the cities, snapped by the engine)
    PAIRS += [("almaty_to_shymkent", "republic_square", "shymkent"), ("almaty_to_karaganda", "republic_square", "karaganda"),
              ("almaty_to_astana", "republic_square", "astana")]
VALHALLA = {"car": "auto", "foot": "pedestrian", "bike": "bicycle"}
OSRM = {"car": "driving", "foot": "walking", "bike": "cycling"}


def call(engine, base, profile, a, b):
    t = time.perf_counter()
    if engine == "osrm":
        url = f"{base}/route/v1/{OSRM[profile]}/{a[0]},{a[1]};{b[0]},{b[1]}?overview=false"
        data = json.load(urllib.request.urlopen(url, timeout=60))
        ms = (time.perf_counter() - t) * 1000
        r = data["routes"][0]
        return r["distance"], r["duration"], ms
    if engine == "valhalla":
        body = json.dumps({"locations": [{"lat": a[1], "lon": a[0]}, {"lat": b[1], "lon": b[0]}], "costing": VALHALLA[profile],
                           "units": "kilometers"}).encode()
        req = urllib.request.Request(f"{base}/route", body, {"Content-Type": "application/json"})
        data = json.load(urllib.request.urlopen(req, timeout=60))
        ms = (time.perf_counter() - t) * 1000
        s = data["trip"]["summary"]
        return s["length"] * 1000, s["time"], ms
    url = f"{base}/route?point={a[1]},{a[0]}&point={b[1]},{b[0]}&profile={profile}&points_encoded=false&instructions=false"
    data = json.load(urllib.request.urlopen(url, timeout=60))
    ms = (time.perf_counter() - t) * 1000
    p = data["paths"][0]
    return p["distance"], p["time"] / 1000, ms


def main():
    engine, base, profile = sys.argv[1:4]
    repeats = int(sys.argv[4]) if len(sys.argv) > 4 else 20
    rows = []
    for name, src, dst in PAIRS:
        try:
            first = call(engine, base, profile, POINTS[src], POINTS[dst])
            lat = [call(engine, base, profile, POINTS[src], POINTS[dst])[2] for _ in range(repeats)]
            rows.append({"route": name, "km": round(first[0] / 1000, 2), "min": round(first[1] / 60, 1),
                         "p50_ms": round(statistics.median(lat), 1), "max_ms": round(max(lat), 1)})
        except Exception as exc:  # report, keep going: a missing route is a result too
            detail = ""
            if hasattr(exc, "read"):
                try:
                    detail = " " + exc.read().decode("utf-8", "replace")[:300]
                except Exception:
                    pass
            rows.append({"route": name, "error": f"{type(exc).__name__}: {exc}{detail}"[:500]})
    print(json.dumps({"engine": engine, "profile": profile, "routes": rows}))


main()
