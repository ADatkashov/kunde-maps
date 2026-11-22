import 'geo.dart';

typedef Json = Map<String, dynamic>;

/// A place or address from the Maps Search API. Every attribute can be null:
/// nothing is guessed.
class MapPlace {
  MapPlace(this.data) : point = GeoPoint.parse(data['lat'], data['lon']);

  final Json data;
  final GeoPoint point;

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

class RouteManeuver {
  RouteManeuver(Json data)
    : point = GeoPoint.parse(
        (data['location'] as List)[1],
        (data['location'] as List)[0],
      ),
      instruction = data['instruction'] as String,
      street = data['street'] as String?,
      type = data['type'] as int,
      seconds = (data['duration_s'] as num).toDouble();

  final GeoPoint point;
  final String instruction;
  final String? street;
  final int type;
  final double seconds;
}

class MapRoute {
  MapRoute(Json data)
    : meters = (data['distance_m'] as num).toDouble(),
      seconds = (data['duration_s'] as num).toDouble(),
      language = data['instruction_language'] as String? ?? 'ru',
      points = ((data['geometry'] as Json)['coordinates'] as List)
          .map((p) => GeoPoint.parse(p[1], p[0]))
          .toList(growable: false),
      steps = (data['steps'] as List)
          .map((step) => RouteManeuver(step as Json))
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
  final List<GeoPoint> points;
  final List<RouteManeuver> steps;
}
