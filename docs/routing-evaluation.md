# Routing engine evaluation (Phase 4, measured 2026-11-22)

Question: which open-source engine can serve car, pedestrian and bicycle routes for Kazakhstan at the lowest cost, and what is the smallest
hosting that works? Everything below was **measured**, not estimated: `scripts/routing/run-engine.sh` + `.github/workflows/routing-benchmark.yml`
(manual workflow, no deploy, no paid resources) build each engine's graph from the Geofabrik extract on a free GitHub runner
(ubuntu-latest, 4 CPU / 16 GB), start the server and query fixed routes. Re-run: Actions -> routing-benchmark -> scope `almaty|kazakhstan`.
Data: OpenStreetMap contributors (ODbL), extract `kazakhstan-latest.osm.pbf` (217 MB), Almaty cut = bbox 76.70-77.25 / 43.05-43.45 (21 MB).

Engines: OSRM v5.27.1 (MLD, one graph **per profile**), Valhalla (gis-ops image, one graph for all profiles), GraphHopper 10.2 (CH for car+foot+bike).
Test points are real landmarks (Republic Square, Almaty airport, Medeu, Green Bazaar, Kok Tobe; Shymkent, Karaganda, Astana city centres);
the engine snaps them to the road network.

## Build and memory (graph preparation = CI job, not the server)

| engine | scope | build time | peak RAM while building | graph on disk | server RAM after queries |
|---|---|---|---|---|---|
| OSRM car / foot / bike | Almaty | 12 / 8 / 9 s | 221 / 295 / 298 MiB | 97 / 149 / 149 MB | 53 / 87 / 87 MiB |
| Valhalla (all 3) | Almaty | 37 s | 211 MiB | 30 MB | 112 MiB |
| GraphHopper (all 3) | Almaty | 9 s | 1236 MiB | 20 MB | 229 MiB |
| OSRM car / foot / bike | **Kazakhstan** | 76-87 / 79-88 / 89-100 s | 1.4 / 2.3 / 2.2 GB | 1006 / 1323 / 1326 MB | **523 / 678 / 680 MiB (3 processes ~1.9 GB)** |
| Valhalla (all 3) | **Kazakhstan** | 98-129 s | 1.0-1.2 GB | **289 MB** | **118-202 MiB** |
| GraphHopper (all 3) | **Kazakhstan** | 108 s | 2.0 GB | 256 MB | 828 MiB (heap cap -Xmx2g) |

Memory limit test (Kazakhstan graph, serve container capped at **512 MB with swap disabled**, 8 concurrent clients): **Valhalla was not OOM-killed**
(202 MiB RSS); **OSRM could not start** (its car graph alone needs ~520 MiB). GraphHopper's JVM was not capped (needs a heap of ~600 MB+).

## Query behaviour (all engines returned plausible routes for car, foot and bike in Almaty)

| route | OSRM car | Valhalla car | GraphHopper car |
|---|---|---|---|
| Republic Sq -> airport (Almaty) | 19.7 km, 32.7 min | 20.5 km, 25.1 min | 20.4 km, 29.9 min |
| Republic Sq -> Medeu | 15.1 km, 26.1 min | 15.1 km, 22.0 min | 15.0 km, 22.8 min |
| Almaty -> Shymkent | 689 km, 503 min | 693 km, 446 min | 672 km, 509 min |
| Almaty -> Karaganda | 992 km, 590 min | 1011 km, 496 min | 990 km, 537 min |
| Almaty -> Astana | 1223 km, 735 min | 1243 km, 618 min | 1206 km, 666 min |

Distances agree within 3 %. **Durations differ by up to 19 %** because each engine derives speeds from OSM `maxspeed`/road class; none uses traffic.
They must be presented as "typical travel time without traffic", never as an ETA (project rule: no invented traffic/ETA). Walking = ~5 km/h and cycling
~15-16 km/h in all three.

Latency (single client, p50): OSRM 0.5-4 ms, GraphHopper 3-13 ms (also for 1200 km), Valhalla 10-50 ms (35-51 ms for 700-1250 km).
Throughput with 8 parallel clients on the 4-core runner: GraphHopper ~440 req/s car / ~320 foot+bike (p95 37-53 ms); Valhalla ~60 req/s car+bike and
~37 req/s foot **inside a 512 MB container** (p50 120-220 ms, CPU saturated); OSRM not measured under the 512 MB cap (does not fit).

Engine limits to know: Valhalla rejects routes above `service_limits` (defaults: 500 km car, 250 km bicycle/pedestrian) - configurable, and the
first Kazakhstan run proved the 1200 km car route works once raised; OSRM answered `NoRoute` for 600-1200 km foot/bike (expected, walking/cycling
networks are not connected that far); GraphHopper accepted all (e.g. 889 km walking).

## Hosting options (Render prices read from render.com/pricing on the day of measurement - re-check before buying)

Render Free = 512 MB RAM, <1 CPU, sleeps after inactivity, ephemeral disk; Starter $7/mo = 512 MB, 0.5 CPU; Standard $25/mo = 2 GB, 1 CPU;
Pro $85/mo = 4 GB, 2 CPU; persistent disk $0.25/GB/mo. Graph artifacts live in the existing Cloudflare R2 bucket (a 289 MB file is far below the free tier).

| option | what runs | fits? | monthly cost |
|---|---|---|---|
| **A. Valhalla, Render Free (DEV)** | all 3 profiles, whole Kazakhstan, graph downloaded at start like the search index | yes, 202 MiB measured in a 512 MB cap | **$0** (sleeps when idle, slow cold start while 289 MB downloads, <1 CPU) |
| **B. Valhalla, Render Starter** | same, always on | yes, same footprint | **$7** (0.5 CPU: expect order-of-magnitude 10 req/s) |
| C. Valhalla, Render Standard | same + page-cache headroom, 1 CPU | comfortable | $25 |
| D. GraphHopper, Standard | JVM with -Xmx ~1 GB, much faster per request | needs >= 1 GB | $25 |
| E. OSRM, Standard | 3 processes (car/foot/bike) ~1.9 GB | barely | $25 (or car only ~0.55 GB) |

## Recommendation

**Valhalla.** It is the only engine that serves all three profiles for the *whole* country from a 289 MB graph in ~200 MB of RAM, so the free tier
already works for the DEV environment and the smallest paid step ($7/mo Starter) works for an always-on product. It also gives turn-by-turn
maneuvers (needed for Phase 5 navigation), isochrones, matrix and map matching from the same data. Trade-offs: slower per request than OSRM/GraphHopper
(10-50 ms) and slightly more optimistic car durations; if the product later needs thousands of routes per second, GraphHopper on Standard ($25)
is the upgrade path measured here.

Plan (no paid resources needed for the first steps):
1. CI workflow builds Valhalla tiles from the same Geofabrik extract as the search index (~2 min), publishes `valhalla-kazakhstan-<run>.tar` + SHA256 to R2.
2. One Docker service on **Render Free** runs Valhalla *behind a thin authenticated wrapper* (same rate limiting / API keys / metrics / CORS allowlist as the Search
   API); Valhalla itself is bound to localhost so the only public endpoint is ours (project rule: no unauthenticated externally reachable service).
3. Web app: route line, distance, typical duration (no traffic wording), turn list, car/foot/bike switch; replaces the interim OpenStreetMap directions link.
4. Upgrade decision when real traffic exists: Starter $7 (always-on) - **needs your approval before creating any paid service**.

Limitations of this evaluation: one runner type, short load test (480 requests per profile), no route-quality ground truth beyond plausibility
(distances within 3 % across engines), no traffic, and OSM data quality bounds everything (e.g. restrictions, closed roads).
