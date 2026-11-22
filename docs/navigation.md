# Navigation (Phase 5)

In-app GPS navigation for the web client: press **Start** on a route, the map follows the device position, shows the next maneuver and
the distance to it, remaining distance/time and ETA, reroutes after leaving the route, and ends on arrival. Everything stays inside KUNDE Maps;
there is no hand-off to another map product.

Two statuses are kept apart on purpose:

| Status | Meaning | State |
|---|---|---|
| **DEV navigation verified with simulated GPS** | Automated tests (Node unit + Chromium with emulated geolocation, plus a live DEV run against the real routing API, graph, tiles and search) | see `docs/development/project-state.md` |
| **Real-world navigation validated** | Driven/walked with a physical phone | **open** until the Android checklist (`docs/navigation-android-test.md`) is done |

## Design

Code lives in `apps/web`, no new service:

| File | Role |
|---|---|
| `nav.js` | Navigation core, **no DOM**: `createSession`, state machine, `RouteIndex` + matcher, GPS filter, maneuver tracking, ETA, off-route confirmation, rerouting controller, arrival, `createManager` (one active session), `cameraTarget`, RU/KK/EN texts and formatting. Unit-tested in Node with injected geolocation, clock, timers and route fetcher. |
| `nav-ui.js` | HUD, position marker (smoothed), follow camera, wake lock, background handling, keyboard. Pure glue around `nav.js`. |
| `nav.css` | HUD layout on the design-system tokens (mobile-first, desktop left column, light/dark, safe areas, 320-1920 px). |
| `map.js` | Start button on the route panel, `navroute` GeoJSON source and `nav-casing/nav-done/nav-left` layers (part of every style, so theme/language switches keep them), bounded route retry. |

### State machine

`IDLE -> PREPARING -> ACTIVE <-> GPS_WEAK | OFF_ROUTE -> REROUTING -> ACTIVE`, `PAUSED` (page in background) and the terminal states
`ARRIVED`, `STOPPED`, `ERROR`. Illegal transitions are refused (`TRANSITIONS` in `nav.js`, tested), terminal states can only reset to `IDLE`, and a
stopped session cannot be restarted. `createManager` stops the previous session before starting a new one, so there is never more than one GPS watcher.
`finish()` clears the watcher, the watchdog interval, the retry timer and aborts the in-flight reroute request.

### GPS tracking

`navigator.geolocation.watchPosition` with `enableHighAccuracy`, started inside the click on **Start** (the permission prompt is always the result of a
user action). Per fix: validity, stale/out-of-order drop (older than 15 s or older than the last accepted fix), accuracy gate (> 100 m never moves
progress; three in a row show "weak GPS"), jump filter (implied speed above the mode limit and > 60 m + accuracy is held back until three consistent
fixes agree - a tunnel exit is believed, a one-off spike is not), speed/heading from the device or derived from displacement (heading is reliable only
when moving). `POSITION_UNAVAILABLE`/`TIMEOUT` errors between fixes are common and are **not** shown; only 8 s without a usable fix raises "GPS lost" with
the last cause. The marker is drawn at the real fix and eased towards each new fix (~0.5 s); with `prefers-reduced-motion` it jumps.

### Map matching

Local, no server. The position is projected onto the route polyline segments (not "nearest vertex"):
- a window around the known progress (`along - 30 m ... along + max(400 m, 12 s of travel + 4x accuracy)`) is searched first, so a route that crosses
  or revisits itself is matched on the leg being travelled; progress never decreases from noise;
- heading adds a small cost for the opposite direction on the same road (out-and-back / dual carriageways);
- off-route when lateral distance > mode base (car 35 m, bike 25 m, foot 20 m) + GPS accuracy (capped at 60 m); fixes worse than 60 m neither confirm nor
  reset a deviation; the whole route is searched only after a resume, a believed jump, or to recognise a rejoin (three consistent fixes).
Valhalla map matching (`trace_route`) was **not** used: it would need a continuous stream of positions to the server. It remains an option for
future "snap to road" quality work.

### Maneuvers and languages

Valhalla maneuver `type` + `street` from the Routing API. Instruction **texts are ours**, keyed by type, in RU/KK/EN (`NAV_STRINGS`): they never
translate free text and never invent road names (the street is OSM data shown as is). Unknown types fall back to the API text with an explicit
language badge. The API has no roundabout exit number or lane data yet, so those are not shown. The step's `location` is projected on the geometry
once (monotonic) to get its position along the route.

### ETA

`remaining time = sum of the remaining Valhalla step durations` (scaled to the route duration), `ETA = now + remaining`. It is the **typical time
from OSM speeds** and says so in the UI: no traffic, closures or live conditions, and no adaptation to the driver's actual pace.

### Rerouting

After 3 qualifying off-route fixes spanning >= 2 s the state becomes `OFF_ROUTE`; the controller then requests **one** route from the current position to the
original destination (`GET /v1/route`, no alternatives): cooldown 10 s between attempts, at most one request in flight (a new one aborts the old),
`429 Retry-After` honoured (capped at 120 s), backoff 4/8/16/30 s, at most 4 automatic failures then manual **Retry**, and a loop guard (6 reroutes in 5 min
need a manual retry). Returning to the road for two fixes cancels a pending reroute. A late reply after cancellation is ignored. Cold start
shows "the routing service is waking up". On failure the previous route stays on screen.

### Arrival

Progress at the end of the route **and** on the route (a parallel road does not count) for two consecutive fixes, within `max(30 m, accuracy)`
(foot 15 m, bike 20 m); a destination that is not on the road network is also recognised when two fixes are within 10-15 m with good accuracy. Then
the session ends, the watcher and timers are released, the banner shows "You have arrived" and **Done** returns to the map.

### UI

Mobile: top banner (large maneuver icon, distance, instruction, street, "then" hint), full-screen map, bottom panel (ETA, remaining time, remaining
distance, progress, maneuver list, End). Desktop: the same as a 380 px left column; keys `C` recenter, `L` list, `Esc` closes the list. **End needs two
taps** (no dialog covering the map). Dragging the map stops following and shows **Recenter**; the camera never pulls back by itself. Camera: heading-up with
a reliable heading, otherwise north-up; zoom by speed; 50 deg pitch for driving; padding from the real panel sizes; one `easeTo` at a time. The OSM
attribution stays visible above the bottom panel. A safety line (obey traffic laws; times ignore traffic) is on the route panel and for the first 12 s
of navigation.

## Route requests (all clients of the web app)

The OpenStreetMap fallback button was **removed**. A failed request shows "Could not build the route" with **Retry** and **Edit points**; the service
being down shows its own message. Transient failures (cold start, 5xx, timeout) are retried automatically at most twice (4 s, 8 s) with a visible waiting
message; `429` shows the wait and Retry. Without `MAPS_ROUTING_URL` the Route button is hidden. OSM attribution remains in the map and in route replies.

## Privacy

- Position is used only in the browser, only after the user presses Start, only while a session is active. No history is kept (`nav.js` has no storage,
  beacon, XHR or `fetch` of its own - a unit test greps for that), nothing is written to the URL (a deep link carries the destination and mode only, never the
  start or a track), no analytics hooks exist.
- The only network use of a position is the reroute request (`from` = current position) to our own Routing API, which does not log coordinates
  (`docs/routing-api.md`).
- Stopping clears the position, marker, layers and timers.

## Known limitations

- **Browsers suspend GPS and JavaScript when the screen locks or the tab goes to the background** (Android Chrome throttles/freezes background tabs and
  stops `watchPosition` updates; iOS Safari suspends the page and does not deliver position in the background). The app pauses on `visibilitychange`, never
  trusts the pre-pause position and resumes with a fresh fix, and uses the Screen Wake Lock API (Chrome Android 84+, Safari 16.4+) to keep the screen on
  while the page is visible. **Continuous background navigation with a locked screen is not implemented and cannot be promised in a mobile browser.**
  Native apps (Phase 6: Flutter + MapLibre) with foreground services / background location are required; see the plan below.
- No voice guidance (speech synthesis not implemented), no lane guidance, no roundabout exit numbers, no speed limits, no traffic or live closures,
  no waypoints, no offline mode. Kazakh road *names* are as in OSM; maneuver wording in Kazakh is ours (needs a native-speaker review).
- Real-device GPS quality, battery use and heating are **not measured**.
- Render Free cold start (30-60 s) can delay the first route and a reroute; the UI waits and retries a bounded number of times.

### Plan for full background navigation (not implemented)

Phase 6 native clients reuse the same contracts: Routing API replies (geometry + steps), the maneuver table and thresholds in `nav.js` are the
specification for a Dart port; background location via Android foreground service / iOS `allowsBackgroundLocationUpdates`; on-device matching (same
algorithm), optional Valhalla `trace_attributes` for snapping; voice prompts via platform TTS.

## Testing guide

| What | Command | Proves |
|---|---|---|
| Navigation core + web core | `node --test apps/web/test/*.test.js` | state machine, projection/self-crossing, progress, ETA, maneuvers, stale/inaccurate/jump fixes, signal loss, off-route, rerouting (cooldown, Retry-After, failures, loop guard, cancellation), arrival, background, cleanup, privacy, RU/KK/EN. Deterministic tracks over a real captured Valhalla reply (`apps/web/test/fixtures/route-almaty-car.json`). |
| Browser, simulated GPS | `WEB_URL=... node scripts/test-navigation-ui.js` (Playwright; mocked MapLibre and scripted routing API; CI job "Chromium map smoke") | full trip with deviation/reroute/arrival, denied GPS, weak accuracy/jump/signal loss, background/return, two-tap end, 429/502/cold start, foot/bike, RU/KK/EN light/dark, layouts 320-1920 px, a11y. |
| Live DEV, real backend | `node scripts/test-navigation-dev.js` (workflow "DEV navigation E2E", manual) | real Routing API + graph + tiles + Search API + real MapLibre, simulated GPS along the real geometry, screenshots, console/CSP/external-navigation checks. |
| Physical phone | `docs/navigation-android-test.md` | **not done yet** |
