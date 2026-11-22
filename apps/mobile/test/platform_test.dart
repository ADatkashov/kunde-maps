import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:maps/core/platform_api.dart';
import 'package:maps/features/map_style.dart';
import 'package:maps/core/progress.dart';
import 'package:maps/core/strings.dart';

void main() {
  late Json fixture;
  setUpAll(() {
    fixture = jsonDecode(
      File('../web/test/fixtures/route-almaty-car.json').readAsStringSync(),
    ) as Json;
  });

  test(
    'Valhalla longitude first fixture parses and projects the actual start',
    () {
      final route = RoadRoute(fixture);
      expect(route.points.first.lat, 43.238194);
      expect(route.steps.first.point.lon, 76.94498);
      final progress = RouteProgress(route, 'car');
      final now = DateTime.utc(2026);
      expect(progress.update(route.points.first, 8, now, now), isTrue);
      expect(progress.remainingMeters, closeTo(route.meters, 1));
      expect(progress.remainingSeconds, closeTo(route.seconds, 1));
      expect(progress.nextStep, 1);
    },
  );

  test(
    'poor fixes do not advance and two good terminal fixes confirm arrival',
    () {
      final road = RoadRoute({
        'distance_m': 111,
        'duration_s': 60,
        'geometry': {
          'coordinates': [
            [76.94, 43.238],
            [76.94, 43.239],
          ],
        },
        'steps': <Json>[],
      });
      final progress = RouteProgress(road, 'foot');
      final now = DateTime.utc(2026);
      expect(progress.update(road.points.last, 90, now, now), isFalse);
      expect(progress.remainingMeters, 111);
      expect(progress.update(road.points.last, 8, now, now), isTrue);
      expect(progress.arrived, isFalse);
      final later = now.add(const Duration(seconds: 1));
      expect(progress.update(road.points.last, 8, later, later), isTrue);
      expect(progress.arrived, isTrue);
      expect(progress.remainingSeconds, closeTo(0, .001));
    },
  );

  test('deviation requires three reliable fixes over two seconds', () {
    final progress = RouteProgress(RoadRoute(fixture), 'car');
    final now = DateTime.utc(2026);
    for (var i = 0; i < 3; i++) {
      final time = now.add(Duration(seconds: i));
      expect(
        progress.update(const Point(43.239, 76.94), 5, time, time),
        isTrue,
      );
      expect(progress.offRoute, i == 2);
    }
  });

  test('search uses language, proximity, HTTPS and no API key', () async {
    final api = PlatformApi(
      MockClient((request) async {
        expect(request.url.scheme, 'https');
        expect(request.url.path, '/v1/search');
        expect(request.url.queryParameters['lang'], 'kk');
        expect(request.url.queryParameters['q'], 'Абай');
        expect(request.url.queryParameters['lat'], '43.238');
        expect(request.headers.containsKey('X-API-Key'), isFalse);
        return http.Response(
          jsonEncode({
            'results': [
              {'id': 1, 'lat': 43.238, 'lon': 76.945, 'name_kk': 'Абай'},
            ],
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    final places = await api.search(
      'Абай',
      'kk',
      const Point(43.2381, 76.945),
      Completer<void>().future,
    );
    expect(places.single.name('kk', ''), 'Абай');
  });

  test('route coordinates match the web contract and invalid alternatives are skipped', () async {
    final api = PlatformApi(
      MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/v1/route');
        expect(request.url.queryParameters, {
          'from': '43.238194,76.944980',
          'to': '43.255500,76.955326',
          'mode': 'car',
          'lang': 'en',
          'alternatives': '1',
        });
        expect(request.headers['Accept'], 'application/json');
        expect(request.headers.containsKey('Authorization'), isFalse);
        return http.Response(
          jsonEncode({
            ...fixture,
            'instruction_language': 'en',
            'alternatives': [
              null,
              {'distance_m': 1},
              {...fixture, 'distance_m': 3000},
            ],
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    final routes = await api.route(
      const Point(43.238194, 76.94498),
      const Point(43.2555, 76.955326),
      'car',
      'en',
      alternatives: true,
    );
    expect(routes, hasLength(2));
    expect(routes.last.language, 'en');
    expect(routes.first.points.first.lat, 43.238194);
    expect(routes.first.points.first.lon, 76.94498);
  });

  test('route service detail is allowlisted for localized feedback', () async {
    final api = PlatformApi(
      MockClient(
        (request) async => http.Response('{"error":"no_road_near_point"}', 404),
      ),
    );
    await expectLater(
      api.route(
        const Point(43.238194, 76.94498),
        const Point(43.2555, 76.955326),
        'car',
        'en',
      ),
      throwsA(
        isA<ApiFailure>().having((error) => error.code, 'code', 'routeNoRoad'),
      ),
    );
  });

  test('places preserve stable IDs and rate-limit delay is surfaced', () async {
    final api = PlatformApi(
      MockClient((request) async {
        if (request.url.path == '/v1/places/n123') {
          return http.Response(
            '{"place":{"id":"n123","lat":43,"lon":76,"category":"cafe"}}',
            200,
          );
        }
        return http.Response(
          '{"error":"rate_limited"}',
          429,
          headers: {'retry-after': '25'},
        );
      }),
    );
    expect((await api.details('n123')).osmId, 'n123');
    await expectLater(
      api.nearby(const Point(43, 76), 'cafe'),
      throwsA(
        isA<ApiFailure>().having(
          (e) => e.retryAfter,
          'retry-after',
          const Duration(seconds: 25),
        ),
      ),
    );
  });

  const from = Point(43.238194, 76.94498);
  const to = Point(43.2555, 76.955326);
  Future<void> noWait(Duration _) async {}
  http.Response ok() => http.Response.bytes(
    utf8.encode(jsonEncode(fixture)),
    200,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );

  test(
    'transient 503 during server wake-up is retried and then succeeds',
    () async {
      var calls = 0;
      var slow = 0;
      final api = PlatformApi(
        MockClient((request) async {
          calls++;
          expect(request.headers['X-Request-ID'], isNotEmpty);
          return calls < 3 ? http.Response('waking', 503) : ok();
        }),
        sleep: noWait,
      );
      final routes = await api.route(
        from,
        to,
        'car',
        'ru',
        onSlow: () => slow++,
      );
      expect(calls, 3);
      expect(slow, greaterThan(0));
      expect(routes.first.meters, greaterThan(0));
    },
  );

  test('retries stop after the budget and report the HTTP status', () async {
    var calls = 0;
    final api = PlatformApi(
      MockClient((request) async {
        calls++;
        return http.Response('bad gateway', 502);
      }),
      sleep: noWait,
    );
    await expectLater(
      api.route(from, to, 'car', 'ru'),
      throwsA(
        isA<ApiFailure>()
            .having((e) => e.code, 'code', 'service')
            .having((e) => e.status, 'status', 502),
      ),
    );
    expect(calls, 3);
  });

  test('definite answers such as 400 are not retried', () async {
    var calls = 0;
    final api = PlatformApi(
      MockClient((request) async {
        calls++;
        return http.Response('{"error":"outside_coverage"}', 400);
      }),
      sleep: noWait,
    );
    await expectLater(
      api.route(from, to, 'car', 'ru'),
      throwsA(isA<ApiFailure>().having((e) => e.code, 'code', 'routeCoverage')),
    );
    expect(calls, 1);
  });

  test('network timeout is retried and then surfaced, never hangs', () async {
    var calls = 0;
    final api = PlatformApi(
      MockClient((request) async {
        calls++;
        await Future<void>.delayed(const Duration(seconds: 5));
        return ok();
      }),
      sleep: noWait,
      timeout: const Duration(milliseconds: 50),
    );
    await expectLater(
      api.route(from, to, 'car', 'ru'),
      throwsA(isA<ApiFailure>().having((e) => e.code, 'code', 'timeout')),
    );
    expect(calls, 3);
  });

  test('dropped connection maps to a network failure after retries', () async {
    final api = PlatformApi(
      MockClient((request) async => throw http.ClientException('reset')),
      sleep: noWait,
    );
    await expectLater(
      api.route(from, to, 'car', 'ru'),
      throwsA(isA<ApiFailure>().having((e) => e.code, 'code', 'network')),
    );
  });

  test(
    'invalid, empty and swapped route payloads are rejected loudly',
    () async {
      Future<void> expectPayload(Object body, String code) async {
        final api = PlatformApi(
          MockClient(
            (request) async =>
                http.Response.bytes(utf8.encode(jsonEncode(body)), 200),
          ),
          sleep: noWait,
        );
        await expectLater(
          api.route(from, to, 'car', 'ru'),
          throwsA(isA<ApiFailure>().having((e) => e.code, 'code', code)),
          reason: code,
        );
      }

      await expectPayload({
        ...fixture,
        'geometry': {'type': 'LineString', 'coordinates': <Object>[]},
      }, 'routePayload');
      await expectPayload({
        ...fixture,
        'geometry': {
          'type': 'LineString',
          'coordinates': [
            for (final c
                in (fixture['geometry'] as Json)['coordinates'] as List)
              [(c as List)[1], c[0]],
          ],
        },
      }, 'routePayload');
      await expectPayload({...fixture, 'distance_m': 0}, 'routePayload');
      await expectPayload({...fixture, 'duration_s': 0}, 'routePayload');
      await expectPayload(<String, Object>{}, 'routePayload');
      final html = PlatformApi(
        MockClient((request) async => http.Response('<html>', 200)),
        sleep: noWait,
      );
      await expectLater(
        html.route(from, to, 'car', 'ru'),
        throwsA(isA<ApiFailure>().having((e) => e.code, 'code', 'invalid')),
      );
    },
  );

  test('route GeoJSON is longitude first and marks only the selected line', () {
    final first = RoadRoute(fixture);
    final second = RoadRoute(fixture);
    final geo = routeFeatures([first, second], second);
    final features = geo['features'] as List;
    expect(geo['type'], 'FeatureCollection');
    expect(features, hasLength(2));
    expect((features[0] as Json)['properties'], {'selected': false});
    expect((features[1] as Json)['properties'], {'selected': true});
    final line = (features[1] as Json)['geometry'] as Json;
    expect(line['type'], 'LineString');
    final coordinates = line['coordinates'] as List;
    expect(coordinates.length, first.points.length);
    expect(coordinates.first, [first.points.first.lon, first.points.first.lat]);
    for (final c in coordinates) {
      expect((c as List)[0], inInclusiveRange(46, 88)); // longitude
      expect(c[1], inInclusiveRange(40, 56)); // latitude
    }
    expect((routeFeatures(const [], null)['features'] as List), isEmpty);
  });

  test(
    'settings and navigation translations are populated for all languages',
    () {
      for (final pair in labels.entries) {
        expect(pair.value, hasLength(3), reason: pair.key);
        expect(pair.value.every((text) => text.isNotEmpty), isTrue);
      }
      expect(const Words('kk')('search'), 'Іздеу');
      expect(const Words('ru')('nav'), 'Навигатор');
      expect(const Words('en')('start'), 'Start navigation');
    },
  );
}
