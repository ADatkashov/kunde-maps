# KUNDE Maps — roadmap to an independent 2GIS alternative

## Product goal
Build a standalone Kazakhstan-first map platform with a web client, reusable APIs,
and later mobile SDKs. 2GIS is a product benchmark, not a data source or dependency.
Do not scrape or copy proprietary 2GIS data, imagery, reviews or branding.

## Delivery rules
- Preserve the currently working MapLibre + PMTiles web map. Roll out new services
  independently and integrate only after green CI, API smoke tests and rollback readiness.
- Keep feature flags server-controlled and default new capabilities off.
- Publish provenance, OSM/ODbL attribution, dataset dates, privacy policy and service limits.
- Do not claim live traffic, complete house coverage or turn-by-turn navigation before validation.

## Milestones and acceptance criteria

### M1 — Reliable Kazakhstan search
- Persist a versioned national search index in R2, verify checksum and provenance.
- Deploy isolated Python Search API with health/readiness, rate limits, bounded queries,
  metrics, logs without raw user search terms, and rollback.
- Verify RU/KK queries, street + house number, transliteration, location bias, duplicate
  handling and address precision on an Almaty ground-truth sample.
- Feature-flagged frontend integration, with the existing tile-local search fallback.

### M2 — Organizations directory
- OSM POIs plus partner-submitted organizations with verified ownership and moderation.
- Categories, hours, contacts, entrances, photos with licensing, report-a-problem flow.
- Freshness indicators, deduplication, business claim audit, abuse prevention.

### M3 — Routing
- Evaluate Valhalla vs OSRM on a reproducible Kazakhstan OSM dataset.
- Walking, driving, then cycling/public transport where reliable data exists.
- Route alternatives, ETA, maneuvers, route geometry, rerouting and test cases.
- Do not advertise live traffic until independent traffic data agreements exist.

### M4 — Navigation and mobile
- Map matching, voice instructions RU/KK, GPS drift handling, offline regions,
  battery/performance benchmarks and Flutter integration.
- Accessibility, device testing, telemetry opt-in, background location controls.

### M5 — Platform
- Public versioned Search/Places/Routing APIs with keys, quotas, observability and SLAs.
- Data import/update jobs, moderation console, backups and disaster recovery.
- Business model and sustainable cost benchmarks for R2, hosting and routing compute.

## Suggested technical evolution
Keep MapLibre GL JS, PMTiles and R2 for map rendering. Add PostgreSQL/PostGIS
when spatial queries and organization editing require it; consider Redis only
after measuring cache needs. Choose a routing engine based on benchmarks.
Do not replace the working frontend or deploy a new stack solely for architecture.

## Current status
Vector map live; national SQLite FTS5 search index generated as a GitHub Actions
artifact. R2 publication and separate Search API deployment are not yet verified.
No routes, verified organization catalog, live traffic or mobile navigation yet.
