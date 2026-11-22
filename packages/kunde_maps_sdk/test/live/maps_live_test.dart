@Tags(['live'])
library;

// Real network checks against the deployed Maps Platform (DEV). Nothing is
// mocked: the real search index, the real Valhalla engine and the real HTTP
// stack. Run with:
//   flutter test --tags live test/live
// The first request may take up to a minute while a free-tier instance wakes
// up; the SDK retries transient failures itself.

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:kunde_maps_sdk/kunde_maps_sdk.dart';

const _almaty = GeoPoint(43.238, 76.945);

void main() {
  final config = MapsConfig.fromEnvironment();
  late http.Client http_;
  late MapsClient client;
  setUp(() {
    http_ = http.Client();
    client = MapsClient(config, http_);
  });
  tearDown(() => http_.close());

  test(
    'address search -> choose -> route preview (cold start tolerated)',
    () async {
      final search = PlaceSearch(client);
      final routing = Routing(client);
      await routing.warmUp();
      final found = await search.search('улица Абая 10', _almaty);
      expect(found, isNotEmpty);
      for (final place in found) {
        expect(inKazakhstan(place.point), isTrue);
      }
      // Pick the nearest result to the city centre so the route stays in town.
      final target =
          (found..sort(
                (a, b) => metersBetween(
                  a.point,
                  _almaty,
                ).compareTo(metersBetween(b.point, _almaty)),
              ))
              .first;
      final preview = await routing.preview(
        _almaty,
        target.point,
        language: 'ru',
        onSlow: () {},
      );
      expect(preview.distanceMeters, greaterThan(0));
      expect(preview.durationSeconds, greaterThan(0));
      expect(preview.route.points.length, greaterThan(1));
      expect(preview.trafficAware, isFalse);
      expect(preview.route.steps, isNotEmpty);
    },
    timeout: const Timeout(Duration(minutes: 3)),
  );

  test('GPS point -> destination in all three languages', () async {
    final routing = Routing(client);
    const destination = GeoPoint(43.2565, 76.9285);
    for (final lang in ['ru', 'kk', 'en']) {
      final routes = await routing.routes(_almaty, destination, language: lang);
      expect(routes.first.meters, greaterThan(500), reason: lang);
    }
  }, timeout: const Timeout(Duration(minutes: 3)));

  test('nearby places return real data with distances', () async {
    final places = await PlaceSearch(client).nearby(_almaty, category: 'cafe');
    expect(places, isNotEmpty);
    expect(places.first.data['distance_m'], isA<num>());
  });

  test('points outside Kazakhstan are rejected by the real API', () async {
    await expectLater(
      Routing(client).routes(const GeoPoint(55.75, 37.62), _almaty),
      throwsA(
        isA<MapsException>().having(
          (e) => e.kind,
          'kind',
          anyOf(
            MapsErrorKind.routeOutsideCoverage,
            MapsErrorKind.invalidResponse,
          ),
        ),
      ),
    );
  });

  test('an unreachable host is a network failure, not a hang', () async {
    final offline = MapsClient(
      MapsConfig(
        environment: MapsEnvironment.dev,
        searchUrl: 'https://search.kunde-maps-offline.invalid',
        routingUrl: 'https://routing.kunde-maps-offline.invalid',
        tileUrl: 'https://tiles.kunde-maps-offline.invalid/k.pmtiles',
        webUrl: 'https://web.kunde-maps-offline.invalid',
      ),
      http_,
      sleep: (_) async {},
    );
    await expectLater(
      PlaceSearch(offline).search('abc', _almaty),
      throwsA(
        isA<MapsException>().having(
          (e) => e.kind,
          'kind',
          MapsErrorKind.network,
        ),
      ),
    );
  });
}
