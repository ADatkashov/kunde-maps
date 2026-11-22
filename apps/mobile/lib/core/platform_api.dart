import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'diagnostics.dart';

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
        seconds <= 0) {
      throw const FormatException('Invalid route');
    }
    // GeoJSON is [longitude, latitude]. A swapped pair lands outside
    // Kazakhstan (latitude 40-56 cannot be a longitude here), so reject it
    // instead of drawing a line in the wrong hemisphere.
    for (final p in points) {
      if (!inKazakhstan(p)) {
        throw const FormatException('Route outside Kazakhstan');
      }
    }
  }

  final double meters;
  final double seconds;
  final String language;
  final List<Point> points;
  final List<Maneuver> steps;
}

/// Kazakhstan bounding box (min lon 46.4, min lat 40.5, max lon 87.4, max lat 55.6),
/// the same coverage the routing API enforces.
bool inKazakhstan(Point p) =>
    p.lon >= 46.0 && p.lon <= 88.0 && p.lat >= 40.0 && p.lat <= 56.0;

class ApiFailure implements Exception {
  const ApiFailure(this.code, [this.retryAfter, this.status]);
  final String code;
  final Duration? retryAfter;
  final int? status;

  /// Temporary conditions that a free-tier server wake-up or a mobile network
  /// handover produce; a repeat request usually succeeds.
  bool get transient =>
      code == 'timeout' ||
      code == 'network' ||
      status == 502 ||
      status == 503 ||
      status == 504;

  @override
  String toString() => 'ApiFailure($code, status: $status)';
}

String newRequestId() {
  final random = math.Random.secure();
  return '${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-'
      '${random.nextInt(1 << 31).toRadixString(36)}';
}

class PlatformApi {
  PlatformApi(
    this.client, {
    this.sleep = _sleep,
    this.timeout = const Duration(seconds: 35),
  });
  final http.Client client;
  final Future<void> Function(Duration) sleep;
  final Duration timeout;

  static Future<void> _sleep(Duration d) => Future<void>.delayed(d);

  /// One logical request: up to [retries] extra attempts for transient
  /// failures (server wake-up, 502/503/504, dropped connection, timeout).
  /// [onSlow] fires once when the first attempt is still pending after
  /// [slowAfter] or a retry starts, so the UI can say the server is waking up.
  Future<Json> get(
    Uri url, {
    Future<void>? abort,
    int retries = 0,
    Duration slowAfter = const Duration(seconds: 4),
    VoidCallback? onSlow,
    bool Function()? cancelled,
  }) async {
    final requestId = newRequestId();
    final started = DateTime.now();
    final path = url.path;
    final slow = onSlow == null ? null : Timer(slowAfter, onSlow);
    try {
      for (var attempt = 1; ; attempt++) {
        try {
          final payload = await _once(url, abort, requestId, attempt);
          return payload;
        } on ApiFailure catch (error) {
          final more =
              attempt <= retries &&
              error.transient &&
              !(cancelled?.call() ?? false);
          diagnostics.setAll({
            'api': url.host,
            'path': path,
            'request': requestId,
            'attempts': attempt,
            'ms': DateTime.now().difference(started).inMilliseconds,
            'status': error.status ?? error.code,
            'error': more ? 'retrying:${error.code}' : error.code,
          });
          if (!more) rethrow;
          onSlow?.call();
          await sleep(Duration(seconds: attempt == 1 ? 1 : 3));
          if (cancelled?.call() ?? false) rethrow;
        }
      }
    } finally {
      slow?.cancel();
    }
  }

  Future<Json> _once(
    Uri url,
    Future<void>? abort,
    String requestId,
    int attempt,
  ) async {
    final started = DateTime.now();
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
          ..headers['Accept'] = 'application/json'
          ..headers['X-Request-ID'] = requestId;
    try {
      final response = await client
          .send(request)
          .then(http.Response.fromStream)
          .timeout(
            timeout,
            onTimeout: () {
              deadline.complete();
              throw const ApiFailure('timeout');
            },
          );
      diagnostics.setAll({
        'api': url.host,
        'path': url.path,
        'request': requestId,
        'attempts': attempt,
        'status': response.statusCode,
        'ms': DateTime.now().difference(started).inMilliseconds,
        'edge': response.headers['rndr-id'],
        'error': null,
      });
      if (response.statusCode != 200) {
        final wait = int.tryParse(response.headers['retry-after'] ?? '');
        if (url.path == '/v1/route' &&
            (response.statusCode == 400 || response.statusCode == 404)) {
          final code = _routeError(response.bodyBytes);
          if (code != null) throw ApiFailure(code, null, response.statusCode);
        }
        throw ApiFailure(
          switch (response.statusCode) {
            429 => 'rate',
            401 || 403 => 'access',
            404 => 'missing',
            >= 500 => 'service',
            _ => 'invalid',
          },
          wait == null ? null : Duration(seconds: wait.clamp(0, 600)),
          response.statusCode,
        );
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

  /// Wakes a sleeping free-tier routing server in the background. It carries
  /// no user data and its failure is irrelevant: the route request retries.
  Future<void> warmUp() async {
    try {
      await get(endpoint(routingUrl, '/health'));
    } catch (_) {
      // Informational only.
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
    int retries = 2,
    VoidCallback? onSlow,
    bool Function()? cancelled,
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
      retries: retries,
      onSlow: onSlow,
      cancelled: cancelled,
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
      diagnostics.set('error', 'routePayload');
      throw const ApiFailure('routePayload');
    }
    diagnostics.setAll({
      'points': routes.first.points.length,
      'meters': routes.first.meters.round(),
      'seconds': routes.first.seconds.round(),
    });
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
