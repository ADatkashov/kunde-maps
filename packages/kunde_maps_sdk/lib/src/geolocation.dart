import 'dart:async';
import 'dart:io';

import 'package:geolocator/geolocator.dart';

import 'geo.dart';
import 'strings.dart';

/// Why the device position can or cannot be used.
enum GpsAccess { ok, serviceOff, denied, deniedForever }

/// One position fix. Accuracy is in metres.
class LocationFix {
  const LocationFix(
    this.point,
    this.accuracy,
    this.timestamp, {
    this.heading = 0,
    this.speed = 0,
  });

  final GeoPoint point;
  final double accuracy;
  final DateTime timestamp;

  /// Degrees clockwise from north; 0 when unknown.
  final double heading;

  /// Metres per second; 0 when unknown.
  final double speed;

  double get latitude => point.lat;
  double get longitude => point.lon;
}

/// Thrown by [LocationSource.watch] streams when location becomes
/// unavailable (permission revoked, service switched off).
class LocationUnavailable implements Exception {
  const LocationUnavailable();
}

/// Where position fixes come from. Navigation and trackers depend on this
/// interface, so they can be driven by the real GPS or by a recorded track.
abstract class LocationSource {
  Future<GpsAccess> access();

  /// One current fix, or null when none could be obtained in time.
  Future<LocationFix?> current({
    Duration timeout = const Duration(seconds: 12),
  });

  /// A continuous stream. [navigation] selects high accuracy and, where the
  /// platform needs it, a foreground notification.
  Stream<LocationFix> watch({
    required MapsStrings strings,
    bool navigation = false,
    bool vehicle = true,
    bool notification = true,
  });
}

/// Device GPS through the `geolocator` plugin.
class DeviceLocationSource implements LocationSource {
  const DeviceLocationSource();

  @override
  Future<GpsAccess> access() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return GpsAccess.serviceOff;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return switch (permission) {
      LocationPermission.whileInUse ||
      LocationPermission.always => GpsAccess.ok,
      LocationPermission.deniedForever => GpsAccess.deniedForever,
      _ => GpsAccess.denied,
    };
  }

  @override
  Future<LocationFix?> current({
    Duration timeout = const Duration(seconds: 12),
  }) async {
    if (await access() != GpsAccess.ok) return null;
    try {
      final fix = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: timeout,
        ),
      );
      return _fix(fix);
    } on TimeoutException {
      return null;
    } on LocationServiceDisabledException {
      return null;
    } on PermissionDeniedException {
      return null;
    }
  }

  @override
  Stream<LocationFix> watch({
    required MapsStrings strings,
    bool navigation = false,
    bool vehicle = true,
    bool notification = true,
  }) {
    final settings = !navigation || !notification
        ? LocationSettings(
            accuracy: navigation
                ? LocationAccuracy.bestForNavigation
                : LocationAccuracy.high,
            distanceFilter: navigation ? 2 : 10,
          )
        : _navigationSettings(strings, vehicle);
    // A plain transformer (not an async* generator) so that cancelling the
    // subscription releases the platform location stream immediately.
    return Geolocator.getPositionStream(locationSettings: settings).transform(
      StreamTransformer<Position, LocationFix>.fromHandlers(
        handleData: (position, sink) => sink.add(_fix(position)),
        handleError: (error, stack, sink) {
          if (error is PermissionDeniedException ||
              error is LocationServiceDisabledException) {
            sink.addError(const LocationUnavailable(), stack);
          } else {
            sink.addError(error, stack);
          }
        },
      ),
    );
  }

  static LocationFix _fix(Position p) => LocationFix(
    GeoPoint.parse(p.latitude, p.longitude),
    p.accuracy,
    p.timestamp,
    heading: p.heading.isFinite ? p.heading : 0,
    speed: p.speed.isFinite ? p.speed : 0,
  );

  static LocationSettings _navigationSettings(
    MapsStrings strings,
    bool vehicle,
  ) {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: 2,
        intervalDuration: const Duration(seconds: 1),
        foregroundNotificationConfig: ForegroundNotificationConfig(
          notificationTitle: strings('navTitle'),
          notificationText: strings('navText'),
          enableWakeLock: true,
          setOngoing: true,
        ),
      );
    }
    return AppleSettings(
      accuracy: LocationAccuracy.bestForNavigation,
      activityType: vehicle
          ? ActivityType.automotiveNavigation
          : ActivityType.fitness,
      distanceFilter: 2,
      pauseLocationUpdatesAutomatically: false,
      allowBackgroundLocationUpdates: true,
      showBackgroundLocationIndicator: true,
    );
  }
}

/// "Where am I" for one-shot use (pickup, nearby search, locate button).
class Geolocation {
  const Geolocation([this.source = const DeviceLocationSource()]);

  final LocationSource source;

  Future<GpsAccess> access() => source.access();

  /// The current point, or null when location is off, denied or slow.
  /// The caller decides what to tell the user using [access].
  Future<GeoPoint?> currentPoint({
    Duration timeout = const Duration(seconds: 12),
  }) async => (await source.current(timeout: timeout))?.point;
}
