# Changelog

Versions follow SemVer. Consumers pin a git tag `sdk-vX.Y.Z`. Public API additions are minor; removals or renames are major and are
deprecated for one release first.

## 0.2.1
- Fix: SDK widgets work inside host apps built on `package:flutter/material.dart` (found by the Android emulator E2E:
  "No MaterialLocalizations / No Material widget found" in the search field). Every public widget now brings its own localizations,
  theme and Material; `MapsAppearanceScope` / `MapsAppearance` lets the host set brand colour, font and brightness.

## 0.2.0
- Added `NavigationView` (route line, destination and position markers, follow camera with recenter) and `NavigationHud`
  (manoeuvre, distance, remaining distance and arrival time, GPS/rerouting/voice state), plus `formatDistance`.
- `MapsStrings`: navigation texts (stop, voice, rerouting, weak GPS, recenter, retry) and the `gps` error in RU/KK/EN.
- No breaking changes.

## 0.1.0
- First release, extracted from the KUNDE Maps app: `KundeMapView`, `PlaceSearch`/`PlaceSearchField`, `LocationPicker`,
  `Geolocation`/`LocationSource`, `Routing`/`RoutePreviewData`/`RoutePreview`, `NavigationController`, `Eta`,
  `MapMarker`/`MapMarkers`, `CameraController`, `MapsConfig`/`MapsFeatures`, `MapsStrings`, `MapsException`.
