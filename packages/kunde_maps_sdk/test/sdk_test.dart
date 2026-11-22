import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kunde_maps_sdk/kunde_maps_sdk.dart';
import 'package:material_ui/material_ui.dart';

// Real Valhalla response captured from the DEV routing API.
final _fixture =
    jsonDecode(
          File(
            '../../apps/web/test/fixtures/route-almaty-car.json',
          ).readAsStringSync(),
        )
        as Json;

http.Response _json(Object body, [int status = 200]) => http.Response.bytes(
  utf8.encode(jsonEncode(body)),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

/// GPS fixes every ~12 m along the route geometry (about 43 km/h at 1 Hz).
Iterable<GeoPoint> _track(MapRoute route) sync* {
  for (var i = 1; i < route.points.length; i++) {
    final a = route.points[i - 1];
    final b = route.points[i];
    final steps = (metersBetween(a, b) / 12).ceil().clamp(1, 100000);
    for (var k = 0; k < steps; k++) {
      yield GeoPoint(
        a.lat + (b.lat - a.lat) * k / steps,
        a.lon + (b.lon - a.lon) * k / steps,
      );
    }
  }
  yield route.points.last;
}

MapsConfig _config({MapsFeatures features = const MapsFeatures()}) =>
    MapsConfig(
      environment: MapsEnvironment.dev,
      searchUrl: 'https://search.test',
      routingUrl: 'https://routing.test',
      tileUrl: 'https://tiles.test/k.pmtiles',
      webUrl: 'https://web.test',
      features: features,
    );

class _FakeLocation implements LocationSource {
  final fixes = StreamController<LocationFix>.broadcast();
  GpsAccess grant = GpsAccess.ok;

  @override
  Future<GpsAccess> access() async => grant;

  @override
  Future<LocationFix?> current({
    Duration timeout = const Duration(seconds: 12),
  }) async => null;

  @override
  Stream<LocationFix> watch({
    required MapsStrings strings,
    bool navigation = false,
    bool vehicle = true,
    bool notification = true,
  }) => fixes.stream;
}

class _FakeVoice implements VoiceGuide {
  final spoken = <String>[];

  @override
  Future<bool> speak(
    String language,
    String text,
    bool Function() active,
  ) async {
    spoken.add(text);
    return true;
  }

  @override
  Future<void> stop() async {}
}

void main() {
  group('configuration', () {
    test('rejects non-HTTPS, credentialed and unknown-language setups', () {
      expect(
        () => MapsConfig(
          environment: MapsEnvironment.dev,
          searchUrl: 'http://search.test',
          routingUrl: 'https://routing.test',
          tileUrl: 'https://t.test/x.pmtiles',
          webUrl: 'https://web.test',
        ),
        throwsFormatException,
      );
      expect(
        () => MapsConfig(
          environment: MapsEnvironment.dev,
          searchUrl: 'https://u:p@search.test',
          routingUrl: 'https://routing.test',
          tileUrl: 'https://t.test/x.pmtiles',
          webUrl: 'https://web.test',
        ),
        throwsFormatException,
      );
      expect(() => _config().copyWith(language: 'de'), throwsArgumentError);
    });

    test('copyWith keeps URLs and switches features and language', () {
      final changed = _config().copyWith(
        features: const MapsFeatures.none(),
        language: 'kk',
      );
      expect(changed.routingUrl, 'https://routing.test');
      expect(changed.features.routing, isFalse);
      expect(changed.language, 'kk');
    });
  });

  group('localisation', () {
    test('every label exists in RU, KK and EN and is non-empty', () {
      for (final lang in ['ru', 'kk', 'en']) {
        final s = MapsStrings(lang);
        for (final key in [
          'arrived',
          'in',
          'straight',
          'right',
          'left',
          'uturn',
          'roundabout',
          'exit',
          'search',
          'noResults',
          'myLocation',
          'confirm',
          'gpsOff',
          'gpsDenied',
          'distance',
          'duration',
          'arrival',
          'typicalTime',
        ]) {
          expect(s(key), isNot(key), reason: '$lang/$key');
          expect(s(key).trim(), isNotEmpty);
        }
        for (final code in [
          'timeout',
          'rate',
          'access',
          'service',
          'routeNotFound',
          'routeNoRoad',
          'routeCoverage',
          'routeTooClose',
          'routeTooLong',
          'disabled',
          'routePayload',
        ]) {
          expect(
            s.error(code),
            isNot(startsWith('err')),
            reason: '$lang/$code',
          );
        }
      }
      expect(const MapsStrings('ru')('arrived'), 'Вы прибыли');
      expect(const MapsStrings('kk')('arrived'), 'Межелі жерге жеттіңіз');
    });
  });

  group('geo and eta', () {
    test('GeoPoint.parse rejects invalid coordinates', () {
      for (final bad in [
        [91, 0],
        [0, 181],
        [double.nan, 0],
        [double.infinity, 0],
        ['43', 76],
        [null, 76],
      ]) {
        expect(() => GeoPoint.parse(bad[0], bad[1]), throwsFormatException);
      }
      expect(GeoPoint.parse(43.2, 76.9).query, '43.200000,76.900000');
    });

    test('coarsen rounds to about 100 m for privacy', () {
      final c = coarsen(const GeoPoint(43.238194, 76.94498));
      expect(c.lat, 43.238);
      expect(c.lon, 76.945);
    });

    test('Kazakhstan coverage', () {
      expect(inKazakhstan(const GeoPoint(43.2, 76.9)), isTrue);
      expect(inKazakhstan(const GeoPoint(55.75, 37.6)), isFalse);
    });

    test(
      'ETA adds the duration and never reports 0 minutes while time remains',
      () {
        final now = DateTime(2026, 1, 1, 10, 0);
        final eta = Eta.fromSeconds(207, now: now);
        expect(eta.minutes, 4);
        expect(eta.clock, '10:03');
        expect(Eta.fromSeconds(5, now: now).minutes, 1);
        expect(Eta.fromSeconds(0, now: now).minutes, 0);
        expect(() => Eta.fromSeconds(double.nan), throwsArgumentError);
        expect(() => Eta.fromSeconds(-1), throwsArgumentError);
      },
    );
  });

  group('services over the Maps API', () {
    MapsClient clientFor(
      Future<http.Response> Function(http.Request) handler, {
      MapsFeatures features = const MapsFeatures(),
    }) => MapsClient(
      _config(features: features),
      MockClient(handler),
      sleep: (_) async {},
    );

    test(
      'Routing builds the documented request and parses real geometry',
      () async {
        late Uri seen;
        final routing = Routing(
          clientFor((request) async {
            seen = request.url;
            return _json(_fixture);
          }),
        );
        final preview = await routing.preview(
          const GeoPoint(43.238194, 76.94498),
          const GeoPoint(43.25, 76.93),
          language: 'kk',
        );
        expect(seen.host, 'routing.test');
        expect(seen.path, '/v1/route');
        expect(seen.queryParameters['mode'], 'car');
        expect(seen.queryParameters['lang'], 'kk');
        expect(seen.queryParameters['from'], '43.238194,76.944980');
        expect(preview.distanceMeters, greaterThan(0));
        expect(preview.trafficAware, isFalse);
        expect(
          preview.eta(DateTime(2026)).arrival.isAfter(DateTime(2026)),
          isTrue,
        );
      },
    );

    test('disabled features throw before any request is made', () async {
      var calls = 0;
      final off = clientFor((_) async {
        calls++;
        return http.Response('{}', 200);
      }, features: const MapsFeatures.none());
      await expectLater(
        Routing(
          off,
        ).routes(const GeoPoint(43.2, 76.9), const GeoPoint(43.3, 76.9)),
        throwsA(
          isA<MapsException>().having(
            (e) => e.kind,
            'kind',
            MapsErrorKind.disabled,
          ),
        ),
      );
      await expectLater(
        PlaceSearch(off).search('abc', const GeoPoint(43.2, 76.9)),
        throwsA(isA<MapsException>()),
      );
      expect(calls, 0);
    });

    test('HTTP failures map to stable kinds and honour Retry-After', () async {
      Future<MapsException> failure(
        int status, {
        Map<String, String>? headers,
        String body = '{}',
      }) async {
        final api = clientFor(
          (_) async => http.Response(body, status, headers: headers ?? {}),
        );
        try {
          await PlaceSearch(api).search('abc', const GeoPoint(43.2, 76.9));
        } on MapsException catch (e) {
          return e;
        }
        fail('expected failure');
      }

      expect(
        (await failure(429, headers: {'retry-after': '7'})).kind,
        MapsErrorKind.rateLimited,
      );
      expect(
        (await failure(429, headers: {'retry-after': '7'})).retryAfter,
        const Duration(seconds: 7),
      );
      expect((await failure(401)).kind, MapsErrorKind.accessDenied);
      expect((await failure(502)).transient, isTrue);
      expect((await failure(500)).kind, MapsErrorKind.unavailable);
    });

    test('route 404 no_route is reported as routeNotFound', () async {
      final api = clientFor((_) async => _json({'error': 'no_route'}, 404));
      await expectLater(
        Routing(
          api,
        ).routes(const GeoPoint(43.2, 76.9), const GeoPoint(43.3, 76.9)),
        throwsA(
          isA<MapsException>().having(
            (e) => e.kind,
            'kind',
            MapsErrorKind.routeNotFound,
          ),
        ),
      );
    });

    test('a cold server (503 then 200) is retried transparently', () async {
      var calls = 0;
      final api = clientFor((_) async {
        calls++;
        return calls == 1 ? http.Response('{}', 503) : _json(_fixture);
      });
      final routes = await Routing(api).routes(
        const GeoPoint(43.238194, 76.94498),
        const GeoPoint(43.25, 76.93),
      );
      expect(routes, isNotEmpty);
      expect(calls, 2);
    });

    test('offline is a network failure, not a crash', () async {
      final api = clientFor((_) async => throw http.ClientException('offline'));
      await expectLater(
        PlaceSearch(api).search('abc', const GeoPoint(43.2, 76.9)),
        throwsA(
          isA<MapsException>().having(
            (e) => e.kind,
            'kind',
            MapsErrorKind.network,
          ),
        ),
      );
    });

    test('search sends the language and a coarse centre', () async {
      late Uri seen;
      final api = clientFor((request) async {
        seen = request.url;
        return http.Response(jsonEncode({'results': <Object>[]}), 200);
      });
      await PlaceSearch(
        api,
      ).search('Абая', const GeoPoint(43.238194, 76.94498), language: 'en');
      expect(seen.queryParameters['lang'], 'en');
      expect(seen.queryParameters['lat'], '43.238');
      expect(seen.queryParameters['lon'], '76.945');
    });
  });

  group('NavigationController', () {
    late MapRoute route;
    setUp(() => route = MapRoute(_fixture));

    NavigationController controller(
      _FakeLocation gps,
      _FakeVoice voice,
      MapsClient client, {
      DateTime Function() clock = DateTime.now,
    }) => NavigationController(
      client: client,
      strings: const MapsStrings('en'),
      mode: 'car',
      destination: route.points.last,
      route: route,
      location: gps,
      voiceGuide: voice,
      clock: clock,
    );

    MapsClient noNetwork() => MapsClient(
      _config(),
      MockClient((_) async => http.Response('{}', 503)),
      sleep: (_) async {},
    );

    test('refuses to start without location access', () async {
      final gps = _FakeLocation()..grant = GpsAccess.deniedForever;
      final nav = controller(gps, _FakeVoice(), noNetwork());
      expect(await nav.start(), isFalse);
      expect(nav.active, isFalse);
      expect(gps.fixes.hasListener, isFalse);
      nav.dispose();
    });

    test('follows the route, speaks, arrives and releases GPS', () async {
      final gps = _FakeLocation();
      final voice = _FakeVoice();
      var t = DateTime.now();
      final nav = controller(gps, voice, noNetwork(), clock: () => t);
      expect(await nav.start(), isTrue);
      // Replay the route geometry as GPS fixes, 1 s apart, ending at the destination.
      for (final point in _track(route)) {
        t = t.add(const Duration(seconds: 1));
        gps.fixes.add(LocationFix(point, 8, t));
        await Future<void>.delayed(Duration.zero);
        if (nav.arrived) break;
      }
      for (var i = 0; i < 3 && !nav.arrived; i++) {
        t = t.add(const Duration(seconds: 1));
        gps.fixes.add(LocationFix(route.points.last, 8, t));
        await Future<void>.delayed(Duration.zero);
      }
      expect(nav.arrived, isTrue);
      expect(nav.active, isFalse);
      expect(voice.spoken, contains('You have arrived'));
      expect(gps.fixes.hasListener, isFalse);
      nav.dispose();
    });

    test(
      'leaving the route triggers a reroute request from the current position',
      () async {
        final gps = _FakeLocation();
        final requests = <Uri>[];
        final client = MapsClient(
          _config(),
          MockClient((request) async {
            requests.add(request.url);
            return _json(_fixture);
          }),
          sleep: (_) async {},
        );
        final nav = controller(gps, _FakeVoice(), client)..voice = false;
        expect(await nav.start(), isTrue);
        final astray = GeoPoint(
          route.points.first.lat + .003,
          route.points.first.lon + .003,
        );
        var t = DateTime.now();
        for (var i = 0; i < 4; i++) {
          t = t.add(const Duration(seconds: 1));
          gps.fixes.add(LocationFix(astray, 8, t));
          await Future<void>.delayed(Duration.zero);
        }
        await Future<void>.delayed(const Duration(milliseconds: 50));
        expect(requests, isNotEmpty);
        expect(requests.first.queryParameters['from'], astray.query);
        expect(requests.first.queryParameters['to'], route.points.last.query);
        nav.dispose();
      },
    );
  });

  group('widgets', () {
    testWidgets(
      'RoutePreview shows distance, time, arrival and the no-traffic note, no price',
      (tester) async {
        final data = RoutePreviewData([MapRoute(_fixture)]);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: RoutePreview(
                data: data,
                language: 'en',
                now: DateTime(2026, 1, 1, 9, 0),
              ),
            ),
          ),
        );
        expect(find.text('Distance'), findsOneWidget);
        expect(find.text('Arrival'), findsOneWidget);
        expect(find.text('Typical time, traffic not included'), findsOneWidget);
        expect(find.textContaining('KZT'), findsNothing);
        expect(find.textContaining('₸'), findsNothing);
      },
    );

    testWidgets(
      'PlaceSearchField debounces, cancels stale queries and reports errors',
      (tester) async {
        final queries = <String>[];
        final api = MapsClient(
          _config(),
          MockClient((request) async {
            final q = request.url.queryParameters['q']!;
            queries.add(q);
            if (q == 'fail') {
              return http.Response('{}', 429, headers: {'retry-after': '3'});
            }
            return http.Response(
              jsonEncode({
                'results': [
                  {
                    'id': 1,
                    'name': 'Abay 10',
                    'lat': 43.2,
                    'lon': 76.9,
                    'kind': 'address',
                  },
                ],
              }),
              200,
            );
          }),
          sleep: (_) async {},
        );
        MapPlace? picked;
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: PlaceSearchField(
                search: PlaceSearch(api),
                language: 'en',
                center: () => const GeoPoint(43.2, 76.9),
                onSelected: (p) => picked = p,
              ),
            ),
          ),
        );
        await tester.enterText(find.byType(TextField), 'ab');
        await tester.pump(const Duration(milliseconds: 100));
        await tester.enterText(find.byType(TextField), 'abay');
        await tester.pump(const Duration(milliseconds: 400));
        await tester.pumpAndSettle();
        expect(queries, [
          'abay',
        ], reason: 'only the last debounced query is sent');
        await tester.tap(find.text('Abay 10'));
        expect(picked?.point.lat, 43.2);

        await tester.enterText(find.byType(TextField), 'fail');
        await tester.pump(const Duration(milliseconds: 400));
        await tester.pumpAndSettle();
        expect(
          find.text('Too many requests. Try again in a minute.'),
          findsOneWidget,
        );
      },
    );
  });
}
