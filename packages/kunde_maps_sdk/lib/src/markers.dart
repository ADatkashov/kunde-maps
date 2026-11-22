import 'dart:async';

import 'package:maplibre_gl/maplibre_gl.dart' as ml;

import 'geo.dart';

/// A point object on the map: a pickup, a driver, a restaurant, the user.
/// [data] lets the host recognise it again in a tap callback; the SDK never
/// reads it.
class MapMarker {
  const MapMarker({
    required this.id,
    required this.point,
    this.color = '#2563EB',
    this.radius = 7,
    this.data,
  });

  final String id;
  final GeoPoint point;
  final String color;
  final double radius;
  final Object? data;

  /// Common roles with fixed colours, so hosts do not invent their own.
  static const origin = '#16A34A';
  static const destination = '#DC2626';
  static const self = '#0EA5E9';
  static const vehicle = '#F59E0B';
}

/// Draws [MapMarker]s as native circles and reports taps.
///
/// Native MapLibre circles keep working on low-end Android devices where
/// widget overlays would not follow the camera.
class MapMarkers {
  MapMarkers(this._controller) {
    _controller.onCircleTapped.add(_tapped);
  }

  final ml.MapLibreMapController _controller;
  final _byCircle = <ml.Circle, MapMarker>{};
  void Function(MapMarker marker)? onTap;

  /// Replaces every marker with [markers].
  Future<void> setAll(List<MapMarker> markers) async {
    await _controller.clearCircles();
    _byCircle.clear();
    if (markers.isEmpty) return;
    final circles = await _controller.addCircles([
      for (final marker in markers)
        ml.CircleOptions(
          geometry: ml.LatLng(marker.point.lat, marker.point.lon),
          circleColor: marker.color,
          circleRadius: marker.radius,
          circleStrokeColor: '#FFFFFF',
          circleStrokeWidth: 2,
        ),
    ]);
    for (var i = 0; i < markers.length && i < circles.length; i++) {
      _byCircle[circles[i]] = markers[i];
    }
  }

  void _tapped(ml.Circle circle) {
    final marker = _byCircle[circle];
    if (marker != null) onTap?.call(marker);
  }

  void dispose() => _controller.onCircleTapped.remove(_tapped);
}
