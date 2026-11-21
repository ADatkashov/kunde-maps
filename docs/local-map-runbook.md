# Local Kazakhstan vector map — runbook

## Prerequisites
Docker Engine + Compose, curl, bash, sha256sum; substantial free disk and RAM for tile generation (measure on target machine). No cloud resources are created.

## Generate tiles
Run `bash scripts/build-kazakhstan-tiles.sh`. This downloads Geofabrik's Kazakhstan OSM PBF and builds `data/tiles/kazakhstan.pmtiles` with Planetiler. Review Planetiler output for layer-schema compatibility with `apps/web/style.json` before declaring success. The build image tag should be pinned by digest after initial validation.

## Start local map
Copy `apps/web/config.example.json` to `apps/web/config.json`, changing `styleUrl` to `http://localhost:8080/style.json`. Then run `docker compose -f infrastructure/maps/docker-compose.yml up -d` and open http://localhost:8080.

The style's PMTiles URL is currently hardcoded to localhost:8080 for local proof of concept. For any remote host, replace with the licensed origin URL and configure CORS, TLS, CDN and appropriate cache/range request handling.

## Verify
- `curl -I http://localhost:8080/style.json` returns 200.
- `curl -I http://localhost:8080/tiles/kazakhstan.pmtiles` returns 200.
- `curl -H 'Range: bytes=0-15' -i http://localhost:8080/tiles/kazakhstan.pmtiles` should return 206 and Content-Range; if not, correct server configuration before launch.
- Browser should show actual roads and buildings in Almaty, no MapLibre errors, and OSM attribution.

This workflow has not yet been executed in CI or on a host. Do not claim tiles exist or the map renders until verified. Never commit PBF/PMTiles files or use unlicensed map data.
