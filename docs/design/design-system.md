# KUNDE Maps design system v1

Implemented in `apps/web/ui.css` (CSS custom properties). Own visual language; no third-party map-app assets or icons.
Style: modern minimal, floating surfaces over a full-screen map, soft shadows, 12-16 px radii.

## Tokens (final, contrast-checked)
| Token | Light | Dark |
| --- | --- | --- |
| `--primary` | `#2563EB` | `#5B8DEF` |
| `--on-primary` | `#FFFFFF` | `#0B1220` |
| `--accent` | `#0D9488` | `#2DD4BF` |
| `--bg` / `--surface` | `#F8FAFC` / `#FFFFFF` | `#0B1220` / `#121A2B` |
| `--text` / `--text-2` | `#0F172A` / `#556377` | `#E8EEF9` / `#9FB0C8` |
| `--border` | `#E2E8F0` | `#26324A` |

Measured WCAG contrast (computed, see PR): text 17.9:1 / 14.9:1; secondary text 6.1:1 / 7.9:1; on-primary 5.2:1 / 5.8:1;
primary on surface 5.2:1 / 5.4:1; danger/warn banners 5.9-9.4:1; map labels 5.6:1 (light) / 8.2:1 (dark). All >= 4.5:1.
The suggested secondary text `#64748B` (4.76:1) passes but was darkened to `#556377` for small text.

Theme: follows `prefers-color-scheme`, manual toggle persisted in `localStorage` (`kunde-theme`). The map recolors via a
palette table in `map.js` (`PALETTES`); a dedicated dark style file is a later option.

## Typography and icons
Font stack `Inter, "Noto Sans", system-ui, ...` (Cyrillic incl. Kazakh letters covered by Noto/system fonts). No web font is
downloaded yet; self-hosting Inter (OFL) is a follow-up. One inline stroke icon set (24 px grid, 2 px stroke).

## Layout
- Desktop (>= 720 px): left rail (brand, search, results or place card), controls top-right, coordinates chip bottom-left.
- Mobile (< 720 px): search on top, results/place card in a bottom sheet (max 62 dvh, handle collapses it), safe-area aware;
  the sheet height is exposed as `--sheet-h` so map attribution and toasts stay visible above it.
- Touch targets 44 px, `:focus-visible` rings, `prefers-reduced-motion`, forced-colors fallback.

## Components and states
Search bar (combobox/listbox ARIA, `/` focuses it), suggestions with loading skeleton, empty, error + retry, rate-limit
countdown, "service waking up" notice (Render Free cold start), place card (share link, copy coordinates), map controls,
toast, language switch (RU/KK/EN), theme switch. Not yet built: category chips, route planner, navigation panel, favorites,
settings, dialogs (need real data/features first).

## Quality gates
`apps/web/test/*.test.js` (core logic), `scripts/test-search-ui.js` (17 browser scenarios incl. 320-430 px overflow and
touch-target checks, XSS-safe rendering, races), `scripts/test-map-chromium.js` (missing-tiles smoke).
Not yet automated: pixel-diff screenshots, axe accessibility scan, tablet/landscape matrix, large system fonts.
