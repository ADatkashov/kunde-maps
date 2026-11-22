import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:maplibre_gl/maplibre_gl.dart' as map;
import 'package:maps/core/platform_api.dart';
import 'package:maps/features/map_style.dart';
import 'package:material_ui/material_ui.dart';

import 'route_journey.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  routeJourney(binding);

  testWidgets('native MapLibre renders roads and a live DEV route', (
    tester,
  ) async {
    final style = await nativeStyle(false, 'en');
    map.MapLibreMapController? controller;
    var styleLoaded = false;
    final nativeView = map.MapLibreMap(
      initialCameraPosition: const map.CameraPosition(
        target: map.LatLng(43.238194, 76.94498),
        zoom: 14,
      ),
      styleString: style,
      onMapCreated: (value) => controller = value,
      onStyleLoadedCallback: () => styleLoaded = true,
    );
    await tester.pumpWidget(
      MaterialApp(home: SizedBox.expand(child: nativeView)),
    );
    final client = http.Client();
    addTearDown(client.close);
    final routes = await PlatformApi(client).route(
      const Point(43.238194, 76.94498),
      const Point(43.2555, 76.955326),
      'car',
      'en',
      alternatives: true,
    );
    var routeShown = false;
    final watch = Stopwatch()..start();
    while (watch.elapsed < const Duration(seconds: 55)) {
      await tester.pump(const Duration(milliseconds: 500));
      if (!styleLoaded || controller == null) continue;
      final size = tester.getSize(find.byType(map.MapLibreMap));
      final roads = await controller!.queryRenderedFeaturesInRect(
        Offset.zero & size,
        ['road-minor', 'road-tertiary', 'road-secondary', 'road-primary'],
        null,
      );
      if (roads.isEmpty) continue;
      if (!routeShown) {
        await controller!.setGeoJsonSource(
          routeSourceId,
          routeFeatures(routes, routes.first),
        );
        routeShown = true;
      }
      final line = await controller!.queryRenderedFeaturesInRect(
        Offset.zero & size,
        [primaryRouteLayerId],
        null,
      );
      if (line.isNotEmpty) return;
    }
    fail('KUNDE DEV roads and selected route did not render within 55 seconds');
  });

  testWidgets(
    'Mobile network reaches the existing Search, Places and Routing APIs',
    (tester) async {
      final client = http.Client();
      addTearDown(client.close);
      final api = PlatformApi(client);
      const almaty = Point(43.238194, 76.94498);
      final results = await api.search(
        'Almaty',
        'en',
        almaty,
        Completer<void>().future,
      );
      expect(results, isNotEmpty);
      expect(await api.categories(), contains('cafe'));
      final nearby = await api.nearby(almaty, 'cafe');
      final id = nearby.first.osmId;
      expect(id, isNotNull);
      expect((await api.details(id!)).osmId, id);
      final roads = await api.route(
        almaty,
        const Point(43.2555, 76.955326),
        'car',
        'en',
      );
      expect(roads.first.points.length, greaterThan(2));
      expect(roads.first.steps, isNotEmpty);
    },
  );
}
