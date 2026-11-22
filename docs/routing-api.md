# Routing API (Phase 4)

`GET /v1/route?from=<lat>,<lon>&to=<lat>,<lon>&mode=car|foot|bike&lang=ru|kk|en` - routes inside Kazakhstan on OpenStreetMap data (Valhalla).
Engine choice and measurements: `docs/routing-evaluation.md`. Code: `services/routing/` (front), `infrastructure/routing/Dockerfile`.

## Endpoints
- `GET /v1/route?from=&to=&mode=car|foot|bike&lang=&alternatives=1` (used by the web app; CORS allowlist).
- `POST /v1/routes` (server-to-server, JSON <= 2 KB): `{"origin":{"lat","lon"},"destination":{"lat","lon"},"mode":"driving|walking|cycling","alternatives":true,"language":"ru"}`;
  same limits, API keys and reply. POST is not CORS-enabled for browsers.

## Reply (200)
`mode`, `distance_m`, `duration_s`, `geometry` (GeoJSON LineString `[lon,lat]`, simplified to ~4 m: a 20 km route is ~100 points), `bbox`,
`steps[]` (`instruction`, `street`, `type` = Valhalla maneuver type, `distance_m`, `duration_s`, `location`), `instruction_language`
(Kazakh requests are narrated in Russian: Valhalla has no Kazakh text, and the reply says so), `note` (**typical time from OSM speeds, no traffic,
closures or live conditions** - never present it as an ETA), `attribution` (`© OpenStreetMap contributors (ODbL)`), `engine`, `start`/`end` (snapped coordinates), `alternatives[]` (up to 2 more routes of the same shape, empty unless requested), `data_version` (`MAPS_ROUTING_DATA_VERSION`, set by the deployer to the graph build id).

## Errors (JSON `{error}`)
400 `from_must_be_lat,lon` / `to_must_be_lat,lon` / `*_out_of_range` / `outside_coverage` (Kazakhstan bbox only) / `mode_must_be_car_foot_or_bike` /
`lang_must_be_ru_kk_or_en` / `points_too_close` (< 10 m) / `route_too_long`; 404 `no_route` / `no_road_near_point`; 401 `invalid_api_key`;
429 `rate_limited` + `Retry-After`; 502 `routing_unavailable` + `Retry-After: 5` (engine down or malformed engine reply; details are never leaked); 503 `busy`.

## Protection and privacy
Valhalla has no authentication, so it listens on 127.0.0.1 inside the container; the public port belongs to our front: per-IP token bucket
(default 60/min, burst 20), API keys (`X-API-Key`, hash-only config, per-key quota, same code as the Search API - see `docs/search-prototype.md`),
concurrency gate (default 6), safe metrics (`/metrics`, bearer token, 404 otherwise), CORS allowlist for the web origin, security headers.
**Coordinates, routes and IPs are never logged** (access log = route, status, ms; the integration test greps the container log for coordinates).
The web app uses the device position only for the one request (sent to this API only; not stored, no history).

## Deploy configuration (Render, Docker, context = repo root, Dockerfile `infrastructure/routing/Dockerfile`)
`MAPS_ROUTING_GRAPH_URL` (https R2 URL of `valhalla-tiles.tar`; SHA256 from the sidecar `.sha256` next to it, or pin with `MAPS_ROUTING_GRAPH_SHA256`),
optional `MAPS_API_KEYS`, `MAPS_METRICS_TOKEN`, `MAPS_RATE_LIMIT_PER_MINUTE`, `MAPS_TRUSTED_PROXY_HOPS` (measure with the same method as the Search API).
Web: `MAPS_ROUTING_URL=https://<routing host>` (adds `routingUrl` to config.json and the origin to the CSP; without it the "Route" button is hidden - there is no
external-map fallback).

## Graph build
Actions -> "Build Kazakhstan routing graph" (manual): fetch the Geofabrik extract -> Valhalla tiles (~2 min, ~1.2 GB RAM) -> single `valhalla-tiles.tar` (~300 MB)
-> smoke test (real car/foot/bike routes) -> end-to-end test of the real API container on that graph -> immutable publish to R2
(`routing/valhalla-kazakhstan-<run>.tar/.sha256/-PROVENANCE.txt`) -> anonymous download + checksum verification.

## Limitations
No traffic, no live closures, no time-dependent restrictions, no timezone/admin data in the graph, Kazakh narration falls back to Russian,
car/foot/bike only (no transit), two-point routes (no waypoints/alternatives yet), Valhalla image tag `latest` (pin by digest before production).

## Navigation (Phase 5)
The web app uses the same `GET /v1/route` for active navigation: the first route comes from the route panel; **rerouting** sends the current position as `from` and the
original destination as `to` (no alternatives), at most one request in flight, 10 s cooldown, `Retry-After` honoured. The GPS track is never sent: matching is local.
Maneuver `type` + `street` drive the HUD; instruction texts are localized by the client (`docs/navigation.md`).

## Web deep links
`#lat=..&lng=..&name=..&poi=n123&route=car|foot|bike` opens the place and the route panel with that place as destination. The start is chosen by the viewer (device position or another point) and is **never** written to a URL; the web app updates the hash when the mode changes and removes `route=` when the panel is closed.
