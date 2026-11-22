/// Failure categories every SDK service reports. Stable, safe to switch on.
enum MapsErrorKind {
  timeout,
  network,
  rateLimited,
  accessDenied,
  notFound,
  unavailable,
  invalidResponse,
  routeNotFound,
  routeNoRoad,
  routeOutsideCoverage,
  routeTooClose,
  routeTooLong,
  disabled,
}

/// The one exception type the SDK throws for service failures.
///
/// [code] keeps the short stable identifiers the KUNDE Maps app already
/// used (`timeout`, `network`, `rate`, `access`, `missing`, `service`,
/// `invalid`, `routePayload`, `routeNotFound`, ...). It never contains
/// coordinates, addresses or tokens.
class MapsException implements Exception {
  const MapsException(this.code, [this.retryAfter, this.status]);

  final String code;
  final Duration? retryAfter;
  final int? status;

  MapsErrorKind get kind => switch (code) {
    'timeout' => MapsErrorKind.timeout,
    'network' => MapsErrorKind.network,
    'rate' => MapsErrorKind.rateLimited,
    'access' => MapsErrorKind.accessDenied,
    'missing' => MapsErrorKind.notFound,
    'service' => MapsErrorKind.unavailable,
    'routeNotFound' => MapsErrorKind.routeNotFound,
    'routeNoRoad' => MapsErrorKind.routeNoRoad,
    'routeCoverage' => MapsErrorKind.routeOutsideCoverage,
    'routeTooClose' => MapsErrorKind.routeTooClose,
    'routeTooLong' => MapsErrorKind.routeTooLong,
    'disabled' => MapsErrorKind.disabled,
    _ => MapsErrorKind.invalidResponse,
  };

  /// Temporary conditions (server wake-up, network handover) where a repeat
  /// request usually succeeds.
  bool get transient =>
      code == 'timeout' ||
      code == 'network' ||
      status == 502 ||
      status == 503 ||
      status == 504;

  @override
  String toString() => 'MapsException($code, status: $status)';
}
