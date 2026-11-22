import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'config.dart';
import 'eta.dart';
import 'map_view.dart';
import 'markers.dart';
import 'navigation.dart';
import 'strings.dart';

/// "850 m", "1.2 km" (or "850 м", "1,2 км" in Russian and Kazakh).
String formatDistance(double meters, String language) {
  final english = language == 'en';
  if (meters < 950) {
    final value = meters < 10 ? meters.round() : (meters / 10).round() * 10;
    return '$value ${english ? 'm' : 'м'}';
  }
  final km = (meters / 100).round() / 10;
  final text = km.toStringAsFixed(1);
  return '${english ? text : text.replaceAll('.', ',')} ${english ? 'km' : 'км'}';
}

/// The guidance panel: next manoeuvre, distance to it, remaining distance,
/// arrival time and the state of GPS, rerouting and voice. It only reads the
/// [NavigationController]; [onStop] is the host's decision.
class NavigationHud extends StatelessWidget {
  const NavigationHud({
    super.key,
    required this.controller,
    required this.onStop,
    this.now,
  });

  final NavigationController controller;
  final VoidCallback onStop;

  /// Fixed clock for tests.
  final DateTime? now;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final s = controller.strings;
      final progress = controller.progress;
      final status = controller.status;
      final next = progress.nextStep;
      final theme = Theme.of(context);
      final banner = switch (status) {
        'arrived' => s('arrived'),
        'reroute' => s('rerouting'),
        'weak' => s('weakGps'),
        'following' => null,
        final code => s.error(code),
      };
      final eta = Eta.fromSeconds(progress.remainingSeconds, now: now);
      return Material(
        elevation: 4,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!controller.arrived && next != null)
                Semantics(
                  liveRegion: true,
                  child: Text(
                    controller.instruction(progress.route.steps[next]),
                    style: theme.textTheme.titleLarge,
                  ),
                ),
              if (!controller.arrived && next != null)
                Text(
                  formatDistance(progress.maneuverMeters, s.language),
                  style: theme.textTheme.headlineSmall,
                ),
              if (banner != null)
                Semantics(
                  liveRegion: true,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      banner,
                      style: TextStyle(
                        color: status == 'arrived'
                            ? theme.colorScheme.primary
                            : theme.colorScheme.error,
                      ),
                    ),
                  ),
                ),
              if (controller.canRetry)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: controller.retry,
                    child: Text(s('retry')),
                  ),
                ),
              if (controller.voiceUnavailable) Text(s('noVoice')),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${s('remaining')}: '
                      '${formatDistance(progress.remainingMeters, s.language)}'
                      ' · ${eta.minutes} ${s.language == 'en' ? 'min' : 'мин'}'
                      ' · ${eta.clock}',
                    ),
                  ),
                  IconButton(
                    tooltip: controller.voice ? s('voiceOn') : s('voiceOff'),
                    icon: Icon(
                      controller.voice ? Icons.volume_up : Icons.volume_off,
                    ),
                    onPressed: () => controller.setVoice(!controller.voice),
                  ),
                ],
              ),
              FilledButton.tonal(onPressed: onStop, child: Text(s('stopNav'))),
            ],
          ),
        ),
      );
    },
  );
}

/// Map plus guidance: route line, your position, destination, a camera that
/// follows you until you move the map by hand, and the [NavigationHud].
/// Starting and stopping the [controller] stays with the host.
class NavigationView extends StatefulWidget {
  const NavigationView({
    super.key,
    required this.config,
    required this.controller,
    required this.onStop,
    this.dark = false,
  });

  final MapsConfig config;
  final NavigationController controller;
  final VoidCallback onStop;
  final bool dark;

  @override
  State<NavigationView> createState() => _NavigationViewState();
}

class _NavigationViewState extends State<NavigationView> {
  KundeMapController? _map;
  Object? _lastFix;
  Object? _lastRoute;
  bool _fitted = false;

  NavigationController get _nav => widget.controller;

  @override
  void initState() {
    super.initState();
    _nav.addListener(_sync);
  }

  @override
  void dispose() {
    _nav.removeListener(_sync);
    super.dispose();
  }

  void _sync() => unawaited(_paint());

  Future<void> _paint() async {
    final map = _map;
    if (map == null || !mounted) return;
    try {
      final route = _nav.progress.route;
      if (!identical(_lastRoute, route)) {
        _lastRoute = route;
        await map.showRoutes([route], route);
        if (!_fitted || _nav.position == null) {
          _fitted = true;
          await map.camera.fitRoute(route, top: 80, bottom: 260);
        }
      }
      final fix = _nav.position;
      await map.markers.setAll([
        MapMarker(
          id: 'destination',
          point: _nav.destination,
          color: MapMarker.destination,
          radius: 8,
        ),
        if (fix != null)
          MapMarker(
            id: 'self',
            point: fix.point,
            color: MapMarker.self,
            radius: 9,
          ),
      ]);
      if (fix != null && _nav.follow && !identical(_lastFix, fix)) {
        _lastFix = fix;
        await map.camera.moveTo(
          fix.point,
          zoom: 17,
          bearing: fix.speed > 1 ? fix.heading : 0,
        );
      }
    } catch (_) {
      // Drawing is best effort; guidance keeps running without it.
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = MapsStrings(widget.config.language);
    return Stack(
      children: [
        Positioned.fill(
          child: KundeMapView(
            config: widget.config,
            dark: widget.dark,
            initialCenter: _nav.progress.route.points.first,
            initialZoom: 14,
            onReady: (map) {
              _map = map;
              _paint();
            },
            onGestureStart: () {
              if (_nav.follow) {
                _nav.follow = false;
                setState(() {});
              }
            },
          ),
        ),
        Positioned(
          left: 12,
          right: 12,
          bottom: 12,
          child: SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (!_nav.follow && _nav.position != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: FloatingActionButton.small(
                      heroTag: null,
                      tooltip: s('recenter'),
                      onPressed: () {
                        _nav.follow = true;
                        _lastFix = null;
                        setState(() {});
                        _sync();
                      },
                      child: const Icon(Icons.my_location),
                    ),
                  ),
                NavigationHud(controller: _nav, onStop: widget.onStop),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
