# ADR 0005 — App shell redesign (Phase 5.5)

Status: accepted, implemented in the web client. Date: 2026-11-22.

## Context
Phase 1-5 grew the web client panel by panel (search, places, routes, navigation). The UI was a floating search bar with a sheet that
appeared only when it had content, controls in a corner stack and no top-level navigation. For daily use on a phone we want the
structure of a modern map app: the map fills the screen, a persistent bottom sheet with three heights, a bottom tab bar, compact map tools
and a different (sidebar) composition on desktop. Constraints from `AGENTS.md`: no fake data, no third-party map assets, strict CSP, no new
services, tests for everything we claim.

## Decisions
1. **No UI framework.** Plain DOM + CSS custom properties, same as before. New files: `shell.js` (DOM-free logic: sheet geometry, history,
   settings, strings; unit-tested in Node), `shell-ui.js` (sheet gestures, tabs, dialog, popover), `icons.js` (original icon set),
   `shell.css` (layout), `ui.css` (tokens + components). `map.js` keeps owning application state and reaches the shell through callbacks.
2. **Existing element ids and flows are kept.** Search, places, routing and navigation code was not rewritten; only the markup around it moved.
   Where behaviour changed on purpose (the sheet is always present; a card opened from Saved returns to Saved), the old tests were adapted and
   the reason is recorded in the PR.
3. **Bottom sheet = three snap points** (collapsed ~124 px, half ~46 % of the free height, full = below the top bar). Drag on the grip only
   (pointer events, `touch-action: none`), so map gestures and sheet scrolling never compete; flick = one step, otherwise nearest snap; a rest
   before lifting is not a flick. Keyboard: Arrow Up/Down, Home/End, Enter cycles. The sheet height is exposed as `--sheet-h` (sheet + tab bar)
   so the OSM attribution, toasts and map tools always stay above it. The virtual keyboard is handled with `visualViewport` (tab bar hides, sheet
   sits on the keyboard), because Android Chrome and iOS Safari do not resize the layout viewport.
4. **Tabs are derived state.** The current tab is computed from which panel is open; there is no second source of truth. Navigator never starts GPS: with
   a ready route it focuses *Start*, without one it offers to build a route.
5. **Desktop is a different composition**, not a stretched sheet: one left sidebar (brand, search, categories, content, tabs), map tools on the map.
6. **Honesty rules in the UI.** No traffic colouring (no verified source; see `docs/design/traffic-architecture.md`), no voice search (browser speech
   recognition sends audio to a third party), no weather, ratings or photos, "Add a place" is an explanatory dialog (accounts and moderation do not
   exist), "Banks & ATMs" is the real `bank` category (it includes ATMs, there is no ATM-only category).
7. **3D buildings are optional and conservative**: off by default, never in low-power mode, only features with a tile `render_height` above 5 m are
   extruded (flat otherwise). Low-power mode (default on devices reporting <= 2 GB RAM or <= 2 cores) removes 3D and all animation.
8. **Local settings only** (language, theme, units, low-power, search history switch) in `localStorage`; "Delete data on this device" wipes them.
   No account and no sync are implied anywhere.

## Consequences
- The page is still static, same CSP (`script-src 'self'; style-src 'self'`): all dynamic styling uses CSSOM, never inline `style=""`/`<style>`.
- `shell.js` keeps UI rules testable without a browser; the gesture layer is covered by Chromium tests.
- Open: a real-device performance/gesture pass on budget Android, a virtual keyboard check on iOS Safari and Samsung Internet (emulated only), axe-core style
  automated audit in CI, icon sprite for map POIs, traffic when a lawful data source exists.
