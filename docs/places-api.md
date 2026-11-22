# Places API (index schema v3)

Real places from OpenStreetMap tags. Every attribute may be `null`: nothing is guessed, defaulted or scraped from other sources.
All endpoints are `GET`, JSON, rate-limited with the Search API limiter (`429` + `Retry-After`), CORS-allowlisted, never log parameters.
Responses carry `"attribution": "© OpenStreetMap contributors (ODbL)"`.

| Endpoint | Purpose |
| --- | --- |
| `/v1/places?bbox=minLon,minLat,maxLon,maxLat[&category=a,b][&limit=N][&lat=&lon=]` | places in the map viewport (R-tree). `lat`/`lon` optionally give the ranking centre. |
| `/v1/places?lat=&lon=[&radius=m][&category=][&limit=]` | nearby places, sorted by distance, each has `distance_m` |
| `/v1/places/{id}` | details; `id` is a stable OSM code (`n123` node, `w456` way, `r789` relation) |
| `/v1/categories` | category ids with counts and the OSM tags that define each |

Limits: viewport at most 1.5 degrees wide/high (else `400 area_too_large`), `limit` 1-300 (default 100), `radius` 50-5000 m
(default 1000), at most 1500 candidate rows are ranked (`truncated: true` when that cap was hit). Errors are stable codes
(`unknown_category`, `bbox_min_must_be_less_than_max`, `place_not_found`, `places_unavailable` for an old v1/v2 index ...).

Place object: `id, name, name_ru, name_kk, name_en, category, subtype (the OSM value), lat, lon, address, phone, website, hours
(raw OSM opening_hours), brand, distance_m (nearby only)`. Coordinates of areas are an approximate representative point.

## Categories
`restaurant, cafe, pharmacy, hospital, shop, school, fuel, parking, bank, hotel, beauty, sport, culture, park, auto, transport, services`
(`services/search/categories.py`). One primary category per object, the first matching rule wins (specific before generic: a
bakery is `cafe`, not `shop`). Objects without a name are kept only for `parking, fuel, bank, transport` (many real ATMs and lots
are unnamed).

## Ranking
- Viewport: completeness score (0-7: name 2, address, phone, website, hours, brand 1 each) + closeness to the centre (up to +2).
- Nearby: `distance - 40 m x completeness (+150 m when unnamed)`, so a complete record may beat a bare one that is up to ~280 m closer,
  but never a much closer one. No popularity or rating signals are used or invented.

## Data hygiene
- `website` must be an absolute `http(s)` URL with a host, no credentials (blocks `javascript:`/`data:` links); otherwise dropped.
- `phone` must look like a phone number (digits, `+`, spaces, brackets, dashes), at most 3 numbers; otherwise dropped.
- `hours` is cleaned of control characters and capped at 250 characters; the web app interprets only simple patterns and shows
  everything else verbatim (see `apps/web/core.js`).
- `address` is composed only from `addr:street`, `addr:housenumber`, `addr:city` that exist.

## Licensing (ODbL)
The index is a Derivative Database of OpenStreetMap data (ODbL 1.0). Obligations met: attribution "© OpenStreetMap contributors" in the
UI map attribution and in every API response; the index is published (R2 + GitHub Release) together with a provenance file naming the
source extract; the share-alike obligation applies to the published index (same ODbL terms, `PROVENANCE.txt` states them). Code
stays Apache-2.0. Do not mix this data with proprietary POI datasets without a separate legal review.

## Real-data measurements (index built 2026-11-22 from `kazakhstan-261120.osm.pbf`)
- 77,482 categorized places: shop 20,935, parking 11,634, services 5,898, bank 4,800, school 4,426, cafe 4,354, restaurant 4,340,
  fuel 4,294, auto 3,232, hospital 3,105, culture 2,011, transport 1,963, beauty 1,780, hotel 1,757, pharmacy 1,411, sport 950, park 592.
- Real OSM contact coverage among them: address 24%, phone 16%, website 14%, opening hours 21%. The UI therefore treats every field as
  optional and shows only what exists.
- Opening hours: the web interpreter understands 97.1% of 758 distinct real strings sampled from Almaty, Astana, Shymkent, Karaganda,
  Atyrau and Kyzylorda (`apps/web/core.js`, tolerated variants: `PH` listed with identical hours, spaces around dashes, a comma between
  rules). The rest (free text such as "Daily 9am-6pm", `PH off`) is shown verbatim as "unknown".
- Live latency: viewport query with 5 results 0.2 s end to end from the sandbox.

## Web client (Phase 3 UI)
- Category chips (17 + "Nearby") above the results; several categories can be combined. Data is loaded for the visible map area
  (debounced 350 ms, previous request aborted, only from zoom 11 and for areas up to 1.45 degrees), or around the user.
- "Nearby": the browser asks for permission; the position is rounded to ~100 m before it is sent to `/v1/places`, is not stored, not logged
  and used for that one request (the UI says so).
- Map: one clustered GeoJSON source (`places`) plus cluster, count, point and selected-ring layers. They are injected into every style that is
  handed to `setStyle`, so theme/language switches keep them; tile POI dots are hidden while places are shown.
- Place card: category chip, open/closed badge (Almaty time) and weekly table from `opening_hours`, address, phone (`tel:`), website
  (http(s) only, `rel="noopener noreferrer"`), brand, coordinates; actions Directions, Save, Share, Copy coordinates.
- Directions: opens `openstreetmap.org/directions?to=lat,lon` in a new tab. This is a plain link (no data from us beyond the destination)
  and an interim solution until KUNDE routing exists (Phase 4); no straight line is presented as a route.
- Saved places: `localStorage` (`kunde-favorites`, max 200, validated on load), device-local, no account. Share links carry the stable OSM id
  (`#poi=n123`) and fall back to the coordinate card when the place is not found.
