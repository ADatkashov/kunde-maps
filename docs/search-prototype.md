# KUNDE Maps Search — first backend slice (MAP-006)

The new `services/search` prototype provides a **read-only local search index** using
SQLite FTS5. It is not yet deployed or connected to the public web client.
It is not a full Kazakhstan geocoder. The current browser search continues to
search locally loaded PMTiles.

## Run locally

Requires Python 3.12+ with SQLite FTS5 support.

```sh
python -m unittest discover -s services/search -p 'test_*.py' -v
python services/search/build_index.py /path/to/points.geojsonl /tmp/kunde-search.sqlite3
MAPS_SEARCH_DB=/tmp/kunde-search.sqlite3 PORT=8081 python services/search/server.py
curl 'http://localhost:8081/v1/search?q=%D0%90%D0%B1%D0%B0%D1%8F'
```

Input is **GeoJSON Lines of Point features** (or one FeatureCollection), with
OSM-style `name`, `name:ru`, `name:kk`, `addr:street`, `addr:housenumber`,
`amenity`, `shop`, and `place` properties. Geometry is `[longitude, latitude]`.
Features without a name or street address are ignored. Do not commit OSM
extracts or generated databases to Git. Keep ODbL attribution, provenance,
and update timestamps with the imported dataset.

Endpoints: `GET /health` and `GET /v1/search?q=...`.
Results are limited to ten. Empty or invalid queries return HTTP 400;
a missing index returns HTTP 503. Browser CORS is restricted to the Render
DEV frontend.

## Before deployment

1. Run and benchmark the new **OSM PBF → GeoJSONL → SQLite FTS5** pipeline
   via the manual GitHub workflow `.github/workflows/build-search-index.yml`.
   `extract_osm.py` processes nodes and ways, using approximate way coordinates;
   relations, entrances, address completeness and exact building geometry
   still need dedicated validation. Generated artifacts expire after 3 days.
2. Build and version a real Almaty/Kazakhstan index and store it persistently.
3. Test multilingual search, transliteration, ranking, address precision,
   rate limits, and response time on realistic datasets.
4. Deploy the search service separately; configure a public API URL and
   integrate it with the web client behind a feature flag.
5. Document privacy, logging, ODbL attribution and operational monitoring.

Do not describe this prototype as a production geocoder or expose it without
rate limiting and deployment safeguards.

## Kazakhstan index workflow

Open GitHub Actions → **Build Kazakhstan search index** → Run workflow.
The job downloads the Geofabrik Kazakhstan PBF and its published MD5, checks
integrity, extracts named OSM nodes/ways, builds an FTS5 database and uploads
`kazakhstan-search-index` with provenance and SHA-256. It does not deploy or
publish the database. Large PBF processing may require a larger runner or
split-by-city processing; successful completion is not yet confirmed.

The code is a proof of concept. Do not connect it to public traffic until
index quality, licensing, security and rate limiting have been reviewed.

## Isolated API container (not deployed)

`infrastructure/search/Dockerfile` builds a separate Python 3.12 image.
Mount a verified SQLite index read-only at `/data/kazakhstan-search.sqlite3`;
the container deliberately does **not** download untrusted data at startup.

```sh
docker build -f infrastructure/search/Dockerfile -t kunde-maps-search .
docker run --rm -p 10000:10000 \\
  -v /absolute/path/kazakhstan-search.sqlite3:/data/kazakhstan-search.sqlite3:ro \\
  kunde-maps-search
curl 'http://localhost:10000/health'
```

Missing index means HTTP 503 on both readiness and search; do not expose
this container to public traffic until an immutable index storage location,
rate limiting, access controls, monitoring, and backups are configured.
The existing Render web service is intentionally unchanged.

## Verified index publication

A successful Kazakhstan build is available as GitHub Actions artifact until
2026-11-24 (run 44930606981, artifact kazakhstan-search-index, approximately
155 MB). The separate manual workflow
`.github/workflows/publish-search-index.yml` accepts the source run ID,
verifies the artifact's SHA-256 and SQLite integrity, and uploads it to
`s3://kunde-maps-tiles/search/kazakhstan-search-<run_id>.sqlite3`.
The publication workflow expects repository secrets `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`; verify the configured
secret names before running. The index object may be publicly readable
depending on the bucket's public access policy; do not store credentials or
personal information in it. The existing map tiles are not overwritten.

This workflow is **not** automatically dispatched or proof of upload.
After upload, verify object size, checksum, and download access before
configuring any API service. OSM/ODbL attribution and provenance remain required.

## Index provisioning (Render) and recovery

`services/search/provision_index.py` runs before the server starts. It tries the primary URL, then an optional fallback
(GitHub Release asset), and accepts a file only if: SHA256 matches, `PRAGMA quick_check` is `ok`, `places` has at least
`MAPS_SEARCH_MIN_ROWS` rows (default 1000) and the FTS table is queryable. The file is replaced atomically; a verified
local copy is reused (Render Free storage is ephemeral, so a restart on a new instance downloads again). Downloads use
timeouts and 3 attempts with exponential backoff for network/5xx/429; 403/404 are not retried and trigger the next source.

| Variable | Purpose |
| --- | --- |
| `MAPS_SEARCH_INDEX_URL` | primary HTTPS URL of `kazakhstan-search-<run>.sqlite3` |
| `MAPS_SEARCH_INDEX_FALLBACK_URL` | optional GitHub Release URL of the same file |
| `MAPS_SEARCH_INDEX_SHA256` | pinned digest (preferred); otherwise the same-host `.sha256` sidecar is used |
| `MAPS_SEARCH_DB` | destination path (default `/data/kazakhstan-search.sqlite3`) |

### Incident 2026-11-21: HTTP 403 from R2
Cause: Cloudflare (`r2.dev`) blocks the default `Python-urllib/x.y` User-Agent (HTTP 403, body `error code: 1010`). The same
object returns 200 to curl or any other User-Agent, and a missing object returns 404. It was not an R2 permission, path or
Render-network problem. Fix: the provisioner sends `kunde-maps-search-provisioner/1.0`. A unit test reproduces the block.

### Manual recovery
1. Actions -> "Build Kazakhstan search index" (manual) produces the artifact (retained 3 days).
2. Actions -> "Publish Kazakhstan search index to R2" with the successful build run ID. It verifies, uploads to R2,
   verifies anonymous download with the real provisioner, and mirrors to a GitHub Release `search-index-<run>`.
3. Update the Render env vars (`MAPS_SEARCH_INDEX_URL`, `..._FALLBACK_URL`, `..._SHA256`) to the new run and deploy.

The index is OSM-derived (ODbL); attribution: (c) OpenStreetMap contributors. Provenance is published beside each index.

## Abuse protection and metrics (Phase 2)
Implemented in `services/search/protection.py`, wired in `server.py`. CORS is **not** treated as protection.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAPS_RATE_LIMIT_PER_MINUTE` | 60 | sustained requests per client per minute (token bucket refill) |
| `MAPS_RATE_LIMIT_BURST` | 20 | bucket size (short bursts, e.g. fast typing) |
| `MAPS_MAX_CONCURRENT_SEARCHES` | 16 | simultaneous searches; above it -> `503 busy` + `Retry-After: 1` |
| `MAPS_TRUSTED_PROXY_HOPS` | 1 | the Nth entry from the right of `X-Forwarded-For` is the client IP; client-supplied left entries are ignored. **On Render it must be `3`** (measured, see below) |
| `MAPS_METRICS_TOKEN` | unset | enables `GET /metrics` (Bearer token); without it `/metrics` is `404` |

- Over the limit: `429 {"error":"rate_limited","retry_after":N}` with `Retry-After`, exposed to browsers via CORS. Invalid requests also
  consume tokens; `/health` is never limited.
- Buckets are in memory only, keyed by a salted SHA-256 prefix (no raw IPs), LRU-bounded to 20,000 keys. Multiple instances would
  each keep their own bucket (acceptable on a single Render instance; a shared store is needed before scaling out).
- Metrics (Prometheus text): request counts by route and status class, latency histogram, `rate_limited`, `busy`, `empty_results`,
  active bucket count. **No query text, coordinates or IP addresses** in metrics or logs; the access log is one JSON line
  `{"route","status","ms"}` per non-health request.
- Responses carry `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, a restrictive `Content-Security-Policy`, `Cache-Control: no-store`.
  Sockets time out after 15 s (slowloris).
- Not done yet: API keys/quotas for B2B clients and short-lived tokens for the public web client (needs a token-issuing backend).

### Measured: client IP behind Render (2026-11-22)
`GET /debug/client` (bearer token) showed `X-Forwarded-For = [client-supplied..., real client, Cloudflare edge, Render 10.x balancer]`.
With the default `1` the limiter key was the internal balancer address (varies per request, shared by everyone), i.e. effectively
a global limit. Render DEV now runs with `MAPS_TRUSTED_PROXY_HOPS=3`; a spoofed leading entry is ignored. Re-measure with
`/debug/client` whenever the hosting topology changes.

## Index schema v2 and cross-script search (Phase 2)
`build_index.py` writes schema v2 (`meta.schema_version=2`): `places(name,name_ru,name_kk,name_en,alt,kind,lat,lon,importance)` and an
FTS5 table with a `skel` column. `textnorm.skeleton()` maps Cyrillic (RU + KK letters) and Latin spellings to one loose form, so
`Алматы / Almaty / Almati`, `Қазақстан / Qazaqstan / Kazakhstan / Казахстан`, `Шымкент / Shymkent` compare equal; ш/с, ч/ш, ц/з stay
distinct. Real OSM names are stored and returned unchanged. New tags extracted: `name:en`, `alt_name`, `official_name`, `old_name`,
`int_name`, `population`, `capital`. The server still serves schema-v1 indexes (no `meta` table) with the old logic, so index and
code can be switched independently.

Ranking (v2): exact skeleton match > edit-distance-1 (last-letter typos such as `Алмата`) > prefix > rest; then `importance`
(derived only from OSM place class, population and capital tag; no invented popularity); +80 when the user's language spelling
matches; optional proximity bonus (<= 250 points, 150 km falloff) when `lat`/`lon` (map viewport centre) are sent. Optional query
parameters: `lang=ru|kk|en`, `lat`, `lon` (invalid -> 400).

Measured with `scripts/search-relevance.py` (36 real cities/country in RU/KK/EN/translit, same 1,450,805-row data converted to v2):
top-1 **0.417 (v1) -> 1.000 (v2)**, MRR 0.417 -> 1.000, local latency p50 4 ms / p95 10 ms. `build-search-index.yml` now fails
(blocks publishing) when top-1 < 0.9 on the freshly built index. Limits: typo tolerance covers a missing/extra last letter only;
no street-level geocoding by house number, no admin hierarchy in results ("Almaty, Kazakhstan" style context) yet.

### Live verification of index v2 (2026-11-22)
Index built by Actions run 44992519201 from `kazakhstan-261120.osm.pbf` (1,451,793 places; the 'latest' link was broken that day, see
`scripts/ci/fetch-osm-extract.sh`), published to R2 + GitHub Release, switched on Render DEV. Live `scripts/search-relevance.py`: top-1
1.000 / MRR 1.000 on 36 cases. Server-side metrics during the run: 105 searches, 0 5xx, 0 busy, mean handler time ~50 ms. One transient
`503` was observed by a browser in the same window with **zero** 5xx counted by the app, i.e. it originated at the hosting proxy; the
web client retries once, so users did not notice. Free-tier cold start (up to ~1 min) and rare proxy 503s remain known limits.

## API keys and quotas (server-to-server clients)

The public web client is anonymous (per-IP token bucket, `MAPS_RATE_LIMIT_PER_MINUTE`/`BURST`). Partners and our own backends get API keys:

- `python3 services/search/apikeys.py generate NAME PER_MINUTE` prints the secret **once** and the configuration entry; only the SHA-256 goes into
  `MAPS_API_KEYS` (`name:sha256hex:per_minute,...`, Render env var; invalid entries stop the server at startup).
- Clients send `X-API-Key: <secret>` (never in URLs). A valid key has its own bucket (quota shared by all of its IPs, burst = max(30, rate/4));
  an unknown key gets `401 invalid_api_key` and is never downgraded to anonymous; `429` + `Retry-After` when the quota is used up.
- Metrics: `kunde_search_key_requests_total{key="name"}` and `kunde_search_invalid_keys_total`; secrets, IPs and queries are never logged.
- CORS does not allow the `X-API-Key` header: keys must not be embedded in browser code. Browser clients would need short-lived tokens
  (follow-up: token issuance requires a server-side component that can authenticate users, planned with the KUNDE integration).

## House-number addresses (v3 index)

About 1.37 M OSM address points (`addr:street` + `addr:housenumber`) are indexed. Findings on the real index and what changed:

- **Street-type words are optional.** `улица / проспект / шоссе / көшесі / даңғылы / street / avenue ...` are stripped from the query for retrieval and
  matching (`services/search/addresses.py`), so `Абая 150` finds `улица Абая 150` and `проспект Абая 150` finds `Абая 150` (a spelling-exact
  match still ranks a hair above a match that needed the stripping).
- **Proximity picks between equal addresses.** House-number queries look at up to 1500 candidates (instead of 150) so that the map-centre hint
  (`lat`/`lon`) can choose the nearby one; measured on the real index: 2-35 ms. Before: `Абая 150` from the Almaty centre returned a Turkestan-region
  address first because the Almaty row (`улица Абая 150`) did not count as a match.
- **`locality` for address rows.** Most OSM addresses carry no `addr:city`. The API adds the *nearest city/town/village name stored in the index*
  (limits 30 / 20 / 8 km, a city's catchment counts double) as context, in the requested language. It is a nearest-settlement hint derived from
  OSM data, not an administrative boundary, and is omitted when nothing is within the limits. First request after a start builds the settlement
  grid (~0.15 s), later requests ~0.
- Not solved: queries that include a city ("Абая 150 Алматы") because address rows have no city token; real admin boundaries would need the OSM
  boundary relations in the index build.
