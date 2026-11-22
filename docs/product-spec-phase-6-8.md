# KUNDE Maps — Product Technical Specification & Delivery Plan (Phase 6.1–8)

**Status:** Approved product direction; implementation and acceptance pending.  
**Approved:** 2026-11-22  
**Scope:** Standalone `ADatkashov/kunde-maps` platform, Kazakhstan-first, Almaty-first quality.  
**Source of truth:** This document records the owner's agreed priorities; actual completion requires code, CI, release and device evidence.

## 1. Product goal

Build an independent, self-hosted mapping and navigation platform for Kazakhstan with reliable real-world routing, high-quality local data and polished native Android/iOS UX. Improve local usefulness in Almaty incrementally; do not claim parity with 2GIS without measured evidence.

## 2. Baseline and confirmed observations

- Existing architecture includes OSM-derived map tiles, MapLibre, Search/Places and Valhalla routing APIs, web app and Flutter mobile clients.
- Android v0.6.0+1 signed Release APK was installed on a physical device. Owner confirmed: launch, Almaty map rendering, address/POI search, place detail and GPS location.
- Owner reported two defects: **mobile interface is too basic** and **A → B routing does not work on physical Android**. Treat the routing issue as a P0 confirmed symptom, **not** an identified root cause.
- Turn-by-turn updates, voice guidance, locked-screen behavior, GPS/notification shutdown and iOS physical-device validation remain unverified. Do not mark them PASS or FAIL without evidence.
- Web Phase 5.5 is a design and interaction reference, not proof of mobile implementation quality.

## 3. Phase 6.1 — Android Routing Fix & Premium Flutter UI (P0)

### Functional requirements

1. Diagnose the physical-device routing failure end-to-end: A/B selection, request URL/method, coordinates and order, payload, HTTP/network/TLS/permissions, API response, polyline decoding, MapLibre source/layer updates, camera fit, errors and cold starts. Compare with working web API contracts. Record the actual root cause with reproducible evidence.
2. Support real A → B routing for driving, walking and cycling where supported by the backend; display route geometry, distance, ETA and alternatives only when returned by API. Never use mock routes in Release.
3. Show actionable loading, empty, timeout and error states; retry without silently hiding failures. Preserve privacy in logs.
4. Implement premium, original KUNDE Maps Flutter UX inspired by the existing web Phase 5.5: full-screen map, prominent search, category chips, draggable bottom sheet (collapsed/half/expanded), accessible place cards, map controls and five meaningful tabs (Search, Routes, Navigator, Favorites, Profile).
5. Route editor must allow origin/destination selection, swap, mode selection, route overview and clear Start action. Navigation UI must prioritize next maneuver, remaining distance, ETA, location and Stop action.
6. RU/KK/EN, light/dark themes, small-screen SafeArea, keyboard/gesture handling, screen-reader labels, responsive layouts and honest data states are mandatory.
7. Preserve native MapLibre and existing backend contracts; no WebView replacement, fabricated traffic, reviews, POIs, business hours or decorative nonfunctional buttons.

### Acceptance criteria

- Android automated integration/E2E scenario using **real DEV routing API** confirms a route between two valid Almaty points, route line, distance/ETA and navigation start.
- Android emulator visual evidence for main/search/place/route/navigation screens at representative small/medium screen sizes, both themes and RU/KK/EN; no overflow or gesture conflicts.
- Signed Release APK has incremented versionCode, original package name and same approved signing identity; installs as an update without data loss.
- All required CI, license and security checks pass. Report links to PR, commit, workflow, artifact, SHA-256 and screenshots.
- **Physical-device route confirmation remains OPEN until owner retests the new APK.** Emulator success cannot substitute.

## 4. Phase 6.2 — Physical Navigation Validation (P0/P1)

### Requirements

- Test on actual Android device: real route A → B, GPS tracking, maneuvers, ETA, rerouting when deviating, arrival, voice prompts, navigation when screen is locked (within platform limits), Stop action, foreground-service notification and location resource cleanup.
- Test weak/no connectivity, permission denial/revocation, app resume, battery restrictions and service restart. Do not imply background navigation works without evidence.
- Test iOS on real device when Apple signing/test distribution is available; distinguish simulator from physical-device results.
- Use a safe pedestrian test or passenger-operated driving test; never require the driver to interact with the phone.

### Exit criteria

A dated device test report with device/OS/app version, scenario, PASS/FAIL/NOT TESTED, reproducible defects and evidence. Phase 6 may close only after P0 routing is resolved and essential Android navigation scenarios pass; iOS outstanding validation must be explicitly tracked.

## 5. Phase 7 — Almaty Data Intelligence 1.0 (P1)

### Data requirements

- Audit OSM coverage and quality for addresses, building footprints, entrances, barriers, parking, access roads and POIs across prioritized Almaty areas.
- Establish canonical feature IDs, source attribution, provenance, timestamps, licensing, update history, confidence and deduplication/conflation rules before merging data.
- Evaluate Overture Maps only as a candidate supplemental source after checking license compatibility, quality, geometry alignment, update frequency and measured benefit. No unconditional bulk merging.
- Support controlled community/partner corrections for POIs, entrances, gates and access restrictions, with moderation, audit trail, abuse controls, verification and rollback.
- Ensure route access respects legal road restrictions and private/access-controlled areas; do not infer navigable entrances from unverified geometry.
- Build repeatable import/validation jobs, data quality dashboards and a pilot dataset for Almaty. Preserve OSM attribution and ODbL obligations; review other source terms independently.

### Exit criteria

Documented baseline and after metrics for sampled Almaty areas (coverage, freshness, precision, duplicate rate and verified entrance/POI correctness), reproducible import pipeline, provenance and rollback. Release data only after legal/quality review.

## 6. Phase 8 — Advanced Maps (P2/P3)

- Improve visual clarity, labels, building heights/3D only from credible height data, POI relevance and navigation usability.
- Design offline map/search/routing capability with explicit coverage, download size, licensing, storage and refresh strategy; ship incrementally with offline acceptance tests.
- Explore traffic only after a lawful, trustworthy, privacy-respecting data source and measurable freshness/coverage exist. **Never synthesize live traffic from guesses.**
- Benchmark performance, map startup, route latency, battery, crash rate, accessibility and data quality on representative devices.

## 7. Architecture and delivery constraints

- Keep the existing repository and architecture; do not restart Maps Foundation or replace Valhalla/MapLibre/Search without an approved, evidence-backed ADR.
- No paid third-party map APIs or infrastructure purchases without explicit approval.
- Keep OSM attribution and relevant license compliance; Apache-2.0 code licensing does not relicense geographic datasets.
- Use small reviewable PRs, green CI, release signing secrets kept out of source/logs and reproducible build artifacts.
- Never equate automated/simulated tests with real-device validation; document limitations and unresolved issues.

## 8. Execution order and status

| Order | Phase | Current status | Required gate |
| --- | --- | --- | --- |
| 1 | 6.1 — Routing fix and Flutter redesign | **OPEN — P0 routing symptom confirmed** | Real DEV API route in Flutter + updated signed APK + owner retest |
| 2 | 6.2 — Physical navigation validation | **OPEN — NOT TESTED** | Evidence-backed device navigation report |
| 3 | 7 — Almaty Data Intelligence 1.0 | **PLANNED** | Audited datasets, measured quality improvements, licensing |
| 4 | 8 — Advanced Maps | **PLANNED** | Tested advanced/offline capabilities; traffic only with real data |

## 9. Immediate next action

Investigate the Android routing failure before UI polish; fix and prove it against the real DEV API, then implement the premium Flutter UI, ship a signed upgrade and request the owner's physical-device route/navigation retest. Update this specification and project state as evidence changes.
