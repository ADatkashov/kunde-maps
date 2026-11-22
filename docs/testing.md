# Testing matrix

| Check | CI | What it proves |
|---|---|---|
| Repository files | foundation.yml | Documentation baseline exists |
| Map static | map-static.yml | JSON, source wiring and shell syntax |
| HTTP smoke | map-http.yml | Docker Compose starts; HTML/style/config served |
| PMTiles range | Manual until real tiles generated | HTTP 206 byte-range access |
| Visual map | Manual browser until automated E2E | Correct Almaty roads, buildings, attribution |
| Kazakhstan data import | Manual until reproducible runner available | OSM ingestion and PMTiles generation |

| Web unit tests | web-regression.yml | `node --test apps/web/test/*.test.js`: web core and the navigation core (state machine, matching, progress, rerouting, arrival, privacy, RU/KK/EN) |
| Search/route UI | map-chromium.yml | Chromium, mocked MapLibre/APIs: search, places, route panel, retry/backoff, no external-map links |
| Navigation, simulated GPS | map-chromium.yml | Chromium with emulated geolocation: full trip, reroute, arrival, denied/weak/lost GPS, background, 429/cold start, layouts, a11y |
| Navigation, live DEV | dev-navigation-e2e.yml (manual) | real Routing API, graph, tiles and Search API with simulated GPS along the real geometry |
| App shell, Chromium (Phase 5.5) | map-chromium.yml | `scripts/test-shell-ui.js`: bottom-sheet drag/keyboard, tabs, quick categories, profile, layers, dialogs, locate states, keyboard inset, desktop layout, 5 phone sizes, 200 % text; mocked map and APIs |
| Shell logic | web-regression.yml | `apps/web/test/shell.test.js`: snap geometry and flicks, history, settings, units, strings, icons, contrast of the new tokens |
| Redesign, live DEV | dev-redesign-e2e.yml (manual) | `scripts/test-redesign-live.js`: real tiles, Search/Places/Routing APIs; categories, route, Navigator, navigation HUD, theme/language, desktop, security headers; GPS simulated |
| Navigation on a phone | manual, `docs/navigation-android-test.md` | **Real-world navigation validated** - not done until a physical test is recorded |

No HTTP-only test establishes that the map is rendered or that road geometry is accurate. The generated PMTiles artifact must be tested separately. Record image digests, source download checksum and import runtime in a follow-up PR.
