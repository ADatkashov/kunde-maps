# Agent instructions — KUNDE Maps

1. Read README.md, docs/architecture.md and docs/roadmap.md before changing code.
2. Work in feature branches, make small PRs, never force push or bypass failing CI.
3. Do not modify ADatkashov/kunde without an explicit separate task.
4. No fake map data, invented addresses, coordinates, traffic or ETA. Keep data provenance and license metadata.
5. Do not use Google/Yandex/2GIS tiles, imagery, POIs or routing without explicit rights. Attribute OpenStreetMap contributors and follow ODbL obligations.
6. All externally reachable services require authentication as appropriate, quotas and observability. Never commit credentials.
7. Target RU, KK and transliterated address search. Almaty-first quality, Kazakhstan-wide coverage.
8. Start with an executable minimal vertical slice. Avoid premature microservices. Document tests and limitations in every PR.
9. Do not claim a feature works without executing its tests. Deployments and production changes require explicit authorization.
