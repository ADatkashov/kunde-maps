# ADR 0004 - Phase 5 navigation runs in the browser, with local map matching

Status: accepted (2026-11-22)

Context: Phase 4 builds routes (Valhalla). Phase 5 must guide a user along one inside KUNDE Maps, with GPS, rerouting and no hand-off to other maps,
on the free DEV infrastructure, without native apps (Phase 6) and without sending location tracks to a server.

Decisions
- **A DOM-free navigation core in the web app** (`apps/web/nav.js`) with injected geolocation, clock, timers and route fetcher, so the state machine, matching,
  progress, rerouting and arrival are unit-tested with deterministic tracks. `nav-ui.js` is glue. No new service, no new dependency.
- **Map matching is local**: projection onto route segments with a monotonic progress window, accuracy-aware thresholds, heading cost and a whole-route search only
  for resume/jump/rejoin. Valhalla `trace_route` is not used: it needs a continuous position stream on the server (privacy, quota, cold start) and the route
  is already known on the client. It stays available as a later quality option.
- **The only position that leaves the device is the reroute request** (`from` = current position) to our own Routing API, which does not log coordinates.
  No history, storage, analytics or URL state for positions.
- **Own maneuver texts keyed by Valhalla maneuver type** (RU/KK/EN) instead of the API instruction strings: Kazakh is not provided by Valhalla, machine
  translation of arbitrary text is unsafe, and street names are shown unmodified as OSM data. Unknown types fall back to the API text with its language shown.
- **ETA = remaining baseline duration**, explicitly "no traffic, closures or live conditions"; no pace adaptation is invented.
- **Rerouting is bounded**: confirmation by several accurate fixes, cooldown, single in-flight request, Retry-After, backoff, loop guard, manual retry.
- **The external-map fallback is removed**; failures offer Retry / Edit points inside the app.

Consequences
- A browser cannot navigate with a locked screen (background tabs and `watchPosition` are suspended on Android Chrome and iOS Safari). The app pauses and
  resumes safely and uses the Screen Wake Lock API while visible; **background navigation is not implemented** and needs native clients (Phase 6), for which
  `nav.js` and the maneuver table are the reference specification.
- Everything is verified with simulated GPS (Node unit tests, Chromium with emulated geolocation, a live DEV run). **Real-world validation on a physical phone remains open.**
- Kazakh maneuver wording is ours and needs a native-speaker review; no lane guidance, roundabout exit numbers, voice or speed limits yet.
