import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'config.dart';
import 'geo.dart';
import 'geolocation.dart';
import 'map_view.dart';
import 'place_search_field.dart';
import 'models.dart';
import 'services.dart';
import 'strings.dart';

/// The result of picking: a point and, when it came from search, the place.
class PickedLocation {
  const PickedLocation(this.point, {this.place});

  final GeoPoint point;
  final MapPlace? place;

  /// Human label when the point came from a search result.
  String? label(String language) => place?.name(language, '');
}

/// Pick a point: search, "my location" or move the map under a fixed pin.
/// Returns through [onPicked]; it never decides what the point is used for.
class LocationPicker extends StatefulWidget {
  const LocationPicker({
    super.key,
    required this.config,
    required this.search,
    required this.onPicked,
    this.initial,
    this.geolocation = const Geolocation(),
    this.dark = false,
    this.title,
  });

  final MapsConfig config;
  final PlaceSearch search;
  final void Function(PickedLocation picked) onPicked;
  final GeoPoint? initial;
  final Geolocation geolocation;
  final bool dark;
  final String? title;

  @override
  State<LocationPicker> createState() => _LocationPickerState();
}

class _LocationPickerState extends State<LocationPicker> {
  late GeoPoint _center = widget.initial ?? almaty;
  KundeMapController? _map;
  MapPlace? _place;
  bool _locating = false;
  GpsAccess? _gpsIssue;
  bool _searching = false;

  MapsStrings get _s => MapsStrings(widget.config.language);

  Future<void> _locate() async {
    setState(() {
      _locating = true;
      _gpsIssue = null;
    });
    final access = await widget.geolocation.access();
    GeoPoint? point;
    if (access == GpsAccess.ok) point = await widget.geolocation.currentPoint();
    if (!mounted) return;
    setState(() {
      _locating = false;
      _gpsIssue = point == null && access != GpsAccess.ok ? access : null;
    });
    if (point != null && inKazakhstan(point)) {
      _place = null;
      _center = point;
      await _map?.camera.moveTo(point, zoom: 17);
    }
  }

  Future<void> _choose(MapPlace place) async {
    setState(() {
      _searching = false;
      _place = place;
      _center = place.point;
    });
    await _map?.camera.moveTo(place.point, zoom: 17);
  }

  @override
  Widget build(BuildContext context) {
    final issue = _gpsIssue;
    return Stack(
      children: [
        Positioned.fill(
          child: KundeMapView(
            config: widget.config,
            dark: widget.dark,
            initialCenter: _center,
            initialZoom: widget.initial == null ? 12 : 16,
            onReady: (controller) => _map = controller,
            onCenterChanged: (center) => _center = center,
            onGestureStart: () => _place = null,
          ),
        ),
        const IgnorePointer(
          child: Center(
            child: Padding(
              padding: EdgeInsets.only(bottom: 36),
              child: Icon(Icons.location_on, size: 44, color: Colors.red),
            ),
          ),
        ),
        Positioned(
          left: 12,
          right: 12,
          top: 12,
          child: SafeArea(
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: _searching
                    ? ConstrainedBox(
                        constraints: BoxConstraints(
                          maxHeight: MediaQuery.sizeOf(context).height * .5,
                        ),
                        child: SingleChildScrollView(
                          child: PlaceSearchField(
                            search: widget.search,
                            language: widget.config.language,
                            center: () => _center,
                            autofocus: true,
                            onSelected: _choose,
                          ),
                        ),
                      )
                    : ListTile(
                        leading: const Icon(Icons.search),
                        title: Text(widget.title ?? _s('search')),
                        onTap: () => setState(() => _searching = true),
                      ),
              ),
            ),
          ),
        ),
        Positioned(
          left: 12,
          right: 12,
          bottom: 12,
          child: SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (issue != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        issue == GpsAccess.serviceOff
                            ? _s('gpsOff')
                            : _s('gpsDenied'),
                      ),
                    ),
                  ),
                Align(
                  alignment: Alignment.centerRight,
                  child: FloatingActionButton.small(
                    heroTag: null,
                    tooltip: _s('myLocation'),
                    onPressed: _locating ? null : _locate,
                    child: _locating
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.my_location),
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: () => widget.onPicked(
                    PickedLocation(_place?.point ?? _center, place: _place),
                  ),
                  child: Text(_s('confirm')),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
