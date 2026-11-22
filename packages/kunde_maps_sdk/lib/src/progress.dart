import 'dart:math' as math;

import 'geo.dart';
import 'models.dart';

const _metersPerDegree = 111195.0;

class Projection {
  const Projection(this.along, this.offset);
  final double along;
  final double offset;
}

/// Map-matches GPS fixes to a route: progress along it, next manoeuvre,
/// remaining distance/time, off-route and arrival detection. Pure Dart, no
/// platform dependency.
class RouteProgress {
  RouteProgress(this.route, this.mode) {
    for (var i = 1; i < route.points.length; i++) {
      lengths.add(
        lengths.last + metersBetween(route.points[i - 1], route.points[i]),
      );
    }
    for (final step in route.steps) {
      final floor = stepPositions.lastOrNull ?? 0;
      stepPositions.add(project(step.point, floor, lengths.last).along);
    }
  }

  final MapRoute route;
  final String mode;
  final lengths = <double>[0];
  final stepPositions = <double>[];
  double along = 0;
  int _offFixes = 0;
  int _arrivalFixes = 0;
  DateTime? _offSince;
  GeoPoint? _last;
  DateTime? _time;

  int? get nextStep {
    for (var i = 1; i < stepPositions.length; i++) {
      if (stepPositions[i] >= along - 8) return i;
    }
    return null;
  }

  double get maneuverMeters => nextStep == null
      ? remainingMeters
      : math.max(0, stepPositions[nextStep!] - along);

  double get remainingMeters =>
      lengths.last == 0 ? 0 : route.meters * (1 - along / lengths.last);

  double get remainingSeconds {
    final total = route.steps.fold(0.0, (sum, step) => sum + step.seconds);
    if (total <= 0 || lengths.last == 0) {
      return route.seconds * remainingMeters / route.meters;
    }
    var remaining = 0.0;
    for (var i = 0; i < stepPositions.length; i++) {
      final start = stepPositions[i];
      final end = i + 1 < stepPositions.length
          ? stepPositions[i + 1]
          : lengths.last;
      if (end > start) {
        remaining +=
            route.steps[i].seconds *
            ((end - along) / (end - start)).clamp(0, 1);
      } else if (along < end) {
        remaining += route.steps[i].seconds;
      }
    }
    return remaining * route.seconds / total;
  }

  bool get offRoute =>
      _offFixes >= 3 &&
      _time!.difference(_offSince!) >= const Duration(seconds: 2);
  bool get arrived => _arrivalFixes >= 2;

  Projection project(GeoPoint point, double lower, double upper) {
    var best = Projection(lower, double.infinity);
    final east = _metersPerDegree * math.cos(point.lat * math.pi / 180);
    for (var i = 1; i < lengths.length; i++) {
      final start = lengths[i - 1];
      final span = lengths[i] - start;
      if (span <= 0 || lengths[i] < lower || start > upper) continue;
      final a = route.points[i - 1];
      final b = route.points[i];
      final x = (a.lon - point.lon) * east;
      final y = (a.lat - point.lat) * _metersPerDegree;
      final dx = (b.lon - a.lon) * east;
      final dy = (b.lat - a.lat) * _metersPerDegree;
      final fraction = (-(x * dx + y * dy) / (dx * dx + dy * dy)).clamp(
        math.max(0, (lower - start) / span),
        math.min(1, (upper - start) / span),
      );
      final cross = math.sqrt(
        math.pow(x + dx * fraction, 2) + math.pow(y + dy * fraction, 2),
      );
      if (cross < best.offset) {
        best = Projection(start + span * fraction, cross);
      }
    }
    return best;
  }

  bool update(GeoPoint point, double accuracy, DateTime time, DateTime now) {
    if (!accuracy.isFinite ||
        accuracy < 0 ||
        accuracy > 60 ||
        now.difference(time).abs() > const Duration(seconds: 15) ||
        (_time != null && !time.isAfter(_time!))) {
      return false;
    }
    if (_last != null) {
      final seconds = time.difference(_time!).inMilliseconds / 1000;
      final maxSpeed = switch (mode) {
        'foot' => 12,
        'bike' => 30,
        _ => 75,
      };
      if (metersBetween(_last!, point) >
          math.max(60 + accuracy, seconds * maxSpeed)) {
        return false;
      }
    }
    _last = point;
    _time = time;
    final match = project(
      point,
      math.max(0, along - 35),
      math.min(lengths.last, along + 425),
    );
    final tolerance = switch (mode) {
      'foot' => 20,
      'bike' => 25,
      _ => 35,
    };
    if (match.offset > tolerance + accuracy) {
      if (_offFixes++ == 0) _offSince = time;
      _arrivalFixes = 0;
    } else {
      _offFixes = 0;
      along = math.max(along, match.along);
      final arrivalRadius = switch (mode) {
        'foot' => 15.0,
        'bike' => 20.0,
        _ => 30.0,
      };
      if (accuracy <= 30 &&
          lengths.last - along <= arrivalRadius &&
          metersBetween(point, route.points.last) <=
              math.max(arrivalRadius, accuracy)) {
        _arrivalFixes++;
      } else {
        _arrivalFixes = 0;
      }
    }
    return true;
  }
}
