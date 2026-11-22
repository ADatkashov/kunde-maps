# kunde_maps_sdk

Reusable KUNDE Maps building blocks for Flutter. Version 0.1.0. Contains **no** Taxi, Delivery, Food or payment logic: it shows maps, finds
places, plans routes and guides a user along one. Decisions: [ADR 0007](../../docs/architecture/decisions/0007-kunde-maps-sdk-and-ecosystem-integration.md).

## Use

```yaml
dependencies:
  kunde_maps_sdk:
    git:
      url: https://github.com/ADatkashov/kunde-maps.git
      path: packages/kunde_maps_sdk
      ref: sdk-v0.1.0
```

```dart
final config = MapsConfig.fromEnvironment(language: 'ru'); // KUNDE_*_URL dart-defines, DEV by default
final client = MapsClient(config, http.Client());
final preview = await Routing(client).preview(pickup, destination); // distance, typical time, arrival
```

| Need | API |
| --- | --- |
| Map | `KundeMapView`, `KundeMapController` |
| Search | `PlaceSearch`, `PlaceSearchField` |
| Pick a point | `LocationPicker` |
| Device location | `Geolocation`, `LocationSource` |
| Routes, preview, ETA | `Routing`, `RoutePreviewData`, `RoutePreview`, `Eta` |
| Guidance | `NavigationController` (voice, reroute, arrival) |
| Markers, camera | `MapMarker`, `MapMarkers`, `CameraController` |

Every piece is independent: the services need only a `MapsClient`; widgets take services as arguments; `NavigationController` takes a
`LocationSource` and `VoiceGuide`, so tests and recorded tracks replace the GPS and the speaker.

## Rules the SDK enforces
- HTTPS-only configuration; no API keys in app builds (server-to-server callers use their own keys).
- Failures are `MapsException` with a stable `MapsErrorKind`; texts are localised in RU, KK and EN (`MapsStrings`).
- `MapsFeatures` switches search, routing, navigation, voice and live positions. The host reads them from its backend.
- A route preview is a distance and a *typical* time (no traffic). It is never a price or a promised arrival.
- Positions are sent to the Maps API only when needed (route endpoint, reroute); the GPS track stays in memory.
- OSM and OpenMapTiles attribution is drawn by `KundeMapView`.

## Test
```sh
flutter pub get
flutter analyze
flutter test --exclude-tags live            # unit + widget tests
flutter test --tags live test/live          # real DEV Maps Platform, nothing mocked
```
CI runs the unit tests on Flutter 3.47.9 and 3.50.1 and the live contract on main.
