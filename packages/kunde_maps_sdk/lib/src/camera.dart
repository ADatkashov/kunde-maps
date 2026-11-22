import 'package:flutter/foundation.dart';
import 'package:maplibre_gl/maplibre_gl.dart' as ml;

import 'geo.dart';
import 'models.dart';

/// Moves the map camera. Every call is safe to make while a style change is
/// in flight (the platform camera can be briefly invalid then); failures are
/// swallowed and reported as `false`.
class CameraController {
  CameraController(this._controller);

  final ml.MapLibreMapController _controller;

  /// Centre of the last settled camera position, if known.
  GeoPoint? get center {
    final target = _controller.cameraPosition?.target;
    return target == null ? null : GeoPoint(target.latitude, target.longitude);
  }

  double? get zoom => _controller.cameraPosition?.zoom;

  Future<bool> moveTo(GeoPoint point, {double zoom = 15, double bearing = 0}) =>
      _animate(
        ml.CameraUpdate.newCameraPosition(
          ml.CameraPosition(
            target: ml.LatLng(point.lat, point.lon),
            zoom: zoom,
            bearing: bearing,
          ),
        ),
      );

  /// Fits [points] on screen; [bottom] reserves room for a bottom sheet.
  Future<bool> fit(
    Iterable<GeoPoint> points, {
    double left = 32,
    double right = 32,
    double top = 80,
    double bottom = 32,
  }) {
    var south = 90.0, north = -90.0, west = 180.0, east = -180.0;
    var any = false;
    for (final p in points) {
      any = true;
      if (p.lat < south) south = p.lat;
      if (p.lat > north) north = p.lat;
      if (p.lon < west) west = p.lon;
      if (p.lon > east) east = p.lon;
    }
    if (!any) return Future.value(false);
    return _animate(
      ml.CameraUpdate.newLatLngBounds(
        ml.LatLngBounds(
          southwest: ml.LatLng(south - .00001, west - .00001),
          northeast: ml.LatLng(north + .00001, east + .00001),
        ),
        left: left,
        right: right,
        top: top,
        bottom: bottom,
      ),
    );
  }

  Future<bool> fitRoute(
    MapRoute route, {
    double left = 32,
    double right = 32,
    double top = 80,
    double bottom = 32,
  }) => fit(route.points, left: left, right: right, top: top, bottom: bottom);

  /// Resets rotation to north-up without moving.
  Future<bool> resetNorth() => _animate(ml.CameraUpdate.bearingTo(0));

  Future<bool> _animate(ml.CameraUpdate update) async {
    try {
      await _controller.animateCamera(update);
      return true;
    } catch (_) {
      debugPrint('KUNDE maps: camera update skipped');
      return false;
    }
  }
}
