import 'dart:async';

import 'package:flutter/foundation.dart';

import 'client.dart';
import 'errors.dart';
import 'geo.dart';
import 'geolocation.dart';
import 'models.dart';
import 'progress.dart';
import 'strings.dart';
import 'voice.dart';

/// Turn-by-turn guidance along one route: GPS matching, voice prompts,
/// automatic rerouting and arrival. UI-free; listen with [addListener].
///
/// The GPS track stays in memory and is dropped on [stop]. Only the current
/// position and the original destination are sent to the routing API, and
/// only when a reroute is needed.
class NavigationController extends ChangeNotifier {
  NavigationController({
    required this.client,
    required this.strings,
    required this.mode,
    required this.destination,
    required MapRoute route,
    LocationSource location = const DeviceLocationSource(),
    VoiceGuide? voiceGuide,
    DateTime Function() clock = DateTime.now,
    this.notificationPermission,
  }) : progress = RouteProgress(route, mode),
       // ignore: prefer_initializing_formals
       _location = location,
       _voice = voiceGuide ?? TtsVoiceGuide(),
       // ignore: prefer_initializing_formals
       _clock = clock;

  final MapsClient client;
  final MapsStrings strings;
  final String mode;
  final GeoPoint destination;

  /// Asked once before the foreground notification is used (Android 13+).
  /// Returns false when notifications are not allowed; guidance still works.
  final Future<bool> Function()? notificationPermission;

  final LocationSource _location;
  final VoiceGuide _voice;
  final DateTime Function() _clock;

  RouteProgress progress;
  LocationFix? position;
  DateTime? _fixAt;
  DateTime _retryAt = DateTime.fromMillisecondsSinceEpoch(0);
  StreamSubscription<LocationFix>? _watch;
  Timer? _watchdog;
  Completer<void>? _reroute;
  final _announced = <(int, int)>{};
  bool active = false;
  bool arrived = false;
  bool voice = true;
  bool voiceUnavailable = false;
  bool notificationsDisabled = false;
  bool follow = true;
  String? issue;
  int _generation = 0;
  int _rerouteFailures = 0;

  /// `arrived`, `reroute`, a failure code, `weak` (no fix for 8 s) or
  /// `following`.
  String get status {
    if (arrived) return 'arrived';
    if (_reroute != null) return 'reroute';
    if (issue != null) return issue!;
    if (_fixAt == null ||
        _clock().difference(_fixAt!) > const Duration(seconds: 8)) {
      return 'weak';
    }
    return 'following';
  }

  /// Starts GPS guidance. Returns false when location is not allowed.
  Future<bool> start() async {
    final generation = ++_generation;
    final allowed = await _location.access() == GpsAccess.ok;
    if (!allowed || generation != _generation) return false;
    notificationsDisabled = notificationPermission == null
        ? false
        : !await notificationPermission!();
    if (generation != _generation) return false;
    active = true;
    _watch = _location
        .watch(
          strings: strings,
          navigation: true,
          vehicle: mode == 'car',
          notification: !notificationsDisabled,
        )
        .listen(
          _onFix,
          onError: (Object error) {
            if (error is LocationUnavailable) {
              stop();
              issue = 'gps';
            }
            notifyListeners();
          },
        );
    _watchdog = Timer.periodic(const Duration(seconds: 2), (_) {
      if (status == 'weak' || issue != null) notifyListeners();
    });
    notifyListeners();
    return true;
  }

  void _onFix(LocationFix fix) {
    if (!active) return;
    final now = _clock();
    if (!progress.update(fix.point, fix.accuracy, fix.timestamp, now)) return;
    position = fix;
    _fixAt = now;
    if (progress.arrived) {
      stop();
      arrived = true;
      if (voice) unawaited(_speak(strings('arrived'), allowArrival: true));
    } else if (progress.offRoute) {
      if (_reroute == null && _rerouteFailures < 4 && now.isAfter(_retryAt)) {
        unawaited(_recalculate(fix.point));
      }
    } else {
      _cancelReroute();
      _rerouteFailures = 0;
      issue = null;
      final next = progress.nextStep;
      if (voice && next != null) {
        final meters = progress.maneuverMeters;
        final prompt = meters <= 35
            ? 35
            : meters <= 120
            ? 120
            : meters <= 300
            ? 300
            : 0;
        if (prompt > 0 && _announced.add((next, prompt))) {
          final text = instruction(progress.route.steps[next]);
          final distance = (meters / 10).round() * 10;
          unawaited(
            _speak(
              prompt == 35
                  ? text
                  : '${strings('in')} $distance ${strings('m')}, $text',
            ),
          );
        }
      }
    }
    notifyListeners();
  }

  /// Localisation key for a Valhalla manoeuvre type, or null to use the
  /// server text.
  String? instructionKey(RouteManeuver step) => switch (step.type) {
    4 || 5 || 6 => 'destinationAhead',
    0 || 7 || 8 || 17 || 22 => 'straight',
    9 || 10 || 11 || 18 || 20 || 23 => 'right',
    14 || 15 || 16 || 19 || 21 || 24 => 'left',
    12 || 13 => 'uturn',
    26 => 'roundabout',
    27 => 'exit',
    _ => null,
  };

  String instruction(RouteManeuver step) {
    final key = instructionKey(step);
    return key == null ? step.instruction : strings(key);
  }

  bool get canRetry =>
      active &&
      progress.offRoute &&
      issue != null &&
      position != null &&
      _reroute == null &&
      !_clock().isBefore(_retryAt);

  /// Manual reroute after a failed automatic attempt.
  void retry() {
    if (!canRetry) return;
    _rerouteFailures = 0;
    unawaited(_recalculate(position!.point));
    notifyListeners();
  }

  Future<void> _speak(String text, {bool allowArrival = false}) async {
    final generation = _generation;
    bool current() =>
        generation == _generation &&
        voice &&
        (active || (allowArrival && arrived));
    final ok = await _voice.speak(strings.language, text, current);
    if (current() && !ok) {
      voiceUnavailable = true;
      notifyListeners();
    }
  }

  void setVoice(bool value) {
    voice = value;
    if (!voice) unawaited(_voice.stop());
    notifyListeners();
  }

  Future<void> _recalculate(GeoPoint current) async {
    final token = Completer<void>();
    _reroute = token;
    _retryAt = _clock().add(const Duration(seconds: 12));
    try {
      final routes = await client.route(
        current,
        destination,
        mode,
        strings.language,
        abort: token.future,
      );
      if (active && identical(_reroute, token)) {
        progress = RouteProgress(routes.first, mode);
        _announced.clear();
        _rerouteFailures = 0;
        issue = null;
      }
    } catch (error) {
      if (active && identical(_reroute, token)) {
        issue = error is MapsException ? error.code : 'invalid';
        _rerouteFailures++;
        final retry = error is MapsException ? error.retryAfter : null;
        final backoff = Duration(seconds: 10 * _rerouteFailures);
        _retryAt = _clock().add(
          retry != null && retry > backoff ? retry : backoff,
        );
      }
    } finally {
      if (identical(_reroute, token)) {
        _reroute = null;
        notifyListeners();
      }
    }
  }

  void _cancelReroute() {
    _reroute?.complete();
    _reroute = null;
  }

  void stop() {
    _generation++;
    active = false;
    arrived = false;
    position = null;
    _fixAt = null;
    _cancelReroute();
    unawaited(_watch?.cancel());
    _watch = null;
    _watchdog?.cancel();
    _watchdog = null;
    unawaited(_voice.stop());
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
