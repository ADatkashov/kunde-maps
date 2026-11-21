# Local Kazakhstan vector map — runbook

## Prerequisites
Docker Engine + Compose, curl, bash, sha256sum; substantial free disk and RAM for tile generation (measure on target machine). No cloud resources are created.

## Generate tiles
Run `bash scripts/build-kazakhstan-tiles.sh`. This downloads Geofabrik's Kazakhstan OSM PBF and builds `data/tiles/kazakhstan.pmtiles` with Planetiler. Review Planetiler output for layer-schema compatibility with `apps/web/style.json` before declaring success. The build image tag should be pinned by digest after initial validation.

## Start local map
Copy `apps/web/config.example.json` to `apps/web/config.json`, changing `styleUrl` to `http://localhost:8080/style.json`. Then run `docker compose -f infrastructure/maps/docker-compose.yml up -d` and open http://localhost:8080.

The style's local PMTiles URL is rewritten to the current origin automatically. For a remote archive, set `tileUrl` in the deployed `config.json` without modifying the style or rebuilding the image, for example:

```json
{"styleUrl":"/style.json","tileUrl":"https://tiles.example.com/kazakhstan.pmtiles"}
```

The URL above is an example, **not a deployed endpoint**. The tile host must serve HTTPS, support byte-range requests (206 and `Content-Range`), and allow the web origin via CORS. For cross-origin JavaScript to inspect the header, include `Access-Control-Expose-Headers: Content-Range`. Ensure the host allows `Range` in CORS preflight where applicable. The app now probes both local and remote archives before rendering. Never use a private signed URL in a public `config.json` unless intentional.

## Verify
- `curl -I http://localhost:8080/style.json` returns 200.
- `curl -I http://localhost:8080/tiles/kazakhstan.pmtiles` returns 200.
- `curl -H 'Range: bytes=0-15' -i http://localhost:8080/tiles/kazakhstan.pmtiles` should return 206 and Content-Range; if not, correct server configuration before launch.
- Browser should show actual roads and buildings in Almaty, no MapLibre errors, and OSM attribution.

This workflow has not yet been executed in CI or on a host. Do not claim tiles exist or the map renders until verified. Never commit PBF/PMTiles files or use unlicensed map data.

## Optional GitHub Actions build

The workflow `.github/workflows/build-kazakhstan-tiles.yml` is **manual only**. GitHub's Actions UI normally requires the workflow file to exist on the default branch before it can be dispatched; merging the workflow is a separate decision from running it. This job downloads the full Kazakhstan OSM extract and invokes Planetiler. GitHub-hosted runner disk, memory, time and artifact-size limits may prevent completion; use a sufficiently sized dedicated runner or build host if so. Do not treat a successful workflow definition check as proof the archive exists.

The archive is uploaded as a short-lived (3-day) GitHub Actions artifact, not committed to Git. Artifacts are not a tile-serving endpoint. A separately provisioned object store or server with HTTPS, byte-range support and appropriate CORS must host the PMTiles file before the map works publicly. Validate archive header, size, checksum, tile layer names and actual browser rendering before release. Avoid exposing infrastructure credentials or raw OSM data through logs.
