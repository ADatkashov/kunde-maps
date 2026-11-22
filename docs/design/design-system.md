# KUNDE Maps design system v2 (Phase 5.5)

Implemented in `apps/web/ui.css` (tokens + components), `apps/web/shell.css` (layout), `apps/web/nav.css` (navigation HUD), `apps/web/icons.js` (icons).
Own visual language: dark graphite first, bright blue for actions, green for success. No third-party map-app assets, icons or code. Decisions: ADR 0005.
Before/after screenshots: `docs/design/screenshots/` (`before-*` = Phase 5 DEV, `after-*` = this redesign on DEV).

## Tokens (contrast-checked in `apps/web/test/contrast.test.js`, WCAG AA 4.5:1 for text, 3:1 for the focus ring)
| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` / `--surface` / `--surface-2` | `#f4f6fa` / `#ffffff` / `#eef1f6` | `#0d1015` / `#161a21` / `#1e232c` | page, cards and sheet, tiles and fields |
| `--text` / `--text-2` | `#0e1420` / `#4f5d70` | `#f1f4f9` / `#a3adbd` | primary / secondary text |
| `--primary` + `--on-primary` | `#2563eb` + `#fff` | `#2b66f2` + `#fff` | filled buttons, maneuver banner |
| `--primary-text` | `#2563eb` | `#7da6ff` | links, active tab, icons on surfaces (the fill colour is too dark for text on dark) |
| `--ok` / `--ok-solid` | `#15803d` | `#4ade80` / `#34d399` | open now, success fill |
| `--danger`, `--warn` | red / amber on tinted backgrounds | same | errors, warnings (4.5:1 pairs) |
Radii 12 / 18 / 24, touch target 44 px (map tools 48, tabs 58+), shadows `--shadow` / `--shadow-sm`, one easing `--ease`.
Theme: system / light / dark (Profile or the top-bar button), persisted in `localStorage` (`kunde-theme`; "system" removes the key).

## Components
Buttons (`.btn`, `.btn.primary/.subtle/.danger/.small`), icon button, pill button (language), search field, category chips (colour icon, selected state,
"More" reveals the rest), map tools (layers, zoom stack, compass only when rotated, locate with state dot), bottom sheet (3 snaps), place card, route
card (A/B fields, mode segmented control, alternatives, steps, Start), navigation HUD, loading (spinner, skeleton), error/empty/warn states, dialog
(native `<dialog>`: focus trap, Esc, focus returns), popover, switch (`role="switch"`), segmented control, toast (`#status`), tab bar.

## Screens
- **Search (home)**: top bar (logo, language, theme), search field, category chips; sheet collapsed = four quick actions (Route, Drive, Saved, Add place);
  expanded = recent searches (device-local, switchable) and "Near you" tiles (groceries, food, hotels, pharmacies, fuel, More -> all 17 real categories).
- **Directions**: planner with A/B fields, swap, device position / tap-on-map start, car/walk/bike, alternatives, summary, collapsible steps, Start.
- **Navigator**: with a ready route it focuses *Start*; without one it explains and offers *Build a route*. GPS only starts on *Start*.
- **Saved**: the device-local list (no sync, said in the panel).
- **Profile**: language, theme, units (km / miles), low-power mode, search-history switch, privacy text, delete local data (confirm dialog), about + ODbL.
- **Place card**: category chip, title, kind, open-now badge, distance (when known), address / phone / website / brand / hours only if OSM has them,
  Route / Save / Share, copy coordinates. No ratings, photos or prices.
- **Navigation**: unchanged behaviour (Phase 5); while active the whole shell is hidden, banner + bottom bar remain, OSM attribution stays visible.

## Layout
- Mobile (< 720 px): map is the full screen; floating top bar; fixed tab bar; sheet snaps collapsed / half / full and never covers the top bar; map tools sit on the
  right above the sheet (`--sheet-h`), hide under the full sheet; keyboard: tab bar hides and the sheet rides on the keyboard (`visualViewport`).
  Landscape phones get a narrow left sheet. Safe areas via `env(safe-area-inset-*)`.
- Desktop (>= 720 px): left sidebar 404-420 px holds search, categories, content and tabs; the map keeps the whole window (camera padding clears the sidebar).

## Performance and accessibility
No new libraries, no web fonts, one icon module; all effects are CSS transitions on a few elements, none permanent. `prefers-reduced-motion` and the
Low-power mode remove animations; Low-power also disables 3D. Roles/ARIA: tab bar `nav` with `aria-current`, arrows/Home/End; sheet handle is a button with
`aria-expanded` and a state label; switches `role="switch"`; segmented controls `aria-pressed`; dialog is modal; combobox pattern for search unchanged.

## Quality gates
`apps/web/test/*.test.js` (contrast of 20+ token pairs per theme, sheet geometry, history, settings, units, strings, no-promise wording, no third-party code),
`scripts/test-search-ui.js` (48 Chromium scenarios, mocked map and APIs), `scripts/test-navigation-ui.js` (11, simulated GPS), `scripts/test-shell-ui.js` (19: gestures,
tabs, categories, profile, layers, dialogs, keyboard inset, desktop, 5 phone sizes, 200 % text), `scripts/test-redesign-live.js` (real DEV: map, APIs, GPS simulated).
Not automated: pixel-diff, axe-core audit, real-device gesture/FPS profile, iOS Safari / Samsung Internet (Chromium emulation only).

## Map style v2 (Phase 2, stage C)
Generated by `scripts/build-style.py` (light + dark palettes, 54 layers each), committed as `apps/web/style.json` / `style-dark.json`; do not edit by hand
(`--check` fails CI on drift). Built for the production OpenMapTiles-schema PMTiles (layers/fields recorded in `scripts/fixtures/tile-layers.json`).

- Hierarchy: land cover (wood/grass/farmland/wetland/sand/rock/ice) and land use are quiet; water and waterways (dashed when intermittent);
  parks with outline; buildings from z13; roads by class (service < minor < tertiary < secondary < primary/trunk < motorway) with casings,
  bridges/tunnels (tunnels dashed and faded), tracks/paths dashed, rail; country/region boundaries; airports.
- Labels: country/region (caps), city/town/village/suburb tiers sorted by OSM `rank`, street names along lines, road refs, water and waterway
  names (italic), mountain peaks with elevation, aerodromes, house numbers (z16+), POI names (z15.5+).
- POIs are coloured dots by category (food, shops, health, education, transport, lodging, finance, fuel); no sprite sheet is hosted yet,
  so no icons. Uncategorised dots appear only from z17.
- Language: every label layer stores RU/KK/EN `text-field` templates in `metadata["kunde:text"]`; the UI language selects them
  (fallbacks: KK -> name, RU -> name; EN -> name:en, name:latin, name).
- Fonts: only Open Sans Regular/Semibold/Bold/Italic are available from the glyph host with Cyrillic + Kazakh letters (Noto is not served).
  Glyph PBFs are self-hosted under `/fonts/` (`apps/web/fonts`, checksummed in CI); the style needs no sprite sheet.
- Attribution: (c) OpenStreetMap contributors and OpenMapTiles in the source attribution.
- Performance: no 3D extrusion, no raster/hillshade; one vector source; style size ~30 KB per theme.
- Verified: official MapLibre spec validator (CI), field/layer existence vs the real archive, light/dark parity, font whitelist, label
  contrast (>= 7:1 main, >= 4:1 secondary), real-map screenshots at z5/z9/z11/z13/z14/z16 in light and dark, RU/KK/EN.
- Limits: tiles end at z14 (house numbers/POIs/buildings are over-zoomed beyond); no terrain shading; Kazakhstan has few tagged
  motorways so national-scale road lines are sparse by nature of the data.
