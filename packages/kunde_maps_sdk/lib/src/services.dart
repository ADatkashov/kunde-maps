import 'dart:async';

import 'package:flutter/foundation.dart' show VoidCallback;

import 'client.dart';
import 'errors.dart';
import 'eta.dart';
import 'geo.dart';
import 'models.dart';

/// How the traveller moves. [apiName] is the Maps routing API value.
enum RouteMode {
  car('car'),
  foot('foot'),
  bike('bike');

  const RouteMode(this.apiName);
  final String apiName;
}

/// Address and place search (the Maps Search API).
class PlaceSearch {
  PlaceSearch(this.client);

  final MapsClient client;

  void _require() {
    if (!client.config.features.search) throw const MapsException('disabled');
  }

  /// Address or place query around [center]. Pass [abort] to cancel an
  /// outdated request when the user keeps typing.
  Future<List<MapPlace>> search(
    String query,
    GeoPoint center, {
    String? language,
    Future<void>? abort,
  }) async {
    _require();
    return client.search(
      query,
      language ?? client.config.language,
      center,
      abort ?? Completer<void>().future,
    );
  }

  Future<List<MapPlace>> nearby(GeoPoint center, {String? category}) async {
    _require();
    return client.nearby(center, category);
  }

  Future<MapPlace> details(String id) async {
    _require();
    return client.details(id);
  }

  Future<List<String>> categories() async {
    _require();
    return client.categories();
  }
}

/// A computed road route, ready to show before anything is ordered.
///
/// This is distance and a typical travel time from OpenStreetMap speeds
/// (no traffic, no closures). It is **not** a price, a promised arrival or a
/// dispatch decision: business backends own those.
class RoutePreviewData {
  RoutePreviewData(this.routes, {this.selectedIndex = 0})
    : assert(routes.isNotEmpty);

  final List<MapRoute> routes;
  final int selectedIndex;

  MapRoute get route => routes[selectedIndex];
  int get distanceMeters => route.meters.round();
  int get durationSeconds => route.seconds.round();
  bool get trafficAware => false;

  Eta eta([DateTime? now]) => Eta.fromSeconds(route.seconds, now: now);

  RoutePreviewData select(int index) => RoutePreviewData(
    routes,
    selectedIndex: index.clamp(0, routes.length - 1),
  );
}

/// Routing A -> B (the Maps routing API).
class Routing {
  Routing(this.client);

  final MapsClient client;

  Future<List<MapRoute>> routes(
    GeoPoint origin,
    GeoPoint destination, {
    RouteMode mode = RouteMode.car,
    String? language,
    bool alternatives = false,
    Future<void>? abort,
    VoidCallback? onSlow,
    bool Function()? cancelled,
  }) async {
    if (!client.config.features.routing) {
      throw const MapsException('disabled');
    }
    return client.route(
      origin,
      destination,
      mode.apiName,
      language ?? client.config.language,
      alternatives: alternatives,
      abort: abort,
      onSlow: onSlow,
      cancelled: cancelled,
    );
  }

  /// The "route preview" step: the same call, wrapped so UI code reads
  /// distance, duration and arrival without touching geometry.
  Future<RoutePreviewData> preview(
    GeoPoint origin,
    GeoPoint destination, {
    RouteMode mode = RouteMode.car,
    String? language,
    bool alternatives = false,
    Future<void>? abort,
    VoidCallback? onSlow,
  }) async => RoutePreviewData(
    await routes(
      origin,
      destination,
      mode: mode,
      language: language,
      alternatives: alternatives,
      abort: abort,
      onSlow: onSlow,
    ),
  );

  /// Wakes a sleeping free-tier routing server; safe to call early.
  Future<void> warmUp() => client.warmUp();
}
