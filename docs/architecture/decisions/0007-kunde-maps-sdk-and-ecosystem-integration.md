# ADR 0007 — KUNDE Maps SDK and ecosystem integration

Status: accepted for implementation (SDK 0.1.0 and Taxi routing integration). Date: 2026-11-22.
Scope: this repository (`kunde-maps`) and the KUNDE Super App repository (`kunde`).

## Context
KUNDE Maps (this repository) has a working web client, a Flutter Android/iOS client, a Search/Places API (SQLite FTS5) and a Routing API
(Valhalla behind a protective front). The Super App (`kunde`) has Consumer, Partner, Executor and Admin Flutter apps and a Java 21 / Spring Boot
modular monolith. Audit of both `main` branches (code, not documentation):

| Area in `kunde` | What exists in code | Map or routing use today |
| --- | --- | --- |
| Rides (Taxi) backend | `RideRouting` provider interface (geocode, reverse geocode, road route), quotes priced by the Rides tariff, dispatch, driver location (`/rides/{id}/location`) | **Only `SyntheticRideRouting`** (a fixed fixture, internal environments only). No real provider is wired. |
| Delivery backend | Quotes, courier dispatch, `DeliveryTracking` (courier position, 5 s write limit, 2 min freshness), consumer polling | Reuses the same `RideRouting` bean; synthetic only |
| Consumer app | Address panel, Rides screen (address search list + quote + trip), Delivery screen, Food/Groceries checkout addresses | No map widget. Addresses are text plus coordinates returned by the backend provider; the driver position is printed as numbers |
| Executor app | Work screens for Delivery, Auto, Food, Leisure | No map, no navigation |
| Partner app | Business delivery screen | No map |
| Admin | Rides/Delivery admin | No map |
| `kunde` Flutter dependencies | `geolocator` only; no MapLibre | – |

| Area in `kunde-maps` | Verified in code |
| --- | --- |
| Tiles | PMTiles (R2), native MapLibre in the Flutter app |
| Search | `GET /v1/search`, `/v1/places`, `/v1/places/{id}`, `/v1/categories` (forward search only; **no reverse geocoder**) |
| Routing | `GET /v1/route`, `POST /v1/routes` (server to server, API keys), alternatives, steps, no traffic |
| Navigation | `RouteProgress`, rerouting, voice (`flutter_tts`), foreground location service - all inside `apps/mobile` (now moved, see below) |
| Auth / quotas | Per-IP token bucket, API keys (hash-only), concurrency gate; coordinates never logged |

Consequence: Taxi and Delivery already depend on a seam (`RideRouting`) that no real map provider implements, and every client screen that needs a
map would otherwise copy the Maps app code.

## Decisions

1. **One Flutter package, `packages/kunde_maps_sdk`, extracted from the working Maps app** (code moved, not rewritten). The Maps app now consumes
   the SDK through thin compatibility aliases, so there is one copy of the API client, route matching, navigation, voice, style builder and
   MapLibre helpers. `apps/mobile` keeps its tests; they now exercise the SDK code.
2. **Public interfaces (0.1.0):** `KundeMapView` / `KundeMapController` (MapView), `PlaceSearch` + `PlaceSearchField` (PlaceSearch),
   `LocationPicker`, `Geolocation` / `LocationSource` (Geolocation), `Routing` (Routing), `RoutePreviewData` + `RoutePreview` (RoutePreview),
   `NavigationController` (Navigation: GPS matching, voice, reroute, arrival), `Eta`, `MapMarker` / `MapMarkers`, `CameraController`.
   Each is usable alone: the pure-Dart parts (`MapsClient`, `Routing`, `PlaceSearch`, `Eta`, `RouteProgress`) need no widget, and widgets take
   their services as constructor arguments.
3. **Environment, localisation, errors.** `MapsConfig` (HTTPS-only URLs, environment, language, timeout, `MapsFeatures`); `MapsStrings` (RU/KK/EN
   navigation prompts, picker labels and error messages, tested for completeness); one exception type, `MapsException`, with a stable `MapsErrorKind`.
4. **The SDK has no business logic.** It never mentions rides, orders, couriers, tariffs or payments. It returns geometry, distance and a
   *typical* travel time (`trafficAware == false`, the UI says so). **A distance is not a fare**: Taxi pricing stays in the Rides backend, which
   prices a quote from the route it obtains through `RideRouting`.
5. **Backend uses the same Maps API through a typed contract, not a second routing engine.** In `kunde`, a `KundeMapsRideRouting` implements the
   existing `RideRouting` seam over the Maps `POST /v1/routes` and `GET /v1/search` endpoints (server-to-server API key, timeouts, bounded
   response, outage mapped to `RideRouting.Unavailable`). It is created only when `app.maps.enabled=true` with a configured HTTPS base URL, so
   Taxi and Delivery keep failing closed (503) exactly as today when it is off. No Valhalla code or graph is copied into `kunde`.
6. **Reverse geocoding is not faked.** The Maps API has no reverse geocoder. The Maps-backed provider answers a reverse lookup only with a real
   nearby place that has an address within a small radius, otherwise "not found". A real reverse geocoder is a separate Maps Platform item.
7. **Feature flags are backend-controlled.** The SDK enforces `MapsFeatures` but does not decide them. `kunde` exposes `maps.*` capabilities from
   its backend; new client behaviour (map in Taxi, driver tracking, navigation) ships dark and is shown only when the backend flag is on.
8. **Live tracking rules** (apply to any host that streams positions through the SDK): authenticated owner/assignee only; server-side write
   throttle (Delivery already enforces 5 s); positions deleted when the trip ends; reads return only a fresh fix (2 min) and nothing else about
   the courier or driver; coordinates are never logged; the subscription is a poll bound to the trip lifecycle (stops when the trip is no longer
   active), so there is no long-lived socket to leak. The SDK gives hosts `coarsen()` and keeps its own GPS track in memory only.
9. **No new microservices.** Search, Routing and Web already exist. The SDK is a library; `kunde` gains one adapter class in the monolith.
10. **Versioning and compatibility.** SemVer. Consumers pin a git tag (`sdk-vX.Y.Z`) of this repository
    (`git: {url, path: packages/kunde_maps_sdk, ref}`). Public API additions are minor; removals/renames are major with one deprecated release
    first. The Maps API is versioned (`/v1`); the SDK ignores unknown fields. CI runs the SDK on Flutter **3.47.9 (Super App) and 3.50.1 (Maps
    app)** so neither side can break the other. The Maps Platform (tiles, search index, routing graph) updates independently of apps.
11. **Map weight follows the need.** Address selection uses `LocationPicker` (one map, no navigation stack). `NavigationController` is only
    for Executor/driver guidance. Food/Groceries address choice does not get navigation.

## Integration plan and status
| Step | Where | Status |
| --- | --- | --- |
| SDK extraction, Maps app consumes SDK, CI for both Flutter versions, live DEV contract test | `kunde-maps` | this change |
| `KundeMapsRideRouting` + `maps` flag + capability | `kunde` backend | next PR |
| Consumer Taxi: picker, route preview, driver on map | `kunde` mobile | after SDK tag |
| Executor: driver navigation, Delivery job route | `kunde` mobile | after Taxi |
| Consumer addresses (Food, Groceries, services), service-area check | `kunde` mobile | after Executor |

## Out of scope / limitations
- No traffic, no live closures, no price. ETA is "typical time".
- No reverse geocoder, no turn-by-turn Kazakh narration (Valhalla falls back to Russian, the API says so).
- `apps/mobile/lib/main.dart` still drives MapLibre directly (its state machine is app specific). It already uses the SDK client, route matching,
  navigation, style and camera types; replacing its map widget with `KundeMapView` is a later, separate refactor to avoid regressions.
- Production deployment of any of this requires separate approval.
