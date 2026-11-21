# Testing matrix

| Check | CI | What it proves |
|---|---|---|
| Repository files | foundation.yml | Documentation baseline exists |
| Map static | map-static.yml | JSON, source wiring and shell syntax |
| HTTP smoke | map-http.yml | Docker Compose starts; HTML/style/config served |
| PMTiles range | Manual until real tiles generated | HTTP 206 byte-range access |
| Visual map | Manual browser until automated E2E | Correct Almaty roads, buildings, attribution |
| Kazakhstan data import | Manual until reproducible runner available | OSM ingestion and PMTiles generation |

No HTTP-only test establishes that the map is rendered or that road geometry is accurate. The generated PMTiles artifact must be tested separately. Record image digests, source download checksum and import runtime in a follow-up PR.
