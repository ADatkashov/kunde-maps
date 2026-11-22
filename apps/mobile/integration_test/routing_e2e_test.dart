// Android Routing E2E.
//
// Runs the real app on an Android emulator or device against the real DEV
// Search and Routing APIs (no HTTP mocks) and the native MapLibre view. A
// route only counts as working when
//   * the API answered HTTP 200 with a non-empty road geometry, distance, ETA,
//   * the app decoded it (diagnostics: points, meters, seconds),
//   * the native map reports that the route line is actually rendered
//     (queryRenderedFeaturesInRect on the route layer, run by the app).
// GPS is replayed through a fake GeolocatorPlatform (an emulator has no
// satellite); permission/ service-off behaviour is exercised the same way.
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:maplibre_gl/maplibre_gl.dart' as map;
import 'package:maps/core/diagnostics.dart';
import 'package:maps/core/platform_api.dart';
import 'package:maps/core/strings.dart';
import 'package:maps/main.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeGps extends GeolocatorPlatform {
  bool serviceEnabled = true;
  LocationPermission permission = LocationPermission.whileInUse;
  double latitude = 43.238946; // Republic Square, Almaty (OSM place 672026)
  double longitude = 76.945167;

  @override
  Future<bool> isLocationServiceEnabled() async => serviceEnabled;

  @override
  Future<LocationPermission> checkPermission() async => permission;

  @override
  Future<LocationPermission> requestPermission() async => permission;

  @override
  Future<Position> getCurrentPosition({
    LocationSettings? locationSettings,
  }) async => Position(
    latitude: latitude,
    longitude: longitude,
    timestamp: DateTime.now(),
    accuracy: 5,
    altitude: 0,
    altitudeAccuracy: 0,
    heading: 0,
    headingAccuracy: 0,
    speed: 0,
    speedAccuracy: 0,
    isMocked: true,
  );
}

const words = Words('en');

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const capture = bool.fromEnvironment('KUNDE_TEST_SCREENSHOTS');
  late FakeGps gps;
  GeolocatorPlatform? previous;

  setUp(() {
    previous = GeolocatorPlatform.instance;
    gps = FakeGps();
    GeolocatorPlatform.instance = gps;
    diagnostics.clear();
    SharedPreferences.setMockInitialValues({
      'language': 'en',
      'theme': 'light',
      'voice': false,
    });
  });
  tearDown(() => GeolocatorPlatform.instance = previous!);

  Future<void> pumpFor(WidgetTester tester, Duration duration) async {
    final end = DateTime.now().add(duration);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  Future<void> waitUntil(
    WidgetTester tester,
    bool Function() condition,
    String what, {
    int seconds = 60,
  }) async {
    final end = DateTime.now().add(Duration(seconds: seconds));
    while (!condition() && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(condition(), isTrue, reason: '$what | ${diagnostics.toString()}');
  }

  Future<void> until(WidgetTester tester, Finder finder, {int seconds = 60}) =>
      waitUntil(
        tester,
        () => finder.evaluate().isNotEmpty,
        'waiting for a widget',
        seconds: seconds,
      );

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await until(tester, finder);
    await tester.ensureVisible(finder.first);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(finder.first);
    await tester.pump(const Duration(milliseconds: 500));
  }

  Future<void> shot(WidgetTester tester, String name) async {
    if (!capture) return;
    await tester.pump(const Duration(milliseconds: 500));
    await binding.takeScreenshot(name);
  }

  Future<void> launch(WidgetTester tester) async {
    await tester.pumpWidget(KundeMaps(await SharedPreferences.getInstance()));
    if (capture) await binding.convertFlutterSurfaceToImage();
    await until(tester, find.byType(map.MapLibreMap));
    await waitUntil(
      tester,
      () => diagnostics['map'] == 'style-loaded',
      'native map style loaded',
    );
  }

  int number(String key) => int.tryParse(diagnostics[key] ?? '') ?? 0;

  /// Taps "Build route" and waits for the full pipeline: HTTP 200, decoded
  /// road geometry, distance, ETA and the line rendered by native MapLibre.
  Future<void> buildAndVerify(WidgetTester tester, String label) async {
    await tap(tester, find.text(words('build')));
    await waitUntil(
      tester,
      () => number('rendered') > 0 || diagnostics['error'] != null,
      '$label: route response and render',
      seconds: 150, // Render free tier can need a minute to wake up
    );
    expect(diagnostics['error'], isNull, reason: label);
    expect(diagnostics['status'], '200', reason: label);
    expect(number('points'), greaterThan(2), reason: '$label road geometry');
    expect(number('meters'), greaterThan(100), reason: '$label distance');
    expect(number('seconds'), greaterThan(10), reason: '$label ETA');
    expect(number('source'), greaterThan(0), reason: '$label GeoJSON source');
    expect(number('rendered'), greaterThan(0), reason: '$label line rendered');
    expect(number('painted'), number('points'), reason: '$label painted');
    expect(find.textContaining(words('minutes')), findsWidgets);
    expect(find.text(words('start')), findsWidgets);
  }

  Future<void> pickOnMap(
    WidgetTester tester,
    String field,
    map.LatLng point,
  ) async {
    await tap(tester, find.text(words(field)));
    await tap(tester, find.text(words('pick')));
    await until(tester, find.text(words('tap')));
    // The native map selection event, delivered at a public waypoint.
    tester.widget<map.MapLibreMap>(find.byType(map.MapLibreMap)).onMapClick!(
      const math.Point<double>(150, 240),
      point,
    );
    await tester.pumpAndSettle();
  }

  Future<void> searchAndSelect(WidgetTester tester, String query) async {
    // Resolve the place with the same real Search API and the map centre the
    // app itself uses for its first search, so the UI shows the same result.
    final client = http.Client();
    addTearDown(client.close);
    final found = await PlatformApi(client)
        .search(query, 'en', const Point(48.1, 67.8), Completer<void>().future);
    final place = found.first;
    expect(place.point.lat, inInclusiveRange(43.0, 43.5), reason: 'in Almaty');
    expect(place.point.lon, inInclusiveRange(76.6, 77.2), reason: 'in Almaty');
    final name = place.name('en', '');
    expect(name, isNotEmpty);
    await tester.enterText(find.byType(TextField), name);
    await tester.pump(const Duration(milliseconds: 500));
    final tile = find.byWidgetPredicate(
      (w) =>
          w is ListTile &&
          w.title is Text &&
          (w.title! as Text).data == name &&
          w.leading is Icon,
    );
    await until(tester, tile);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tap(tester, tile);
  }

  testWidgets('search → place → route from current GPS position', (
    tester,
  ) async {
    await launch(tester);
    await searchAndSelect(tester, 'Mega Alma-Ata');
    await tap(tester, find.byIcon(Icons.directions_outlined).first);
    await tap(tester, find.text(words('origin')));
    await tap(tester, find.text(words('locate')));
    await until(tester, find.text(words('build')));
    expect(diagnostics['gps'], startsWith('fix'));
    await buildAndVerify(tester, 'GPS → searched place');
    await shot(tester, 'gps-to-place-route');
  });

  testWidgets(
    'map point A → B, change destination, rebuild, recover from error',
    (tester) async {
      await launch(tester);
      await tap(
        tester,
        find.widgetWithText(NavigationDestination, words('directions')),
      );
      // MEGA Alma-Ata → Dostyk Plaza (OSM places 201232 and 330101).
      await pickOnMap(tester, 'origin', const map.LatLng(43.202109, 76.891926));
      await pickOnMap(
        tester,
        'destination',
        const map.LatLng(43.232663, 76.956966),
      );
      await buildAndVerify(tester, 'MEGA → Dostyk');
      final firstMeters = number('meters');
      expect(firstMeters, inInclusiveRange(7000, 14000));
      await shot(tester, 'map-a-to-b-route');

      // Changing the destination removes the old line immediately.
      await tap(tester, find.text(words('destination')));
      await tap(tester, find.text(words('pick')));
      await until(tester, find.text(words('tap')));
      tester.widget<map.MapLibreMap>(find.byType(map.MapLibreMap)).onMapClick!(
        const math.Point<double>(150, 240),
        const map.LatLng(43.1945184, 76.8838692), // First President's Park
      );
      await tester.pumpAndSettle();
      await waitUntil(
        tester,
        () => diagnostics['painted'] == '0',
        'old route line removed after destination change',
      );
      expect(find.text(words('start')), findsNothing);
      diagnostics.setAll({'rendered': null, 'source': null, 'error': null});
      await buildAndVerify(tester, 'MEGA → Park');
      expect(number('meters'), isNot(firstMeters));

      // Rebuild in the opposite direction.
      await tap(tester, find.byIcon(Icons.swap_vert));
      await waitUntil(
        tester,
        () => diagnostics['painted'] == '0',
        'route cleared by swap',
      );
      diagnostics.setAll({'rendered': null, 'source': null, 'error': null});
      await buildAndVerify(tester, 'Park → MEGA');

      // A real API error (points too close) is shown, then the planner recovers.
      await pickOnMap(
        tester,
        'destination',
        const map.LatLng(43.1945, 76.88387),
      );
      await tap(tester, find.text(words('build')));
      await until(tester, find.text(words('routeTooClose')));
      expect(find.text(words('retry')), findsOneWidget);
      await pickOnMap(
        tester,
        'destination',
        const map.LatLng(43.232663, 76.956966),
      );
      diagnostics.setAll({'rendered': null, 'source': null, 'error': null});
      await buildAndVerify(tester, 'recovered after error');
    },
  );

  testWidgets('Almaty reference routes return real road geometry', (
    tester,
  ) async {
    final client = http.Client();
    addTearDown(client.close);
    final api = PlatformApi(client);
    // Coordinates from the DEV Places API (OSM): see docs/routing-api.md.
    const cases = [
      (
        'MEGA → Dostyk Plaza',
        Point(43.202109, 76.891926),
        Point(43.232663, 76.956966),
        7000.0,
        14000.0,
      ),
      (
        'Republic Square → First President Park',
        Point(43.238946, 76.945167),
        Point(43.194518, 76.883869),
        7000.0,
        14000.0,
      ),
      (
        'Airport → Almaty-2',
        Point(43.346033, 77.011753),
        Point(43.27373, 76.939183),
        10000.0,
        20000.0,
      ),
    ];
    for (final (name, from, to, min, max) in cases) {
      final routes = await api.route(from, to, 'car', 'en', retries: 4);
      final route = routes.first;
      expect(route.meters, inInclusiveRange(min, max), reason: name);
      expect(route.seconds, greaterThan(300), reason: name);
      expect(route.points.length, greaterThan(20), reason: '$name geometry');
      expect(route.steps, isNotEmpty, reason: name);
      expect(route.points.every(inKazakhstan), isTrue, reason: name);
      expect(route.points.first.lat, closeTo(from.lat, .01), reason: name);
      expect(route.points.last.lon, closeTo(to.lon, .01), reason: name);
    }
  });

  testWidgets('GPS denied and GPS off give a clear message, no route', (
    tester,
  ) async {
    await launch(tester);
    await tap(
      tester,
      find.widgetWithText(NavigationDestination, words('directions')),
    );
    gps.permission = LocationPermission.denied;
    await tap(tester, find.text(words('origin')));
    await tap(tester, find.text(words('locate')));
    await until(tester, find.text(words('gpsDenied')));
    expect(diagnostics['gps'], 'denied');
    await pumpFor(tester, const Duration(seconds: 5));

    gps.permission = LocationPermission.whileInUse;
    gps.serviceEnabled = false;
    await tap(tester, find.text(words('origin')));
    await tap(tester, find.text(words('locate')));
    await until(tester, find.text(words('gpsOff')));
    expect(diagnostics['gps'], 'serviceOff');
    expect(find.text(words('start')), findsNothing);
  });
}
