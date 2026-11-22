# Roadmap — proposed, not delivered

## EP-MAP-001 Foundation (months 1–3)
- MAP-001 repository conventions, docs, CI, dependency/license checks
- MAP-002 reproducible Kazakhstan OSM ingestion with checksums and provenance
- MAP-003 vector tiles, MapLibre style and OSM attribution
- MAP-004 first web map showing Almaty; smoke and performance tests
- MAP-005 API gateway skeleton, health and versioned contracts

## EP-MAP-002 Search (months 4–6)
- MAP-006 geocoding and reverse geocoding benchmarks
- MAP-007 RU/KK aliases, historic street names and transliteration
- MAP-008 entrance/gate/pickup-point registry and moderation

## EP-MAP-003 Navigation (months 7–9)
- MAP-009 Valhalla routing and restrictions
- MAP-010 mobile GPS navigation and rerouting
- MAP-011 ETA evaluation and route regression corpus

## EP-MAP-004 Places (months 10–12)
- MAP-012 POI catalog, verified business claims, photos and moderation
- MAP-013 public Almaty beta, accessibility and privacy review

## EP-MAP-005 Expansion (months 13–18)
- MAP-014 city-by-city quality improvement and offline packages
- MAP-015 partner SDK and KUNDE integration behind feature flags

## EP-MAP-006 Traffic & API (months 19–24)
- MAP-016 privacy-preserving traffic pilot
- MAP-017 API keys, metering, billing and SLA

Acceptance criteria per task: runnable implementation, automated tests, license/provenance validation, documented limits and a reviewed PR.

## Status (2026-11-22)
- Delivered: self-hosted PMTiles map; Search API (FTS5, verified index provisioning); web design system v1 with real search
  (autocomplete, fly-to, marker, place card, share link, RU/KK/EN, light/dark). See `docs/development/project-state.md`.
- Next: Search API protection, index quality/transliteration, cartographic style v2 (`docs/development/next-task.md`).
- Phase mapping used in autonomous development: P1 web design + search, P2 search quality + protection, P3 places/POI,
  P4 routing (Valhalla evaluation), P5 navigation, P6 Flutter apps, P7 public/B2B API and KUNDE integration.
- Delivered 2026-11-22: Phase 3 Places & POI (see `docs/places-api.md`). Phase 4 routing delivered and live on DEV (`docs/routing-api.md`, `docs/routing-evaluation.md`). Next: Phase 5 navigation (`docs/development/next-task.md`).
