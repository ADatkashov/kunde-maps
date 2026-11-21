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

1. Implement and benchmark a **reproducible OSM PBF → searchable point data**
   ingestion pipeline, including streets, POIs and house numbers. This first
   importer accepts point geometries only; ways/polygons need a correct
   representative point and provenance.
2. Build and version a real Almaty/Kazakhstan index and store it persistently.
3. Test multilingual search, transliteration, ranking, address precision,
   rate limits, and response time on realistic datasets.
4. Deploy the search service separately; configure a public API URL and
   integrate it with the web client behind a feature flag.
5. Document privacy, logging, ODbL attribution and operational monitoring.

Do not describe this prototype as a production geocoder or expose it without
rate limiting and deployment safeguards.
