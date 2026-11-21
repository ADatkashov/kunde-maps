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
