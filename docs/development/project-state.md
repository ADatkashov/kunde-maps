# Project state (updated 2026-11-22, after Phase 2 stages A-B)

Verified in this session by executed checks:
- Search API (Render, `kunde-maps-search-dev`): live, index 1,450,805 rows; 403 root cause = Cloudflare error 1010 on the
  `Python-urllib` User-Agent (fixed in PR #2, merged as `3fe9994`). See `docs/search-prototype.md`.
- Web (`apps/web`): new design system, search UI wired to the Search API, share links, RU/KK/EN, light/dark.
  Tests: 15 Node unit tests, 17 browser scenarios, 14 Search API tests, legacy smoke test.
- Visual check with the real map (real PMTiles from R2, real Search API) in Chromium at 1366x768, 1920x1080 (dark),
  390x844 and 360x740 (touch): search -> select -> fly-to -> marker -> card worked, 0 console errors.

Known limits
- Search API has per-IP rate limits but no API keys/tokens yet. (CSP and vendoring are done, see ADR 0003).
- Render Free: cold start (~30-60 s) and ~155 MB index re-download per new instance.
- No categories/POI filters, routing, navigation, favorites, mobile apps yet.
- Map style v2 has no POI icons/sprites, no own glyph host, no terrain shading.

Phase 2 (this update)
- A. Search API protection (PR #5, #6, live on DEV): token-bucket rate limit with `429` + `Retry-After`, concurrency cap, `/metrics`
  (token), JSON log without query/IP, security headers. Live measurement fixed `MAPS_TRUSTED_PROXY_HOPS=3` on Render.
  Not verifiable from the CI/sandbox egress (rotating IPs): a live hard-429 from one fixed client; covered by unit/HTTP tests.
- B. Cross-script search + ranking (see `docs/search-prototype.md`): schema v2, `textnorm.py`, relevance benchmark
  (top-1 0.417 -> 1.000 on 36 real places), web sends `lang` and map centre. Takes effect on DEV after the index is rebuilt
  from OSM (new tags) and `MAPS_SEARCH_INDEX_*` are switched; the server remains compatible with the old v1 index until then.
- Open: cartographic style v2, web CSP/SRI, index for house-number geocoding, API keys for B2B.
- C. Cartographic style v2 (generated light/dark styles, see `docs/design/design-system.md`): full OpenMapTiles layer use, road hierarchy
  with casings, parks/water/landcover/ice/rock, peaks with elevation, RU/KK/EN labels, POI dots, house numbers. CI: generator drift,
  schema/field check against the real archive, official spec validator, mutation-checked.
- Phase 3 (Places & POI, live on DEV): categories from OSM tags (17), index schema v3 (77,482 places, real contact coverage 14-24%), Places API,
  category chips, viewport/nearby search, clustered markers, place cards with real data (hours interpreter 97% of real strings), saved places,
  share links by OSM id. 36 browser scenarios, 29 web unit tests, 68 Search API tests. See `docs/places-api.md`, ADR 0002.
- Known limits: directions are an external OSM link; POIs are colored dots (no icon sprite); contact data is as complete as OSM (mostly absent);
  places need zoom >= 11; no photos/reviews/ratings (no licensed source); saved places do not sync across devices.
- Web hardening (ADR 0003): MapLibre/PMTiles vendored and checksummed, no inline scripts, strict CSP + security headers generated from the configured origins; verified on the real map with 0 violations. Remaining third-party host: public glyph server.
- Glyphs self-hosted (Open Sans x4 stacks, ranges 0-1535 + punctuation, 1.6 MB): the page contacts no third-party host; CSP connect-src lists only own origin, tile host and Search API.
- Phase 4 routing (see docs/routing-api.md, docs/routing-evaluation.md): measured OSRM/Valhalla/GraphHopper; Valhalla chosen. Graph build+publish workflow, authenticated routing front, web route UI (route line, modes, steps, tap-to-set-start) merged; the service on Render is created separately (free tier first).
- Search: API keys with per-key quotas (server-to-server), house-number address search with proximity and locality.
- **Phase 4 live (2026-11-22)**: Routing API https://kunde-maps-routing-dev.onrender.com (Render Free, $0; Valhalla graph of all Kazakhstan from R2 build 45006741679, ~300 MB) + in-app route panel on DEV: editable A/B with suggestions, device position / tap on map, car/foot/bike, alternatives, line + A/B pins, steps, deep links (`#route=`), no external map links. Verified live in Chromium against the real backend (desktop, dark, mobile). Not done: active GPS navigation (Phase 5), Kazakh narration (Valhalla falls back to Russian), free-tier cold start after idle.

- **Phase 5 navigation (2026-11-22, PR #35, main `0ae53f6`, web deployed to DEV)**: in-app GPS navigation (Start on a route -> follow camera, turn-by-turn RU/KK/EN, local map matching, automatic rerouting, arrival, clean release), external-map fallback removed. See `docs/navigation.md`, ADR 0004.
  - **DEV navigation verified with simulated GPS**: 67 Node unit tests, Chromium with emulated geolocation (11 scenarios incl. denied/weak/lost GPS, jump, background, 429, cold start, layouts 320-1920 px, a11y), search/route UI regression, and a live run against the real DEV Routing API, graph, tiles, Search API and MapLibre (full trip with real reroute and arrival; 320/390/1366/1920 px, light/dark, RU/KK/EN; no console errors, no CSP violations, no foreign hosts, OSM attribution visible).
  - **Real-world navigation validated: OPEN.** No physical-device test yet (`docs/navigation-android-test.md`). Browser background/locked-screen navigation is not possible and is not claimed.
  - Found by the live run and fixed: the bottom HUD covered the OSM attribution on phones. Known, pre-existing: MapLibre "cannot fit within canvas" warning when the route panel opens on a phone; Open Sans glyph range 8704-8959 not self-hosted.

- **Phase 5.5 premium UI/UX redesign (2026-11-22)**: new design system v2 (graphite dark / light), full-screen map with a persistent 3-state bottom sheet, tab bar (Search, Directions, Navigator, Saved, Profile),
  quick actions and "Near you" categories backed by the real Places API, chips in the requested order, new place card, route planner and navigation HUD restyled (behaviour of Phase 4-5 unchanged),
  map tools (layers, zoom, compass, locate with permission/accuracy state), Profile with local settings (language, theme, units, low-power, search history, delete local data), optional 3D buildings
  (only real tile heights), desktop sidebar composition. See `docs/design/design-system.md`, ADR 0005, `docs/design/traffic-architecture.md`.
  - Honest gaps: no traffic (no verified source), no voice search, "Add a place" is an explanatory dialog, no accounts/sync, weather/ratings/photos not shown. Physical Android GPS test still **open**.
  - Tests: 79 Node unit tests, 48 + 11 + 19 Chromium scenarios (mocked map/APIs) and a live DEV suite (real backend, simulated GPS).
  - **Phase 5.5 shipped (PR #37, main `1b536b2`)**; Render DEV has autoDeploy off, so it was deployed manually (`dep-dc1f7r942hec73a6rrug`, existing free service, no new resources). Verified on the deployed DEV: `scripts/test-redesign-live.js` 8/8 (real tiles, Search/Places/Routing APIs, security headers, GPS simulated) and `scripts/test-navigation-dev.js` all scenarios (full trip with reroute and arrival, 4 viewports/themes/languages, Phase 1-4 regression). Screenshots: `docs/design/screenshots/after-*.png`. Physical Android GPS test: still open.
