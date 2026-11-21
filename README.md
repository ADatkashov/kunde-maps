# KUNDE Maps

Kazakhstan-first independent mapping platform. Initial milestone: Maps Foundation 1.0.

## Scope
- Nationwide OSM-derived basemap; Almaty-first data quality.
- Address and POI search (RU/KK/transliteration), navigation, entrances, traffic and business APIs in later phases.
- Standalone platform; existing KUNDE repository is not modified.

## First milestone
Run a reproducible local map proof-of-concept with self-hosted tiles, verify OSM attribution, then implement versioned APIs and clients. Do not use public OSM tile servers for production traffic.

See [roadmap](docs/roadmap.md), [architecture](docs/architecture.md), and [agent instructions](AGENTS.md).

Code: Apache-2.0. OSM-derived geographic data: ODbL, separately governed. This repository's code license does not relicense geographic data.
