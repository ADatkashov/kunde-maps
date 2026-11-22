import 'dart:math' as math;

/// A WGS 84 coordinate. Construct with [GeoPoint.parse] for untrusted input.
class GeoPoint {
  const GeoPoint(this.lat, this.lon);

  /// Validates untrusted JSON values and rejects NaN, infinity and
  /// out-of-range coordinates.
  factory GeoPoint.parse(Object? lat, Object? lon) {
    if (lat is! num ||
        lon is! num ||
        !lat.isFinite ||
        !lon.isFinite ||
        lat.abs() > 90 ||
        lon.abs() > 180) {
      throw const FormatException('Invalid coordinates');
    }
    return GeoPoint(lat.toDouble(), lon.toDouble());
  }

  final double lat;
  final double lon;

  /// `lat,lon` with six decimals, the format the Maps API expects.
  String get query => '${lat.toStringAsFixed(6)},${lon.toStringAsFixed(6)}';

  @override
  bool operator ==(Object other) =>
      other is GeoPoint && other.lat == lat && other.lon == lon;

  @override
  int get hashCode => Object.hash(lat, lon);

  @override
  String toString() => 'GeoPoint($lat, $lon)';
}

/// Kazakhstan bounding box, the same coverage the routing API enforces.
bool inKazakhstan(GeoPoint p) =>
    p.lon >= 46.0 && p.lon <= 88.0 && p.lat >= 40.0 && p.lat <= 56.0;

const _metersPerDegree = 111195.0;

/// Equirectangular distance in metres; accurate to well under 1% for city
/// scale distances, which is all navigation matching needs.
double metersBetween(GeoPoint a, GeoPoint b) {
  final north = (a.lat - b.lat) * _metersPerDegree;
  final east =
      (a.lon - b.lon) *
      _metersPerDegree *
      math.cos((a.lat + b.lat) * math.pi / 360);
  return math.sqrt(north * north + east * east);
}

/// Rounds a coordinate to roughly [decimals] places (3 = about 100 m).
/// Use before sending a position to a service that does not need precision.
GeoPoint coarsen(GeoPoint p, {int decimals = 3}) => GeoPoint(
  double.parse(p.lat.toStringAsFixed(decimals)),
  double.parse(p.lon.toStringAsFixed(decimals)),
);
