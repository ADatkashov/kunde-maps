# KUNDE Maps mobile design

The Phase 5.5 design system in `docs/design/design-system.md` defines the
colors, map hierarchy and five primary destinations. The Android and iOS
app uses the same style palettes and label templates, with platform text
rendering and Flutter controls. The mobile map remains visible behind the
search bar and draggable sheet. The blue guidance banner occupies the
same location as search during a trip. Route status and remaining travel
stay in the bottom sheet.

Use short RU, KK and EN strings in the common catalog. The map and place
details show actual data from the platform. Keep attribution readable in
both themes. Use safe areas for interactive controls and preserve system
text scaling. Place cards omit unavailable fields. Keep a loaded route
visible while network-dependent rerouting is unavailable.

Phase 6.1 keeps the map full-screen behind the floating search and tools.
The sheet has collapsed, half and expanded snap points. Route planning
uses A/B fields with a swap control, a mode selector, a route summary and
an action pinned above attribution so Build and Start stay visible.
The trip view uses a navy maneuver banner with large distance text and
keeps End navigation in reach at the bottom. Layers controls the theme
and basemap place labels. The tab bar yields space to the keyboard.
