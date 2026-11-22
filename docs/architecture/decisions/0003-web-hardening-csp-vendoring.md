# ADR 0003 - Web hardening: vendored libraries and strict CSP

Status: accepted (2026-11-22)

Context: the page loaded MapLibre and PMTiles from unpkg without integrity checks and had an inline script, so a CDN outage or compromise
would break or take over the map, and no Content-Security-Policy could be enforced.

Decisions
- Vendor `maplibre-gl@5.9.0` and `pmtiles@4.3.0` under `apps/web/vendor/` (byte-identical to npm, licenses included, checksums in
  `CHECKSUMS.sha256`, verified by `scripts/ci/check-vendor.py`). Upgrading is an explicit, reviewed change.
- Move the theme bootstrap to `theme-init.js`; no inline scripts or `style=` attributes in `index.html` (enforced in CI).
- nginx serves a generated policy (`40-configure-tiles.sh` -> `/etc/nginx/security-headers.inc`, included by every location):
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'` plus exactly
  the configured tile origin, Search API origin and `https://fonts.openmaptiles.org` (glyphs); `worker-src blob:` (MapLibre workers);
  `base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`. Also `X-Content-Type-Options`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: geolocation=(self), camera=(), ...`, HSTS.
- No `unsafe-inline` / `unsafe-eval`: verified with the real map (real tiles, live API, clusters, theme/language switching, nearby, save)
  with zero violations.

Consequences: the only third-party host contacted at runtime is the public glyph server (documented; self-hosting glyph PBFs is a follow-up
together with an icon sprite). `check-deployment.py` now fails when the page is served without a strict CSP.
