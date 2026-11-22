import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:maplibre_gl/maplibre_gl.dart' as map;
import 'package:maps/core/platform_api.dart';
import 'package:maps/core/strings.dart';
import 'package:maps/features/session.dart';
import 'package:maps/main.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ReplayLocation extends GeolocatorPlatform {
  final fixes = StreamController<Position>.broadcast();

  @override
  Future<bool> isLocationServiceEnabled() async => true;

  @override
  Future<LocationPermission> checkPermission() async =>
      LocationPermission.whileInUse;

  @override
  Stream<Position> getPositionStream({LocationSettings? locationSettings}) =>
      fixes.stream;

  void fix(double latitude, double longitude) {
    fixes.add(
      Position(
        latitude: latitude,
        longitude: longitude,
        timestamp: DateTime.now(),
        accuracy: 4,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 90,
        headingAccuracy: 4,
        speed: 8,
        speedAccuracy: 1,
        isMocked: true,
      ),
    );
  }
}

void routeJourney(IntegrationTestWidgetsFlutterBinding binding) {
  testWidgets(
    'route planner builds a live route and starts and ends GPS replay',
    (tester) async {
      const language = String.fromEnvironment(
        'KUNDE_TEST_LOCALE',
        defaultValue: 'en',
      );
      const theme = String.fromEnvironment(
        'KUNDE_TEST_THEME',
        defaultValue: 'light',
      );
      const capture = bool.fromEnvironment('KUNDE_TEST_SCREENSHOTS');
      const words = Words(language);

      final previous = GeolocatorPlatform.instance;
      final locations = ReplayLocation();
      GeolocatorPlatform.instance = locations;
      const channel = MethodChannel('kz.kunde.maps/permissions');
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(channel, (_) async => true);
      addTearDown(() async {
        GeolocatorPlatform.instance = previous;
        messenger.setMockMethodCallHandler(channel, null);
        await locations.fixes.close();
      });
      SharedPreferences.setMockInitialValues({
        'language': language,
        'theme': theme,
        'voice': false,
      });

      Future<void> until(Finder target, {int seconds = 45}) async {
        final deadline = DateTime.now().add(Duration(seconds: seconds));
        while (target.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 300));
        }
        expect(target, findsWidgets);
      }

      Future<void> tap(Finder target) async {
        await until(target);
        await tester.ensureVisible(target.first);
        await tester.pumpAndSettle();
        await tester.tap(target.first);
        await tester.pump(const Duration(milliseconds: 400));
      }

      Future<void> screenshot(String name) async {
        if (!capture) return;
        await tester.pump(const Duration(milliseconds: 300));
        await binding.takeScreenshot('$language-$theme-$name');
      }

      await tester.pumpWidget(KundeMaps(await SharedPreferences.getInstance()));
      if (capture) await binding.convertFlutterSurfaceToImage();
      await until(find.byType(map.MapLibreMap));
      await tester.enterText(find.byType(TextField), 'Абая');
      await tester.pump(const Duration(milliseconds: 450));
      final result = find.byWidgetPredicate(
        (widget) =>
            widget is ListTile &&
            widget.leading is Icon &&
            (widget.leading as Icon).icon == Icons.place_outlined,
      );
      await until(result);
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await screenshot('search');
      await tap(result);
      await screenshot('place');
      final directions = find.widgetWithText(
        NavigationDestination,
        words('directions'),
      );
      await tap(directions);

      Future<void> pick(String field, map.LatLng point) async {
        await tap(find.text(words(field)));
        await tap(find.text(words('pick')));
        await until(find.text(words('tap')));
        // Deliver the native map selection event at a stable public waypoint.
        tester
            .widget<map.MapLibreMap>(find.byType(map.MapLibreMap))
            .onMapClick!(const math.Point<double>(150, 240), point);
        await tester.pumpAndSettle();
      }

      await pick('origin', const map.LatLng(43.238194, 76.94498));
      await pick('destination', const map.LatLng(43.2555, 76.955326));
      await tap(find.text(words('build')));
      final start = find.text(words('start'));
      await until(start);
      await tester.ensureVisible(start.first);
      await tester.pumpAndSettle();
      expect(find.textContaining(words('minutes')), findsWidgets);
      await screenshot('route');

      await tap(start);
      await until(find.text(words('stop')));
      locations.fix(43.238194, 76.94498);
      await until(find.text(words('following')));
      await screenshot('navigation');
      locations.fix(43.238231, 76.94543);
      await tester.pump(const Duration(seconds: 1));
      await tap(find.text(words('stop')));
      expect(locations.fixes.hasListener, isFalse);

      await tap(find.widgetWithText(NavigationDestination, words('search')));
      await screenshot('map');
      await tap(find.widgetWithText(NavigationDestination, words('saved')));
      await screenshot('saved');
      await tap(find.widgetWithText(NavigationDestination, words('profile')));
      await screenshot('profile');
      await tester.pumpWidget(const SizedBox.shrink());

      final client = http.Client();
      addTearDown(client.close);
      final api = PlatformApi(client);
      const destination = Point(43.2555, 76.955326);
      final original = (await api.route(
        const Point(43.238194, 76.94498),
        destination,
        'car',
        language,
      )).first;
      final session = NavigationSession(
        api,
        words,
        'car',
        destination,
        original,
      )..voice = false;
      addTearDown(session.dispose);
      expect(await session.start(), isTrue);
      for (var i = 0; i < 3; i++) {
        locations.fix(43.2393, 76.945);
        await tester.pump(const Duration(milliseconds: 1100));
      }
      final rerouteDeadline = DateTime.now().add(const Duration(seconds: 45));
      while (identical(session.progress.route, original) &&
          DateTime.now().isBefore(rerouteDeadline)) {
        await tester.pump(const Duration(milliseconds: 300));
      }
      expect(session.progress.route, isNot(same(original)));
      session.stop();
      expect(locations.fixes.hasListener, isFalse);
    },
  );
}
