# Web map preview

Serve this folder over HTTP (e.g. `python3 -m http.server 8000 -d apps/web`). Copy `config.example.json` to `config.json` and set `styleUrl` to an authorized MapLibre-compatible vector style endpoint. The example URL is a placeholder, not a deployed service.

The preview centers on Almaty and intentionally fails visibly if tiles are not configured. No public OSM tile service is used by default. This is **not yet a working self-hosted map**; the tile pipeline is the next implementation milestone.

Production must bundle or pin reviewed frontend dependencies, add CSP, mobile accessibility and verify tile attribution, data licensing and rate limits.
