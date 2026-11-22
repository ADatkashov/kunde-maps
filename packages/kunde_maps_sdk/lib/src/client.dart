import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'config.dart';
import 'errors.dart';
import 'geo.dart';
import 'models.dart';

String newRequestId() {
  final random = math.Random.secure();
  return '${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-'
      '${random.nextInt(1 << 31).toRadixString(36)}';
}

class MapsClient {
  MapsClient(
    this.config,
    this.client, {
    this.sleep = _sleep,
    this.diagnostics,
    Duration? timeout,
  }) : timeout = timeout ?? config.requestTimeout;

  final MapsConfig config;
  final MapsDiagnostics? diagnostics;
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
        } on MapsException catch (error) {
          final more =
              attempt <= retries &&
              error.transient &&
              !(cancelled?.call() ?? false);
          diagnostics?.setAll({
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
              throw const MapsException('timeout');
            },
          );
      diagnostics?.setAll({
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
          if (code != null) {
            throw MapsException(code, null, response.statusCode);
          }
        }
        throw MapsException(
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
      throw const MapsException('timeout');
    } on http.RequestAbortedException {
      rethrow;
    } on http.ClientException {
      throw const MapsException('network');
    } on FormatException {
      throw const MapsException('invalid');
    } on TypeError {
      throw const MapsException('invalid');
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
      await get(endpoint(config.routingUrl, '/health'));
    } catch (_) {
      // Informational only.
    }
  }

  Uri endpoint(String base, String path, [Map<String, String>? query]) =>
      secureUrl(base).resolve(path).replace(queryParameters: query);

  Future<List<MapPlace>> search(
    String query,
    String language,
    GeoPoint center,
    Future<void> abort,
  ) async {
    final payload = await get(
      endpoint(config.searchUrl, '/v1/search', {
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
    final payload = await get(endpoint(config.searchUrl, '/v1/categories'));
    return (payload['categories'] as List)
        .map((c) => c['id'] as String)
        .toList();
  }

  Future<MapPlace> details(String id) async {
    final payload = await get(endpoint(config.searchUrl, '/v1/places/$id'));
    return MapPlace(payload['place'] as Json);
  }

  Future<List<MapPlace>> nearby(GeoPoint center, String? category) async {
    final payload = await get(
      endpoint(config.searchUrl, '/v1/places', {
        'lat': center.lat.toStringAsFixed(3),
        'lon': center.lon.toStringAsFixed(3),
        'radius': '4000',
        'limit': '45',
        'category': ?category,
      }),
    );
    return placesFrom(payload['places']);
  }

  Future<List<MapRoute>> route(
    GeoPoint origin,
    GeoPoint destination,
    String mode,
    String language, {
    bool alternatives = false,
    Future<void>? abort,
    int retries = 2,
    VoidCallback? onSlow,
    bool Function()? cancelled,
  }) async {
    final payload = await get(
      endpoint(config.routingUrl, '/v1/route', {
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
    final routes = <MapRoute>[];
    try {
      routes.add(MapRoute(payload));
    } on Object catch (error) {
      if (error is! FormatException &&
          error is! TypeError &&
          error is! RangeError) {
        rethrow;
      }
      diagnostics?.set('error', 'routePayload');
      throw const MapsException('routePayload');
    }
    diagnostics?.setAll({
      'points': routes.first.points.length,
      'meters': routes.first.meters.round(),
      'seconds': routes.first.seconds.round(),
    });
    final options = payload['alternatives'];
    if (options is List) {
      for (final item in options.whereType<Json>()) {
        try {
          routes.add(
            MapRoute({
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

  static List<MapPlace> placesFrom(Object? values) =>
      (values as List).map((p) => MapPlace(p as Json)).toList();
}
