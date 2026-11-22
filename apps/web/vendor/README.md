# Vendored front-end libraries

Served from our own origin so the map neither depends on a public CDN being up nor runs third-party script in our page (strict CSP, `script-src 'self'`).

| File | Package | Version | License | Source |
| --- | --- | --- | --- | --- |
| `maplibre-gl.js`, `maplibre-gl.css` | maplibre-gl | 5.9.0 | BSD-3-Clause (`LICENSE-maplibre-gl.txt`) | https://unpkg.com/maplibre-gl@5.9.0/dist/ |
| `pmtiles.js` | pmtiles | 4.3.0 | BSD-3-Clause (`LICENSE-pmtiles.txt`) | https://unpkg.com/pmtiles@4.3.0/dist/pmtiles.js |

Files are byte-identical to the published npm packages; `CHECKSUMS.sha256` is verified in CI (`scripts/ci/check-vendor.py`).
To upgrade: download the new version, replace the files and licenses, run `sha256sum maplibre-gl.js maplibre-gl.css pmtiles.js LICENSE-*.txt > CHECKSUMS.sha256`,
update the versions above and run the browser tests against a real map.
