# ADR 0002 - Places & POI

Status: accepted (2026-11-22)

Context: the map needs categorized places with real contact data, viewport and nearby queries, clustering and saved places, on the existing
free-tier stack (static web + Python/SQLite Search API) and without proprietary POI data.

Decisions
- **Data**: extend the OSM-derived SQLite index to schema v3 (`category`, `subtype`, contacts, `quality`, R-tree). One primary category per
  object from OSM tags (`services/search/categories.py`). Invalid contact data is dropped at build time, never repaired or invented.
- **API**: `/v1/places` (viewport, nearby), `/v1/places/{osm code}`, `/v1/categories` inside the same service, same rate limiter, metrics and
  CORS policy. Stable ids are OSM codes (`n123`), not rowids, so shared links survive index rebuilds.
- **Rollout safety**: the server serves schema v1/v2/v3; places answer `places_unavailable` on old indexes, so code and index switch separately.
- **Clustering**: client side with MapLibre's GeoJSON clustering over <= 150 results per viewport (cheap, no tile pipeline change).
  Revisit with vector-tile POI layers carrying categories if result counts grow.
- **Ranking**: completeness + closeness (viewport), distance with 40 m per completeness point (nearby). No popularity or rating is used or invented.
- **Privacy**: nearby position rounded to ~100 m, never logged or stored by the API; favorites live in the browser only.
- **Directions**: external OpenStreetMap link until Phase 4 provides our own routing; no fake routes.
- **Licensing**: the published index is an ODbL Derivative Database; attribution in the map and every API response, provenance and license in `PROVENANCE.txt`.

Consequences: index size grew 190 MB -> 305 MB (R-tree + attributes), still within the free-tier download budget (~10 s at cold start).
Free-tier RAM is unaffected (SQLite pages on demand). Alternatives rejected: Overpass at runtime (public instance rate limits, no SLA), a separate
POI service (premature, adds a second deploy), vector tiles with all POI attributes (tile size, no server-side filtering).
