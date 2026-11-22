# Next task

1. Search API protection (Phase 2): per-IP token-bucket rate limiting with `429` + `Retry-After`, request/IP metrics without
   query text or coordinates in logs, optional API-key header for B2B. Cover with tests.
2. Index quality: add `name:en`, `alt_name`, `official_name`, `old_name` and transliteration to the index build; relevance
   fixtures (Almaty/Almati/Алмата/Astana/Shymkent/Қазақстан) with measurable top-N expectations.
3. Cartographic style v2: road classes, casing, POI layer, dark style file.
4. Security headers/CSP for the web nginx; vendor or SRI-pin MapLibre/PMTiles.
