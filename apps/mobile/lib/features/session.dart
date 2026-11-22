import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../core/platform_api.dart';
import '../core/progress.dart';
import '../core/strings.dart';
import 'location.dart';

class NavigationSession extends ChangeNotifier {
  NavigationSession(
    this.api,
    this.words,
    this.mode,
    this.destination,
    RoadRoute road,
  ) : progress = RouteProgress(road, mode);

  final PlatformApi api;
  final Words words;
  final String mode;
  final Point destination;
  final Voice _voice = Voice();
  RouteProgress progress;
  Position? position;
  DateTime? _fixAt;
  DateTime _retryAt = DateTime.fromMillisecondsSinceEpoch(0);
  StreamSubscription<Position>? _watch;
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

  String get status {
    if (arrived) return 'arrived';
    if (_reroute != null) return 'reroute';
    if (issue != null) return issue!;
    if (_fixAt == null ||
        DateTime.now().difference(_fixAt!) > const Duration(seconds: 8)) {
      return 'weak';
    }
    return 'following';
  }

  Future<bool> start() async {
    final generation = ++_generation;
    final allowed = await requestLocation();
    if (!allowed || generation != _generation) return false;
    notificationsDisabled = !await navigationNotificationsGranted();
    if (generation != _generation) return false;
    active = true;
    _watch =
        Geolocator.getPositionStream(
          locationSettings: notificationsDisabled
              ? const LocationSettings(
                  accuracy: LocationAccuracy.bestForNavigation,
                  distanceFilter: 2,
                )
              : navigationSettings(words, mode),
        ).listen(
          _onFix,
          onError: (Object error) {
            if (error is PermissionDeniedException ||
                error is LocationServiceDisabledException) {
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

  void _onFix(Position fix) {
    if (!active) return;
    final point = Point.parse(fix.latitude, fix.longitude);
    final now = DateTime.now();
    if (!progress.update(point, fix.accuracy, fix.timestamp, now)) return;
    position = fix;
    _fixAt = now;
    if (progress.arrived) {
      stop();
      arrived = true;
      if (voice) unawaited(_speak(words('arrived'), allowArrival: true));
    } else if (progress.offRoute) {
      if (_reroute == null && _rerouteFailures < 4 && now.isAfter(_retryAt)) {
        unawaited(_recalculate(point));
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
                  : '${words('in')} $distance ${words('m')}, $text',
            ),
          );
        }
      }
    }
    notifyListeners();
  }

  String? instructionKey(Maneuver step) => switch (step.type) {
    4 || 5 || 6 => 'destinationAhead',
    0 || 7 || 8 || 17 || 22 => 'straight',
    9 || 10 || 11 || 18 || 20 || 23 => 'right',
    14 || 15 || 16 || 19 || 21 || 24 => 'left',
    12 || 13 => 'uturn',
    26 => 'roundabout',
    27 => 'exit',
    _ => null,
  };

  String instruction(Maneuver step) {
    final key = instructionKey(step);
    return key == null ? step.instruction : words(key);
  }

  bool get canRetry =>
      active &&
      progress.offRoute &&
      issue != null &&
      position != null &&
      _reroute == null &&
      !DateTime.now().isBefore(_retryAt);

  void retry() {
    if (!canRetry) return;
    _rerouteFailures = 0;
    final fix = position!;
    unawaited(_recalculate(Point(fix.latitude, fix.longitude)));
    notifyListeners();
  }

  Future<void> _speak(String text, {bool allowArrival = false}) async {
    final generation = _generation;
    bool current() =>
        generation == _generation &&
        voice &&
        (active || (allowArrival && arrived));
    final ok = await _voice.speak(words.language, text, current);
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

  Future<void> _recalculate(Point current) async {
    final token = Completer<void>();
    _reroute = token;
    _retryAt = DateTime.now().add(const Duration(seconds: 12));
    try {
      final routes = await api.route(
        current,
        destination,
        mode,
        words.language,
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
        issue = error is ApiFailure ? error.code : 'invalid';
        _rerouteFailures++;
        final retry = error is ApiFailure ? error.retryAfter : null;
        final backoff = Duration(seconds: 10 * _rerouteFailures);
        _retryAt = DateTime.now().add(
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
