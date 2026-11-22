# ADR 0006 — MapLibre Native for Flutter

Use Flutter with `maplibre_gl` 0.28.0 (BSD-3-Clause) for Android and iOS.
The package ships MapLibre Native Android 13.7.1 (OpenGL ES) and iOS 7.0.0.
Its release history includes dual-platform PMTiles support and an iOS
background crash fix for PMTiles sources. Its public API exposes native
camera, gestures, style layers, GeoJSON and annotation managers.
The app minimum iOS target is 15.5.

The native style is built from the Phase 5.5 web palette and layer templates.
The archive is the existing HTTPS R2 PMTiles object addressed with
`pmtiles://https://…`. Glyphs remain on the KUNDE web origin and the style
has no sprite dependency. CI checks the bundled styles byte-for-byte
against the canonical generated styles. OSM and OpenMapTiles attribution
is visible and OSM attribution links to the licensing page.

The existing archive returned HTTP 206 for a 127-byte range in DEV.
This verifies hosting behavior. Native rendering, cache behavior and
performance still require emulator and device verification. OpenGL ES is
the baseline until measurements justify a renderer change. The Places
request is capped at 45 markers to limit annotation work. The existing
building footprints remain visible. Extrusions need verification on both
native SDKs and a data-quality check before activation.

Search, places and routing use the existing versioned HTTPS endpoints.
The app sends no API key. It relies on the existing public endpoint quotas,
concurrency controls and coordinate-log protections. Device position is
sent to routing only when used as an endpoint or for a reroute. A nearby
search rounds the reference point to three decimal places. A navigation
track stays in memory and is cleared when guidance ends.
