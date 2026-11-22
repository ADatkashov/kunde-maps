import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

const webUrl = String.fromEnvironment(
  'KUNDE_WEB_URL',
  defaultValue: 'https://kunde-maps-web-dev.onrender.com',
);
const searchUrl = String.fromEnvironment(
  'KUNDE_SEARCH_URL',
  defaultValue: 'https://kunde-maps-search-dev.onrender.com',
);
const routingUrl = String.fromEnvironment(
  'KUNDE_ROUTING_URL',
  defaultValue: 'https://kunde-maps-routing-dev.onrender.com',
);
const tileUrl = String.fromEnvironment(
  'KUNDE_TILE_URL',
  defaultValue:
      'https://pub-237f2a01acb04791aad25708c16f3d8a.r2.dev/kazakhstan.pmtiles',
);

Uri secureUrl(String value) {
  final uri = Uri.parse(value);
  if (uri.scheme != 'https' || uri.host.isEmpty || uri.userInfo.isNotEmpty) {
    throw const FormatException('HTTPS URL required');
  }
  return uri;
}

typedef Json = Map<String, dynamic>;

class Point {
  const Point(this.lat, this.lon);

  factory Point.parse(Object? lat, Object? lon) {
    if (lat is! num ||
        lon is! num ||
        !lat.isFinite ||
        !lon.isFinite ||
        lat.abs() > 90 ||
        lon.abs() > 180) {
      throw const FormatException('Invalid coordinates');
    }
    return Point(lat.toDouble(), lon.toDouble());
  }

  final double lat;
  final double lon;

  String get query => '${lat.toStringAsFixed(6)},${lon.toStringAsFixed(6)}';
}

class Place {
  Place(this.data) : point = Point.parse(data['lat'], data['lon']);

  final Json data;
  final Point point;

  String? get osmId {
    final value = data['place_id'] ?? data['id'];
    return value is String && RegExp(r'^[nwr][0-9]+$').hasMatch(value)
        ? value
        : null;
  }

  String get key => osmId ?? '${point.query}:${data['id']}';

  String name(String lang, String fallback) {
    for (final key in ['name_$lang', 'name']) {
      final value = data[key];
      if (value is String && value.trim().isNotEmpty) return value;
    }
    return fallback;
  }
}

class Maneuver {
  Maneuver(Json data)
    : point = Point.parse(
        (data['location'] as List)[1],
        (data['location'] as List)[0],
      ),
      instruction = data['instruction'] as String,
      street = data['street'] as String?,
      type = data['type'] as int,
      seconds = (data['duration_s'] as num).toDouble();

  final Point point;
  final String instruction;
  final String? street;
  final int type;
  final double seconds;
}

class RoadRoute {
  RoadRoute(Json data)
    : meters = (data['distance_m'] as num).toDouble(),
      seconds = (data['duration_s'] as num).toDouble(),
      language = data['instruction_language'] as String? ?? 'ru',
      points = ((data['geometry'] as Json)['coordinates'] as List)
          .map((p) => Point.parse(p[1], p[0]))
          .toList(growable: false),
      steps = (data['steps'] as List)
          .map((step) => Maneuver(step as Json))
          .toList(growable: false) {
    if (points.length < 2 ||
        !meters.isFinite ||
        !seconds.isFinite ||
        meters <= 0 ||
        seconds < 0) {
      throw const FormatException('Invalid route');
    }
  }

  final double meters;
  final double seconds;
  final String language;
  final List<Point> points;
  final List<Maneuver> steps;
}

class ApiFailure implements Exception {
  const ApiFailure(this.code, [this.retryAfter]);
  final String code;
  final Duration? retryAfter;
}

class PlatformApi {
  PlatformApi(this.client);
  final http.Client client;

  Future<Json> get(Uri url, {Future<void>? abort}) async {
    final deadline = Completer<void>();
    final request =
        http.AbortableRequest(
            'GET',
            url,
            abortTrigger: abort == null
                ? deadline.future
                : Future.any([abort, deadline.future]),
          )
          ..followRedirects = false
          ..headers['Accept'] = 'application/json';
    try {
      final response = await client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(
            const Duration(seconds: 35),
            onTimeout: () {
              deadline.complete();
              throw const ApiFailure('timeout');
            },
          );
      if (response.statusCode != 200) {
        final wait = int.tryParse(response.headers['retry-after'] ?? '');
        if (url.path == '/v1/route' &&
            (response.statusCode == 400 || response.statusCode == 404)) {
          final code = _routeError(response.bodyBytes);
          if (code != null) throw ApiFailure(code);
        }
        throw ApiFailure(switch (response.statusCode) {
          429 => 'rate',
          401 || 403 => 'access',
          404 => 'missing',
          >= 500 => 'service',
          _ => 'invalid',
        }, wait == null ? null : Duration(seconds: wait.clamp(0, 600)));
      }
      return jsonDecode(utf8.decode(response.bodyBytes)) as Json;
    } on TimeoutException {
      throw const ApiFailure('timeout');
    } on http.RequestAbortedException {
      rethrow;
    } on http.ClientException {
      throw const ApiFailure('network');
    } on FormatException {
      throw const ApiFailure('invalid');
    } on TypeError {
      throw const ApiFailure('invalid');
    }
  }

  String? _routeError(List<int> bytes) {
    try {
      final body = jsonDecode(utf8.decode(bytes));
      final code = body is Json ? body['error'] : null;
      return switch (code) {
        'no_route' => 'routeNotFound',
        'no_road_near_point' => 'routeNoRoad',
        'outside_coverage' => 'routeCoverage',
        'points_too_close' => 'routeTooClose',
        'route_too_long' => 'routeTooLong',
        _ => null,
      };
    } on FormatException {
      return null;
    }
  }

  Uri endpoint(String base, String path, [Map<String, String>? query]) =>
      secureUrl(base).resolve(path).replace(queryParameters: query);

  Future<List<Place>> search(
    String query,
    String language,
    Point center,
    Future<void> abort,
  ) async {
    final payload = await get(
      endpoint(searchUrl, '/v1/search', {
        'q': query,
        'lang': language,
        'lat': center.lat.toStringAsFixed(3),
        'lon': center.lon.toStringAsFixed(3),
      }),
      abort: abort,
    );
    return placesFrom(payload['results']);
  }

  Future<List<String>> categories() async {
    final payload = await get(endpoint(searchUrl, '/v1/categories'));
    return (payload['categories'] as List)
        .map((c) => c['id'] as String)
        .toList();
  }

  Future<Place> details(String id) async {
    final payload = await get(endpoint(searchUrl, '/v1/places/$id'));
    return Place(payload['place'] as Json);
  }

  Future<List<Place>> nearby(Point center, String? category) async {
    final payload = await get(
      endpoint(searchUrl, '/v1/places', {
        'lat': center.lat.toStringAsFixed(3),
        'lon': center.lon.toStringAsFixed(3),
        'radius': '4000',
        'limit': '45',
        'category': ?category,
      }),
    );
    return placesFrom(payload['places']);
  }

  Future<List<RoadRoute>> route(
    Point origin,
    Point destination,
    String mode,
    String language, {
    bool alternatives = false,
    Future<void>? abort,
  }) async {
    final payload = await get(
      endpoint(routingUrl, '/v1/route', {
        'from': origin.query,
        'to': destination.query,
        'mode': mode,
        'lang': language,
        if (alternatives) 'alternatives': '1',
      }),
      abort: abort,
    );
    final routes = <RoadRoute>[];
    try {
      routes.add(RoadRoute(payload));
    } on Object catch (error) {
      if (error is! FormatException &&
          error is! TypeError &&
          error is! RangeError) {
        rethrow;
      }
      throw const ApiFailure('routePayload');
    }
    final options = payload['alternatives'];
    if (options is List) {
      for (final item in options.whereType<Json>()) {
        try {
          routes.add(
            RoadRoute({
              ...item,
              'instruction_language':
                  item['instruction_language'] ??
                  payload['instruction_language'],
            }),
          );
        } on Object catch (error) {
          if (error is! FormatException &&
              error is! TypeError &&
              error is! RangeError) {
            rethrow;
          }
        }
      }
    }
    return routes;
  }

  static List<Place> placesFrom(Object? values) =>
      (values as List).map((p) => Place(p as Json)).toList();
}
