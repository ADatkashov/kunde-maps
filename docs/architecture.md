# Architecture — draft ADR baseline

## Boundaries
- apps/mobile: Flutter + MapLibre (planned)
- apps/web: MapLibre GL JS (planned)
- services/maps-api: Java 21 / Spring Boot gateway and domain API (planned)
- tile pipeline: OpenStreetMap PBF -> validated vector tiles -> CDN/self-hosted tile service
- spatial registry: PostgreSQL/PostGIS with stable geo IDs, provenance, audit and moderation
- search: Pelias/OpenSearch evaluated by benchmark, not assumed as default
- routing: Valhalla evaluated for car/foot/cycle with reproducible graphs
- traffic: optional future consented GPS aggregation; never expose raw individual traces

## Data contracts
WGS84 EPSG:4326 storage; standard tile projection EPSG:3857. GeoJSON uses [longitude, latitude]. Stable identifiers, multilingual names, aliases, entrances and access restrictions. Explicit source, license, freshness and confidence for every feature.

## Operating model
Independent KUNDE Maps API, later consumed by KUNDE and external clients. API versioning, rate limits, cache, health checks, tracing, secret management, backups and disaster recovery. Separate immutable imported OSM data from independently sourced records; obtain legal review of ODbL derived-database obligations.

## Decision gates
Benchmark memory, storage and import times on actual Kazakhstan extracts before selecting hosting. Validate road restrictions and address search against curated ground-truth samples. Do not promise live traffic without sufficient GPS observations.
