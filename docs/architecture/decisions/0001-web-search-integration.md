# ADR 0001 — Search integration in the static web app

Status: accepted (2026-11-22)

Context: the web map is a static nginx image (MapLibre + PMTiles on R2); the Search API is a separate Python service.
Decision:
- Keep the web app dependency-free vanilla JS (no build step). Pure logic lives in `core.js` (UMD) and is unit-tested in Node.
- Browser calls the Search API directly (`GET /v1/search`), origin configured at runtime with `MAPS_SEARCH_URL` -> `searchUrl`
  in `config.json` (HTTPS origin only; validated in `40-configure-tiles.sh` and in `core.parseConfigUrl`).
- CORS is an allowlist for the web origin and exposes `Retry-After`. CORS is **not** authentication.
- Client is GET-only: debounce 300 ms, AbortController + sequence guard against races, 20 s timeout, one retry on
  network/5xx/timeout, no retry on 4xx, 429 honours `Retry-After`, 5-minute LRU response cache.
Consequences: no secret can live in the browser, so abuse protection must be server-side (rate limiting, then signed/short-lived
tokens for the public client and API keys for B2B) — tracked as the next Search API task. Alternatives considered: a same-origin
reverse proxy in nginx (hides the API origin, adds a hop on Render Free) — revisit when rate limiting lands.
