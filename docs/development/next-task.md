# Next task

1. Phase 4 - Routing (needs a decision on paid infrastructure): a Kazakhstan routing graph does not fit the 512 MB free Render instance.
   Evaluate Valhalla / OSRM / GraphHopper by building the graph in GitHub Actions (free runners) and measuring tile/graph size, RAM and
   route quality; then decide on the smallest paid instance or another host. Replace the external OSM directions link when `/v1/route` works.
2. (done) glyphs self-hosted; no sprite is needed (POIs are coloured dots).
3. Search: house-number geocoding and admin context in results; API keys / short-lived tokens for the public client.
4. Places polish: category-aware text search ("кафе рядом"), wheelchair/cuisine filters from real tags.
