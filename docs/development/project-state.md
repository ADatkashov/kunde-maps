# Project state (updated 2026-11-22)

Verified in this session by executed checks:
- Search API (Render, `kunde-maps-search-dev`): live, index 1,450,805 rows; 403 root cause = Cloudflare error 1010 on the
  `Python-urllib` User-Agent (fixed in PR #2, merged as `3fe9994`). See `docs/search-prototype.md`.
- Web (`apps/web`): new design system, search UI wired to the Search API, share links, RU/KK/EN, light/dark.
  Tests: 15 Node unit tests, 17 browser scenarios, 14 Search API tests, legacy smoke test.
- Visual check with the real map (real PMTiles from R2, real Search API) in Chromium at 1366x768, 1920x1080 (dark),
  390x844 and 360x740 (touch): search -> select -> fly-to -> marker -> card worked, 0 console errors.

Known limits
- `Almaty` (Latin) does not find the city: the index has no `name:en`/transliteration (Phase 2).
- Search API is public with no rate limiting/keys (Phase 2). CSP header and SRI/vendoring of unpkg libraries not done.
- Render Free: cold start (~30-60 s) and ~155 MB index re-download per new instance.
- No categories/POI filters, routing, navigation, favorites, mobile apps yet.
- Cartographic style is still the minimal 7-layer preview (no road classes, POI icons, building heights, dark style file).
