import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:maplibre_gl/maplibre_gl.dart' as ml;

import 'camera.dart';
import 'config.dart';
import 'geo.dart';
import 'map_style.dart';
import 'markers.dart';
import 'models.dart';
import 'strings.dart';

/// Almaty city centre, the default camera when the host gives none.
const almaty = GeoPoint(43.2389, 76.8897);

/// Handle given to the host once the style has loaded.
class KundeMapController {
  KundeMapController._(this._map)
    : camera = CameraController(_map),
      markers = MapMarkers(_map);

  final ml.MapLibreMapController _map;
  final CameraController camera;
  final MapMarkers markers;

  /// Draws [routes] (the [selected] one highlighted); pass an empty list to
  /// clear the line.
  Future<void> showRoutes(List<MapRoute> routes, MapRoute? selected) =>
      _map.setGeoJsonSource(routeSourceId, routeFeatures(routes, selected));

  Future<void> clearRoutes() => showRoutes(const [], null);

  /// Switches style (theme/language/POI) while keeping route layers.
  Future<void> setStyle(String style) => _map.setStyle(style);

  void dispose() => markers.dispose();
}

/// The KUNDE map: self-hosted tiles, KUNDE style, RU/KK/EN labels,
/// attribution. It shows no business data; hosts add [MapMarker]s and routes
/// through the [KundeMapController].
class KundeMapView extends StatefulWidget {
  const KundeMapView({
    super.key,
    required this.config,
    this.initialCenter = almaty,
    this.initialZoom = 12,
    this.dark = false,
    this.showPlaces = false,
    this.onReady,
    this.onTap,
    this.onMarkerTap,
    this.onCenterChanged,
    this.onGestureStart,
    this.interactive = true,
  });

  final MapsConfig config;
  final GeoPoint initialCenter;
  final double initialZoom;
  final bool dark;

  /// Draws the tile POIs (shops, cafes). Off keeps task maps clean.
  final bool showPlaces;
  final void Function(KundeMapController controller)? onReady;
  final void Function(GeoPoint point)? onTap;
  final void Function(MapMarker marker)? onMarkerTap;

  /// Called when the camera settles, with its centre.
  final void Function(GeoPoint center)? onCenterChanged;

  /// Called when the user starts moving the map by hand (stop auto-follow).
  final VoidCallback? onGestureStart;
  final bool interactive;

  @override
  State<KundeMapView> createState() => _KundeMapViewState();
}

class _KundeMapViewState extends State<KundeMapView> {
  String? _style;
  Object? _error;
  KundeMapController? _controller;
  ml.MapLibreMapController? _raw;
  bool _ready = false;
  Timer? _timeout;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final style = await nativeStyle(
        widget.config,
        widget.dark,
        widget.config.language,
        showPoi: widget.showPlaces,
      );
      if (!mounted) return;
      setState(() {
        _style = style;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  @override
  void didUpdateWidget(KundeMapView old) {
    super.didUpdateWidget(old);
    if (old.dark != widget.dark ||
        old.showPlaces != widget.showPlaces ||
        old.config.language != widget.config.language) {
      unawaited(_restyle());
    }
  }

  Future<void> _restyle() async {
    try {
      final style = await nativeStyle(
        widget.config,
        widget.dark,
        widget.config.language,
        showPoi: widget.showPlaces,
      );
      await _raw?.setStyle(style);
    } catch (_) {
      // Keep the current style; the map stays usable.
    }
  }

  @override
  void dispose() {
    _timeout?.cancel();
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final strings = MapsStrings(widget.config.language);
    if (_error != null) {
      return Center(child: Text(strings.error('invalid')));
    }
    if (_style == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return Stack(
      children: [
        Positioned.fill(
          child: ml.MapLibreMap(
            initialCameraPosition: ml.CameraPosition(
              target: ml.LatLng(
                widget.initialCenter.lat,
                widget.initialCenter.lon,
              ),
              zoom: widget.initialZoom,
            ),
            styleString: _style!,
            trackCameraPosition: true,
            attributionEnabled: false,
            compassEnabled: false,
            dragEnabled: widget.interactive,
            scrollGesturesEnabled: widget.interactive,
            zoomGesturesEnabled: widget.interactive,
            rotateGesturesEnabled: widget.interactive,
            tiltGesturesEnabled: false,
            onMapCreated: (raw) => _raw = raw,
            onStyleLoadedCallback: () {
              final raw = _raw;
              if (raw == null) return;
              _controller?.dispose();
              final controller = KundeMapController._(raw);
              controller.markers.onTap = widget.onMarkerTap;
              _controller = controller;
              if (!_ready) {
                _ready = true;
                widget.onReady?.call(controller);
              }
            },
            onCameraIdle: () {
              final center = _controller?.camera.center;
              if (center != null) widget.onCenterChanged?.call(center);
            },
            onCameraMoveStarted: (reason) {
              if (reason == ml.CameraMoveReason.gesture) {
                widget.onGestureStart?.call();
              }
            },
            onMapClick: (_, coordinate) => widget.onTap?.call(
              GeoPoint(coordinate.latitude, coordinate.longitude),
            ),
          ),
        ),
        // OSM and OpenMapTiles attribution is a licence obligation (ODbL).
        Positioned(
          left: 8,
          bottom: 4,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.white.withAlpha(200),
              borderRadius: BorderRadius.circular(4),
            ),
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              child: Text(
                '© OpenStreetMap contributors · OpenMapTiles',
                style: TextStyle(fontSize: 10, color: Colors.black87),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
