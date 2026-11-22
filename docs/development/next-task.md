# Next task

1. **Real-world validation of Phase 5 navigation** on a physical Android phone (`docs/navigation-android-test.md`; battery, heat, GPS drift, background behaviour). Record results in `docs/development/project-state.md`; until then the status stays "DEV navigation verified with simulated GPS".
2. Phase 5 follow-ups found by that test: Kazakh maneuver wording review by a native speaker, voice prompts (speech synthesis), roundabout exit numbers / lanes (needs the Routing API to pass them through), speed-adaptive ETA only if a defensible method exists, pin the Valhalla image by digest, waypoints, upgrade Render plan (Starter $7) when always-on is needed (needs approval).
3. Phase 6: Flutter + MapLibre apps with background location and native TTS, reusing the contracts and the maneuver table of `nav.js` (`docs/architecture/decisions/0004-browser-navigation.md`).
4. Search: API keys / short-lived tokens for the public client. Places polish: category-aware text search ("кафе рядом"), wheelchair/cuisine filters from real tags.
5. Known small defects: MapLibre logs "Map cannot fit within canvas" once when the route panel opens on a phone (route fit padding, present since Phase 4); glyph range 8704-8959 of Open Sans is not self-hosted (404 for rare symbols in labels).
