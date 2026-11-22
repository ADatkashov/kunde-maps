import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:maplibre_gl/maplibre_gl.dart' as map;
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core/diagnostics.dart';
import 'core/platform_api.dart';
import 'core/strings.dart';
import 'features/location.dart';

import 'features/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(KundeMaps(await SharedPreferences.getInstance()));
}

class KundeMaps extends StatefulWidget {
  const KundeMaps(this.prefs, {super.key});
  final SharedPreferences prefs;

  @override
  State<KundeMaps> createState() => _KundeMapsState();
}

class _KundeMapsState extends State<KundeMaps> {
  void refresh() => setState(() {});

  ThemeData theme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final scheme =
        ColorScheme.fromSeed(
          seedColor: const Color(0xff2563eb),
          brightness: brightness,
        ).copyWith(
          primary: Color(dark ? 0xff7da6ff : 0xff2563eb),
          onPrimary: Color(dark ? 0xff0d1015 : 0xffffffff),
          surface: Color(dark ? 0xff161a21 : 0xffffffff),
          onSurface: Color(dark ? 0xfff1f4f9 : 0xff0e1420),
          surfaceContainerHighest: Color(dark ? 0xff1e232c : 0xffeef1f6),
        );
    return ThemeData(colorScheme: scheme, useMaterial3: true);
  }

  @override
  Widget build(BuildContext context) {
    final prefs = widget.prefs;
    final language =
        prefs.getString('language') ??
        WidgetsBinding.instance.platformDispatcher.locale.languageCode;
    final locale = ['ru', 'kk', 'en'].contains(language) ? language : 'ru';
    return MaterialApp(
      title: 'KUNDE Maps',
      theme: theme(Brightness.light),
      darkTheme: theme(Brightness.dark),
      themeMode: ThemeMode.values.byName(prefs.getString('theme') ?? 'system'),
      locale: Locale(locale),
      supportedLocales: const [Locale('ru'), Locale('kk'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      home: MapHome(prefs, Words(locale), refresh),
    );
  }
}

class MapHome extends StatefulWidget {
  const MapHome(this.prefs, this.words, this.refresh, {super.key});
  final SharedPreferences prefs;
  final Words words;
  final VoidCallback refresh;

  @override
  State<MapHome> createState() => _MapHomeState();
}

class _MapHomeState extends State<MapHome> {
  final _http = http.Client();
  late final _api = PlatformApi(_http);
  final _query = TextEditingController();
  final _routeSheet = DraggableScrollableController();
  final _favorites = <String, Place>{};
  final _camera = const map.CameraPosition(
    target: map.LatLng(48.1, 67.8),
    zoom: 4.4,
  );
  late Point _center = Point(_camera.target.latitude, _camera.target.longitude);
  map.MapLibreMapController? _map;
  String? _styleKey;
  String? _style;
  List<String> _categories = [];
  List<Place> _results = [];
  Place? _selected;
  Place? _origin;
  Place? _destination;
  Point? _gps;
  String? _category;
  String? _error;
  String? _mapError;
  String _mode = 'car';
  int _tab = 0;
  int? _endpoint;
  bool _picking = false;
  bool _loading = false;
  bool _waking = false;
  late bool _showMapPois = widget.prefs.getBool('mapPoi') ?? true;
  bool _mapReady = false;
  bool _tileRenderReady = false;
  bool _painting = false;
  bool _repaintPending = false;
  int _request = 0;
  int _detail = 0;
  Timer? _debounce;
  Timer? _mapTimeout;
  Completer<void>? _abortSearch;
  final _pins = <map.Circle, Place>{};
  List<RoadRoute> _routes = [];
  int _routeIndex = 0;
  NavigationSession? _session;
  bool _starting = false;
  RoadRoute? _lastPaintedRoute;
  LocationFix? _lastFollowedFix;
  Words get w => widget.words;
  RoadRoute? get _route => _routes.isEmpty ? null : _routes[_routeIndex];
  bool get _navigating => _session?.active ?? false;
  bool get _miles => widget.prefs.getBool('miles') ?? false;

  @override
  void initState() {
    super.initState();
    for (final item in widget.prefs.getStringList('favorites') ?? []) {
      try {
        final place = Place(jsonDecode(item) as Json);
        _favorites[place.key] = place;
      } catch (_) {
        continue;
      }
    }
    unawaited(_loadCategories());
    unawaited(_api.warmUp());
  }

  Future<void> _loadCategories() async {
    try {
      final categories = await _api.categories();
      if (mounted) setState(() => _categories = categories);
    } catch (_) {
      // The nearby action remains available if the category service is warming up.
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncStyle();
  }

  void _syncStyle() {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final key = '$dark/${w.language}/$_showMapPois';
    if (_styleKey != key) {
      _styleKey = key;
      unawaited(_loadStyle(dark, key));
    }
  }

  Future<void> _loadStyle(bool dark, String key) async {
    try {
      final style = await nativeStyle(
        mapsConfig,
        dark,
        w.language,
        showPoi: _showMapPois,
      );
      if (!mounted || _styleKey != key) return;
      setState(() {
        _style = style;
        _mapReady = false;
        _tileRenderReady = false;
        _mapError = null;
      });
      _mapTimeout?.cancel();
      _mapTimeout = Timer(const Duration(seconds: 20), () {
        if (mounted && !_tileRenderReady) setState(() => _mapError = 'service');
      });
    } catch (_) {
      if (mounted) setState(() => _mapError = 'invalid');
    }
  }

  String _problem(Object error) => error is ApiFailure ? error.code : 'invalid';

  void _cancelSearch() {
    _debounce?.cancel();
    _abortSearch?.complete();
    _abortSearch = null;
  }

  void _search(String input) {
    _cancelSearch();
    final token = ++_request;
    final value = input.trim();
    setState(() {
      _results = [];
      _selected = null;
      _category = null;
      _error = null;
      _loading = value.length >= 2;
    });
    _redraw();
    if (value.length < 2) return;
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      final abort = Completer<void>();
      _abortSearch = abort;
      await _loadPlaces(
        token,
        () => _api.search(value, w.language, _center, abort.future),
      );
    });
  }

  Future<void> _loadPlaces(
    int token,
    Future<List<Place>> Function() operation,
  ) async {
    try {
      final places = await operation();
      if (!mounted || token != _request) return;
      setState(() {
        _results = places;
        _error = places.isEmpty ? 'empty' : null;
      });
      _redraw();
    } catch (error) {
      if (mounted && token == _request) {
        setState(() => _error = _problem(error));
      }
    } finally {
      if (mounted && token == _request) setState(() => _loading = false);
    }
  }

  Future<void> _nearby(String? category, {bool fromDevice = false}) async {
    _cancelSearch();
    final token = ++_request;
    _query.clear();
    setState(() {
      _category = category;
      _selected = null;
      _error = null;
      _loading = true;
    });
    final location = fromDevice ? await _locate() : null;
    if (!mounted || token != _request) return;
    unawaited(
      _loadPlaces(
        token,
        () => _api.nearby(location?.point ?? _gps ?? _center, category),
      ),
    );
    if (_categories.isEmpty) unawaited(_loadCategories());
  }

  String _name(Place p) =>
      p.name(w.language, w(p.data['category'] as String? ?? 'place'));
  map.LatLng _latLng(Point point) => map.LatLng(point.lat, point.lon);
  Place _coordinate(Point point, [String? name]) =>
      Place({'lat': point.lat, 'lon': point.lon, 'name': ?name});

  Future<void> _select(Place place) async {
    FocusScope.of(context).unfocus();
    final endpoint = _endpoint;
    if (endpoint != null) {
      _setEndpoint(endpoint, place);
      return;
    }
    final token = ++_detail;
    setState(() {
      _selected = place;
      _tab = 0;
    });
    unawaited(_move(place.point, 15));
    _redraw();
    final id = place.osmId;
    if (id == null) return;
    try {
      final detailed = await _api.details(id);
      if (mounted && token == _detail && _selected?.osmId == id) {
        setState(() => _selected = Place({...place.data, ...detailed.data}));
      }
    } catch (_) {
      // Keep the real search result available when details cannot be fetched.
    }
  }

  Future<void> _move(Point point, double zoom, {double bearing = 0}) async {
    try {
      await _map?.animateCamera(
        map.CameraUpdate.newCameraPosition(
          map.CameraPosition(
            target: _latLng(point),
            zoom: zoom,
            bearing: bearing,
          ),
        ),
      );
    } catch (_) {
      // A style transition can briefly invalidate the platform camera.
    }
  }

  Future<Place?> _locate() async {
    try {
      final access = await locationAccess();
      diagnostics.set('gps', access.name);
      if (access != GpsAccess.ok) {
        if (mounted) {
          _toast(w(access == GpsAccess.serviceOff ? 'gpsOff' : 'gpsDenied'));
        }
        return null;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          timeLimit: Duration(seconds: 15),
        ),
      );
      final point = Point.parse(position.latitude, position.longitude);
      if (!mounted) return null;
      diagnostics.set('gps', 'fix±${position.accuracy.round()}m');
      setState(() => _gps = point);
      unawaited(_move(point, 15));
      _redraw();
      return _coordinate(point, w('locate'));
    } catch (_) {
      diagnostics.set('gps', 'no-fix');
      if (mounted) _toast(w('gpsWeak'));
      return null;
    }
  }

  void _setEndpoint(int index, Place place) {
    _cancelSearch();
    _request++;
    _query.clear();
    setState(() {
      if (index == 0) {
        _origin = place;
      } else {
        _destination = place;
      }
      _endpoint = null;
      _picking = false;
      _tab = 1;
      _routes = [];
      _results = [];
      _loading = false;
      _error = null;
    });
    _redraw();
  }

  Future<void> _buildRoute() async {
    final origin = _origin;
    final destination = _destination;
    if (origin == null || destination == null) return;
    final token = ++_request;
    setState(() {
      _loading = true;
      _waking = false;
      _error = null;
      _routes = [];
    });
    _redraw();
    diagnostics.setAll({'error': null, 'rendered': null, 'source': null});
    try {
      final routes = await _api.route(
        origin.point,
        destination.point,
        _mode,
        w.language,
        alternatives: true,
        cancelled: () => !mounted || token != _request,
        onSlow: () {
          if (mounted && token == _request && !_waking) {
            setState(() => _waking = true);
          }
        },
      );
      if (!mounted || token != _request) return;
      setState(() {
        _routes = routes;
        _routeIndex = 0;
      });
      _redraw();
      if (_routeSheet.isAttached) {
        _routeSheet.jumpTo(.43);
      }
      await _fit(routes.first);
      unawaited(_verifyRoute(routes.first));
    } catch (error) {
      if (mounted && token == _request) {
        final code = _problem(error);
        debugPrint('KUNDE route: $code');
        diagnostics.set('error', code);
        setState(() => _error = code);
      }
    } finally {
      if (mounted && token == _request) {
        setState(() {
          _loading = false;
          _waking = false;
        });
      }
    }
  }

  /// Proves the road line is on the map instead of assuming it: asks the
  /// native map which features of the route layer it actually rendered. A
  /// missed paint is repeated; a line that still is not rendered is reported.
  Future<void> _verifyRoute(RoadRoute route) async {
    for (var attempt = 0; attempt < 4; attempt++) {
      await Future<void>.delayed(Duration(milliseconds: 600 + attempt * 600));
      final controller = _map;
      if (!mounted || controller == null || !identical(_route, route)) return;
      if (!_mapReady) continue;
      try {
        final size = MediaQuery.sizeOf(context);
        final scale = MediaQuery.devicePixelRatioOf(context);
        final source = await controller.querySourceFeatures(
          routeSourceId,
          null,
          null,
        );
        final rendered = await controller.queryRenderedFeaturesInRect(
          Rect.fromLTWH(0, 0, size.width * scale, size.height * scale),
          [primaryRouteLayerId],
          null,
        );
        diagnostics.setAll({
          'source': source.length,
          'rendered': rendered.length,
          'map': 'style+route',
        });
        if (rendered.isNotEmpty) {
          if (_error == 'routeRender') setState(() => _error = null);
          return;
        }
      } catch (error) {
        diagnostics.set('map', 'query-failed');
      }
      _lastPaintedRoute = null;
      _redraw();
    }
    if (mounted && identical(_route, route)) {
      debugPrint('KUNDE route: line not rendered');
      diagnostics.set('error', 'routeRender');
      setState(() => _error = 'routeRender');
    }
  }

  Future<void> _fit(RoadRoute route) async {
    var south = 90.0, north = -90.0, west = 180.0, east = -180.0;
    for (final p in route.points) {
      if (p.lat < south) south = p.lat;
      if (p.lat > north) north = p.lat;
      if (p.lon < west) west = p.lon;
      if (p.lon > east) east = p.lon;
    }
    final bounds = map.LatLngBounds(
      southwest: map.LatLng(south - .00001, west - .00001),
      northeast: map.LatLng(north + .00001, east + .00001),
    );
    final height = context.size?.height ?? MediaQuery.sizeOf(context).height;
    try {
      await _map?.animateCamera(
        map.CameraUpdate.newLatLngBounds(
          bounds,
          left: 32,
          right: 32,
          top: (MediaQuery.paddingOf(context).top + 60).clamp(0, height * .24),
          bottom: height * .49,
        ),
      );
    } catch (_) {
      debugPrint('KUNDE route: camera fit failed');
    }
  }

  Future<void> _start() async {
    if (_starting || _route == null || _destination == null) return;
    _end();
    final session = NavigationSession(
      _api,
      w,
      _mode,
      _destination!.point,
      _route!,
    );
    _session = session;
    session.voice = widget.prefs.getBool('voice') ?? true;
    session.addListener(_sessionChanged);
    setState(() => _starting = true);
    var allowed = false;
    try {
      allowed = await session.start();
    } catch (_) {
      allowed = false;
    }
    if (!mounted || _session != session) return;
    setState(() {
      _starting = false;
      if (allowed) _tab = 2;
    });
    if (!allowed) {
      _end();
      _toast(w('gps'));
    }
  }

  void _sessionChanged() {
    if (!mounted) return;
    final session = _session!;
    final fix = session.position;
    final road = session.progress.route;
    setState(() {
      if (fix != null) _gps = Point(fix.latitude, fix.longitude);
      if (!session.active) _gps = null;
      if (session.active && !identical(_route, road)) {
        _routes = [road];
        _routeIndex = 0;
      }
    });
    if (session.follow && fix != null && !identical(fix, _lastFollowedFix)) {
      _lastFollowedFix = fix;
      final heading =
          fix.heading.isFinite && fix.heading >= 0 && fix.speed > 1.5
          ? fix.heading
          : 0.0;
      unawaited(_move(_gps!, 16, bearing: heading));
    }
    _redraw();
  }

  void _end() {
    _session?.dispose();
    _session = null;
    _lastFollowedFix = null;
    _gps = null;
    if (mounted) setState(() => _starting = false);
    _redraw();
  }

  void _redraw() {
    _repaintPending = true;
    if (_painting || !_mapReady || _map == null) return;
    unawaited(_paint());
  }

  Future<void> _paint() async {
    _painting = true;
    try {
      while (mounted && _repaintPending && _mapReady && _map != null) {
        _repaintPending = false;
        final controller = _map!;
        final chosen = _route;
        if (!identical(_lastPaintedRoute, chosen)) {
          await controller.setGeoJsonSource(
            routeSourceId,
            routeFeatures(_routes, chosen),
          );
          _lastPaintedRoute = chosen;
          diagnostics.set('painted', chosen?.points.length ?? 0);
        }
        await controller.clearCircles();
        _pins.clear();
        final poi = _navigating ? <Place>[] : _results;
        final points = [
          for (final place in poi) (place.point, '#2563EB', 5.0),
          if (_selected != null && _tab == 0)
            (_selected!.point, '#2563EB', 9.0),
          if (_origin != null && _tab != 0) (_origin!.point, '#16A34A', 7.0),
          if (_destination != null && _tab != 0)
            (_destination!.point, '#DC2626', 8.0),
          if (_gps != null) (_gps!, '#0EA5E9', 9.0),
        ];
        if (points.isEmpty) continue;
        final circles = await controller.addCircles(
          points
              .map(
                (entry) => map.CircleOptions(
                  geometry: _latLng(entry.$1),
                  circleColor: entry.$2,
                  circleRadius: entry.$3,
                  circleStrokeColor: '#FFFFFF',
                  circleStrokeWidth: 2,
                ),
              )
              .toList(),
        );
        for (var i = 0; i < poi.length && i < circles.length; i++) {
          _pins[circles[i]] = poi[i];
        }
      }
    } catch (_) {
      _lastPaintedRoute = null;
      if (mounted && _mapReady && _route != null) {
        debugPrint('KUNDE route: map render failed');
        setState(() => _error = 'routeRender');
      }
    } finally {
      _painting = false;
      if (_repaintPending) _redraw();
    }
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  void _tabTo(int index) {
    _cancelSearch();
    _request++;
    _query.clear();
    setState(() {
      _tab = index;
      _endpoint = null;
      _picking = false;
      _loading = false;
      _error = null;
      _results = [];
    });
    _redraw();
  }

  String _distance(double meters) {
    if (_miles) {
      if (meters < 250) return '${(meters * 3.28084).round()} ${w('ft')}';
      return '${(meters / 1609.344).toStringAsFixed(1)} ${w('mi')}';
    }
    if (meters < 1000) return '${meters.round()} ${w('m')}';
    return '${(meters / 1000).toStringAsFixed(1)} ${w('km')}';
  }

  String _duration(double seconds) =>
      '${(seconds / 60).ceil()} ${w('minutes')}';

  Widget _resultsList(List<Place> places) => Column(
    children: [
      for (final place in places)
        ListTile(
          leading: const Icon(Icons.place_outlined),
          title: Text(_name(place)),
          subtitle:
              place.data['address'] == null && place.data['locality'] == null
              ? null
              : Text('${place.data['address'] ?? place.data['locality']}'),
          onTap: () => _select(place),
        ),
    ],
  );

  Widget _placeCard(Place place) {
    final saved = _favorites.containsKey(place.key);
    final id = place.osmId;
    final link = secureUrl(webUrl).replace(
      fragment: Uri(
        queryParameters: {
          'lat': '${place.point.lat}',
          'lng': '${place.point.lon}',
          'name': _name(place),
          'poi': ?id,
        },
      ).query,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            _name(place),
            style: Theme.of(context).textTheme.headlineSmall
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          subtitle: place.data['category'] == null
              ? null
              : Text(w('${place.data['category']}')),
          trailing: IconButton(
            icon: const Icon(Icons.close),
            tooltip: w('close'),
            onPressed: () {
              setState(() => _selected = null);
              _redraw();
            },
          ),
        ),
        for (final (field, icon) in [
          ('address', Icons.place_outlined),
          ('locality', Icons.location_city_outlined),
          ('hours', Icons.schedule_outlined),
          ('phone', Icons.phone_outlined),
          ('website', Icons.language),
        ])
          if (place.data[field] case final String value when value.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    icon,
                    size: 19,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(width: 9),
                  Expanded(child: Text(value)),
                ],
              ),
            ),
        if (place.data['distance_m'] is num)
          Text(_distance((place.data['distance_m'] as num).toDouble())),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          children: [
            FilledButton.icon(
              onPressed: () => _setEndpoint(1, place),
              icon: const Icon(Icons.directions_outlined),
              label: Text(w('directions')),
            ),
            IconButton(
              tooltip: w(saved ? 'remove' : 'save'),
              icon: Icon(saved ? Icons.bookmark : Icons.bookmark_outline),
              onPressed: () {
                setState(() {
                  if (saved) {
                    _favorites.remove(place.key);
                  } else {
                    _favorites[place.key] = place;
                  }
                });
                unawaited(
                  widget.prefs.setStringList(
                    'favorites',
                    _favorites.values.map((p) => jsonEncode(p.data)).toList(),
                  ),
                );
              },
            ),
            Builder(
              builder: (buttonContext) => IconButton(
                tooltip: w('share'),
                icon: const Icon(Icons.ios_share),
                onPressed: () {
                  final box = buttonContext.findRenderObject() as RenderBox;
                  unawaited(
                    SharePlus.instance.share(
                      ShareParams(
                        uri: link,
                        sharePositionOrigin:
                            box.localToGlobal(Offset.zero) & box.size,
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _chooseEndpoint(int index) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (key, icon) in [
              ('search', Icons.search),
              ('pick', Icons.pin_drop_outlined),
              ('locate', Icons.my_location),
            ])
              ListTile(
                leading: Icon(icon),
                title: Text(w(key)),
                onTap: () => Navigator.pop(context, key),
              ),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    if (choice == 'locate') {
      final place = await _locate();
      if (place != null && mounted && !_navigating) _setEndpoint(index, place);
    } else {
      setState(() {
        _endpoint = index;
        _picking = choice == 'pick';
        _selected = null;
        _tab = _picking ? 1 : 0;
        _results = [];
        _error = null;
        _loading = false;
      });
      _redraw();
    }
  }

  Widget _diagnosticsPanel() => ListenableBuilder(
    listenable: diagnostics,
    builder: (context, _) => Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Text(
        'DEV · ${diagnostics.values.entries.map((e) => '${e.key}=${e.value}').join(' · ')}',
        key: const ValueKey('diagnostics'),
        style: Theme.of(context).textTheme.labelSmall,
      ),
    ),
  );

  Widget _planner() {
    final route = _route;
    final estimatedArrival = route == null
        ? null
        : TimeOfDay.fromDateTime(
            DateTime.now().add(Duration(seconds: route.seconds.round())),
          ).format(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (route != null) ...[
          DecoratedBox(
            decoration: BoxDecoration(
              color: colors.primaryContainer,
              borderRadius: BorderRadius.circular(17),
            ),
            child: Padding(
              padding: const EdgeInsets.all(13),
              child: Row(
                children: [
                  Icon(Icons.alt_route, color: colors.onPrimaryContainer),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${_distance(route.meters)} · ${_duration(route.seconds)}',
                          style: theme.textTheme.titleLarge?.copyWith(
                            color: colors.onPrimaryContainer,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          '${w('arrivalTime')} $estimatedArrival · ${w('traffic')}',
                          style: TextStyle(color: colors.onPrimaryContainer),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_routes.length > 1)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final (index, option) in _routes.indexed)
                    Padding(
                      padding: const EdgeInsets.only(right: 8, top: 3),
                      child: ChoiceChip(
                        label: Text(
                          '${_distance(option.meters)} · ${_duration(option.seconds)}',
                        ),
                        selected: index == _routeIndex,
                        onSelected: (selected) {
                          if (!selected) return;
                          setState(() => _routeIndex = index);
                          _redraw();
                          unawaited(_fit(option));
                        },
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 8),
        ],
        Material(
          color: colors.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(17),
          clipBehavior: Clip.antiAlias,
          child: Row(
            children: [
              Expanded(
                child: Column(
                  children: [
                    for (final (index, key, place) in [
                      (0, 'origin', _origin),
                      (1, 'destination', _destination),
                    ]) ...[
                      if (index == 1) const Divider(height: 1, indent: 44),
                      ListTile(
                        dense: true,
                        contentPadding: const EdgeInsets.only(
                          left: 10,
                          right: 4,
                        ),
                        leading: CircleAvatar(
                          radius: 13,
                          backgroundColor: index == 0
                              ? colors.primary
                              : colors.tertiary,
                          foregroundColor: index == 0
                              ? colors.onPrimary
                              : colors.onTertiary,
                          child: Text(index == 0 ? 'A' : 'B'),
                        ),
                        title: Text(w(key), style: theme.textTheme.labelMedium),
                        subtitle: place == null
                            ? null
                            : Text(
                                _name(place),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                        onTap: () => _chooseEndpoint(index),
                      ),
                    ],
                  ],
                ),
              ),
              IconButton(
                tooltip: w('swap'),
                icon: const Icon(Icons.swap_vert),
                onPressed: _origin == null || _destination == null
                    ? null
                    : () {
                        _request++;
                        setState(() {
                          final previousOrigin = _origin;
                          _origin = _destination;
                          _destination = previousOrigin;
                          _routes = [];
                          _loading = false;
                          _error = null;
                        });
                        _redraw();
                      },
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        SegmentedButton<String>(
          showSelectedIcon: false,
          segments: [
            for (final (mode, icon) in [
              ('car', Icons.directions_car_outlined),
              ('foot', Icons.directions_walk),
              ('bike', Icons.directions_bike),
            ])
              ButtonSegment(
                value: mode,
                icon: Icon(icon, size: 17),
                label: Text(w(mode)),
              ),
          ],
          selected: {_mode},
          onSelectionChanged: (selected) {
            if (selected.single == _mode) return;
            _request++;
            setState(() {
              _mode = selected.single;
              _routes = [];
              _loading = false;
              _error = null;
            });
            _redraw();
          },
        ),
        if (route != null)
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(w('directions')),
            children: [
              for (final step in route.steps)
                ListTile(
                  title: Text(step.instruction),
                  subtitle: route.language == w.language
                      ? null
                      : Text(route.language.toUpperCase()),
                ),
            ],
          ),
      ],
    );
  }

  Future<void> _preference(String key, String value) async {
    await widget.prefs.setString(key, value);
    if (mounted) widget.refresh();
  }

  Widget _profile() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      ListTile(
        title: Text(w('language')),
        trailing: DropdownButton<String>(
          value: w.language,
          items: [
            for (final (value, label) in [
              ('ru', 'Русский'),
              ('kk', 'Қазақша'),
              ('en', 'English'),
            ])
              DropdownMenuItem(value: value, child: Text(label)),
          ],
          onChanged: (value) {
            if (value != null) _preference('language', value);
          },
        ),
      ),
      ListTile(
        title: Text(w('theme')),
        trailing: DropdownButton<String>(
          value: widget.prefs.getString('theme') ?? 'system',
          items: ['system', 'light', 'dark']
              .map(
                (value) =>
                    DropdownMenuItem(value: value, child: Text(w(value))),
              )
              .toList(),
          onChanged: (value) {
            if (value != null) _preference('theme', value);
          },
        ),
      ),
      SwitchListTile(
        title: Text(w('units')),
        subtitle: Text(w(_miles ? 'mi' : 'km')),
        value: _miles,
        onChanged: (value) async {
          await widget.prefs.setBool('miles', value);
          if (mounted) setState(() {});
        },
      ),
      SwitchListTile(
        title: Text(w('voice')),
        value: widget.prefs.getBool('voice') ?? true,
        onChanged: (value) async {
          await widget.prefs.setBool('voice', value);
          if (mounted) setState(() {});
        },
      ),
      ListTile(
        title: Text(w('permissions')),
        leading: const Icon(Icons.settings_outlined),
        onTap: Geolocator.openAppSettings,
      ),
      Padding(padding: const EdgeInsets.all(12), child: Text(w('privacy'))),
      ListTile(
        title: const Text('KUNDE Maps'),
        onTap: () {
          showLicensePage(
            context: context,
            applicationName: 'KUNDE Maps',
            applicationVersion: '0.6.1',
          );
        },
      ),
    ],
  );

  Widget _navigation() {
    final session = _session;
    if (session == null ||
        (!session.active && !session.arrived && session.issue == null)) {
      return FilledButton(
        onPressed: _starting
            ? null
            : _route == null
            ? () => _tabTo(1)
            : _start,
        child: Text(w(_route == null ? 'build' : 'start')),
      );
    }
    final progress = session.progress;
    final eta = TimeOfDay.fromDateTime(
      DateTime.now().add(Duration(seconds: progress.remainingSeconds.round())),
    ).format(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(w(session.status), style: Theme.of(context).textTheme.titleMedium),
        if (session.active) ...[
          Text(
            '${_distance(progress.remainingMeters)}  ·  ${_duration(progress.remainingSeconds)}  ·  $eta',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          Text(w('traffic'), style: Theme.of(context).textTheme.bodySmall),
        ],
        if (session.voiceUnavailable) Text(w('noVoice')),
        if (session.notificationsDisabled) Text(w('notificationsOff')),
      ],
    );
  }

  Widget _navigationActions(NavigationSession session) {
    return Wrap(
      spacing: 10,
      children: [
        OutlinedButton(
          onPressed: _end,
          child: Text(w(session.active ? 'stop' : 'close')),
        ),
        if (session.active && session.issue != null)
          TextButton(
            onPressed: session.canRetry ? session.retry : null,
            child: Text(w('retry')),
          ),
        if (session.active)
          IconButton(
            tooltip: w('voice'),
            icon: Icon(session.voice ? Icons.volume_up : Icons.volume_off),
            onPressed: () => session.setVoice(!session.voice),
          ),
      ],
    );
  }

  Widget _attribution() => Wrap(
    children: [
      for (final (host, path, label) in [
        ('www.openstreetmap.org', '/copyright', '© OpenStreetMap contributors'),
        ('openmaptiles.org', '/', '© OpenMapTiles'),
      ])
        TextButton(
          style: TextButton.styleFrom(
            padding: const EdgeInsets.symmetric(horizontal: 4),
          ),
          onPressed: () => launchUrl(
            Uri.https(host, path),
            mode: LaunchMode.externalApplication,
          ),
          child: Text(label, style: const TextStyle(fontSize: 11)),
        ),
    ],
  );

  Widget _routeAction() {
    final ready = _route != null;
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        icon: Icon(ready ? Icons.navigation_outlined : Icons.alt_route),
        label: Text(w(ready ? 'start' : 'build')),
        onPressed: ready
            ? (_starting || _loading ? null : _start)
            : (_origin == null || _destination == null || _loading
                  ? null
                  : _buildRoute),
      ),
    );
  }

  Widget _sheet() {
    if (_picking) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        final height = constraints.maxHeight;
        final footer = MediaQuery.textScalerOf(context).scale(11) > 15
            ? 96
            : 48;
        final hasRouteAction = _tab == 1 && !_navigating;
        final navActions = _tab == 2 && _session != null;
        final hasPrimaryAction = hasRouteAction || navActions;
        final minSize = ((footer + (hasPrimaryAction ? 100 : 18)) / height)
            .clamp(.17, .55);
        final half = math.max(.43, minSize + .04);
        final initialSize = _navigating
            ? .31
            : _tab == 0 && _selected == null && _results.isEmpty
            ? .21
            : .43;
        return DraggableScrollableSheet(
          key: ValueKey((
            _tab,
            _navigating,
            _selected != null,
            _tab == 0 && _results.isNotEmpty,
          )),
          controller: hasRouteAction ? _routeSheet : null,
          initialChildSize: math.max(initialSize, minSize),
          snapSizes: [half],
          minChildSize: minSize,
          maxChildSize: height < 450 ? .66 : .78,
          snap: true,
          expand: true,
          builder: (context, controller) => Material(
            color: Theme.of(context).colorScheme.surface,
            surfaceTintColor: Colors.transparent,
            elevation: 14,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                Expanded(
                  child: ListView(
                    controller: controller,
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
                    children: [
                      Center(
                        child: Container(
                          width: 34,
                          height: 4,
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.outlineVariant,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      if (!_navigating && _tab >= 2)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Text(
                            w(
                              [
                                'search',
                                'directions',
                                'nav',
                                'saved',
                                'profile',
                              ][_tab],
                            ),
                            style: Theme.of(context).textTheme.titleLarge
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                        ),
                      if (_loading) const LinearProgressIndicator(),
                      if (_loading && _waking)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(w('wake')),
                        ),
                      if (_error != null)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(w(_error!)),
                          trailing: _error == 'empty'
                              ? null
                              : TextButton(
                                  onPressed: _tab == 1
                                      ? _buildRoute
                                      : () {
                                          if (_query.text.trim().length >= 2) {
                                            _search(_query.text);
                                          } else {
                                            _nearby(_category);
                                          }
                                        },
                                  child: Text(w('retry')),
                                ),
                        ),
                      if (_tab == 0 && _selected != null)
                        _placeCard(_selected!),
                      if (_tab == 0 && _selected == null && _results.isNotEmpty)
                        _resultsList(_results),
                      if (_tab == 0 &&
                          _selected == null &&
                          _results.isEmpty &&
                          !_loading &&
                          _error == null)
                        Wrap(
                          spacing: 6,
                          children: [
                            ActionChip(
                              label: Text(w('near')),
                              onPressed: () => _nearby(null, fromDevice: true),
                            ),
                            ActionChip(
                              label: Text(w('directions')),
                              onPressed: () => _tabTo(1),
                            ),
                            ActionChip(
                              label: Text(w('saved')),
                              onPressed: () => _tabTo(3),
                            ),
                          ],
                        ),
                      if (_tab == 1) _planner(),
                      if (_tab == 1 && showDiagnostics) _diagnosticsPanel(),
                      if (_tab == 2) _navigation(),
                      if (_tab == 3)
                        _favorites.isEmpty
                            ? Text(w('empty'))
                            : _resultsList(_favorites.values.toList()),
                      if (_tab == 4) _profile(),
                    ],
                  ),
                ),
                if (hasPrimaryAction)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                    child: hasRouteAction
                        ? _routeAction()
                        : _navigationActions(_session!),
                  ),
                Padding(
                  padding: EdgeInsets.fromLTRB(
                    16,
                    0,
                    16,
                    _navigating ? MediaQuery.paddingOf(context).bottom : 0,
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: _attribution(),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showLayers() => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              w('layers'),
              style: Theme.of(sheetContext).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                for (final name in ['system', 'light', 'dark'])
                  ChoiceChip(
                    label: Text(w(name)),
                    selected:
                        (widget.prefs.getString('theme') ?? 'system') == name,
                    onSelected: (selected) {
                      if (!selected) return;
                      Navigator.pop(sheetContext);
                      unawaited(_preference('theme', name));
                    },
                  ),
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(w('mapPoi')),
              value: _showMapPois,
              onChanged: (value) {
                Navigator.pop(sheetContext);
                _showMapPois = value;
                unawaited(widget.prefs.setBool('mapPoi', value));
                _syncStyle();
              },
            ),
          ],
        ),
      ),
    ),
  );

  Widget _mapTool(IconData icon, String label, VoidCallback action) => Material(
    color: Theme.of(context).colorScheme.surface,
    elevation: 4,
    borderRadius: BorderRadius.circular(15),
    child: IconButton(icon: Icon(icon), tooltip: w(label), onPressed: action),
  );

  Widget _top() {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final session = _session;
    if (_navigating && session != null) {
      final next = session.progress.nextStep;
      final step = next == null ? null : session.progress.route.steps[next];
      final key = step == null ? null : session.instructionKey(step);
      final icon = switch (key) {
        'right' => Icons.turn_right,
        'left' => Icons.turn_left,
        'uturn' => Icons.u_turn_left,
        'destinationAhead' => Icons.flag_outlined,
        _ => Icons.navigation,
      };
      return Material(
        color: const Color(0xff172747),
        elevation: 8,
        borderRadius: BorderRadius.circular(23),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: const Color(0xff2563eb),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Icon(icon, color: Colors.white, size: 32),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _distance(session.progress.maneuverMeters),
                      style: theme.textTheme.headlineSmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      step == null
                          ? w(session.status)
                          : session.instruction(step),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (step != null && (step.street?.isNotEmpty ?? false))
                      Text(
                        step.street!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Color(0xffc0cfe9)),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Material(
          color: colors.surface,
          elevation: 4,
          borderRadius: BorderRadius.circular(19),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
            child: Row(
              children: [
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: const Color(0xff2563eb),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Padding(
                    padding: EdgeInsets.all(8),
                    child: Icon(Icons.explore, color: Colors.white, size: 20),
                  ),
                ),
                const SizedBox(width: 9),
                if (_tab != 0)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      child: Text(
                        _picking ? w('tap') : 'KUNDE Maps',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  )
                else
                  Expanded(
                    child: TextField(
                      controller: _query,
                      maxLength: 100,
                      onChanged: _search,
                      decoration: InputDecoration(
                        contentPadding: const EdgeInsets.symmetric(
                          vertical: 10,
                        ),
                        border: InputBorder.none,
                        counterText: '',
                        hintText: w(
                          _endpoint == null
                              ? 'hint'
                              : _endpoint == 0
                              ? 'origin'
                              : 'destination',
                        ),
                        suffixIcon: IconButton(
                          tooltip: w('close'),
                          icon: const Icon(Icons.close),
                          onPressed: () {
                            if (_endpoint != null) {
                              _tabTo(1);
                            } else {
                              _query.clear();
                              _search('');
                            }
                          },
                        ),
                      ),
                    ),
                  ),
                if (_picking)
                  IconButton(
                    tooltip: w('close'),
                    onPressed: () => _tabTo(1),
                    icon: const Icon(Icons.close),
                  ),
              ],
            ),
          ),
        ),
        if (_tab == 0 &&
            _endpoint == null &&
            MediaQuery.viewInsetsOf(context).bottom == 0) ...[
          const SizedBox(height: 7),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                ActionChip(
                  backgroundColor: colors.surface,
                  avatar: Icon(
                    Icons.near_me_outlined,
                    size: 17,
                    color: colors.primary,
                  ),
                  label: Text(w('near')),
                  onPressed: () => _nearby(null, fromDevice: true),
                ),
                for (final category in _categories)
                  Padding(
                    padding: const EdgeInsets.only(left: 7),
                    child: ChoiceChip(
                      backgroundColor: colors.surface,
                      label: Text(w(category)),
                      selected: _category == category,
                      onSelected: (selected) =>
                          _nearby(selected ? category : null),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: _style == null
                ? const Center(child: CircularProgressIndicator())
                : map.MapLibreMap(
                    initialCameraPosition: _camera,
                    styleString: _style!,
                    trackCameraPosition: true,
                    attributionEnabled: false,
                    dragEnabled: false,
                    featureTapsTriggersMapClick: _picking,
                    compassEnabled: false,
                    onMapCreated: (controller) {
                      _map = controller;
                      controller.onCircleTapped.add((circle) {
                        final place = _pins[circle];
                        if (place != null && !_picking) {
                          unawaited(_select(place));
                        }
                      });
                    },
                    onStyleLoadedCallback: () {
                      diagnostics.set('map', 'style-loaded');
                      _mapReady = true;
                      _lastPaintedRoute = null;
                      _redraw();
                    },
                    onMapIdle: () {
                      if (!_tileRenderReady && mounted) {
                        _mapTimeout?.cancel();
                        setState(() {
                          _tileRenderReady = true;
                          _mapError = null;
                        });
                        _redraw();
                      }
                    },
                    onCameraIdle: () {
                      final target = _map?.cameraPosition?.target;
                      if (target != null) {
                        _center = Point(target.latitude, target.longitude);
                      }
                    },
                    onCameraMoveStarted: (reason) {
                      if (reason == map.CameraMoveReason.gesture &&
                          _session != null) {
                        _session!.follow = false;
                      }
                    },
                    onMapClick: (_, coordinate) {
                      if (_picking && _endpoint != null) {
                        _setEndpoint(
                          _endpoint!,
                          _coordinate(
                            Point(coordinate.latitude, coordinate.longitude),
                          ),
                        );
                      }
                    },
                  ),
          ),
          Positioned(
            top: MediaQuery.paddingOf(context).top + 8,
            left: 12,
            right: 12,
            child: _top(),
          ),
          if (_mapError != null)
            Positioned(
              top: MediaQuery.paddingOf(context).top + (_tab == 0 ? 166 : 68),
              left: 12,
              right: 70,
              child: Card(
                child: ListTile(
                  title: Text(w(_mapError!)),
                  trailing: TextButton(
                    onPressed: () {
                      _map?.setStyle(_style ?? '{}');
                      unawaited(
                        _loadStyle(
                          Theme.of(context).brightness == Brightness.dark,
                          _styleKey!,
                        ),
                      );
                    },
                    child: Text(w('retry')),
                  ),
                ),
              ),
            ),
          if (MediaQuery.viewInsetsOf(context).bottom == 0 && !_picking)
            Positioned(
              right: 12,
              top: math.max(
                MediaQuery.paddingOf(context).top + (_tab == 0 ? 120 : 68),
                MediaQuery.sizeOf(context).height * .26,
              ),
              child: Column(
                children: [
                  if (!_navigating) ...[
                    _mapTool(Icons.layers_outlined, 'layers', _showLayers),
                    const SizedBox(height: 8),
                    _mapTool(Icons.explore_outlined, 'north', () {
                      if (_map case final controller?) {
                        unawaited(
                          controller.animateCamera(
                            map.CameraUpdate.bearingTo(0),
                          ),
                        );
                      }
                    }),
                    const SizedBox(height: 8),
                  ],
                  _mapTool(Icons.my_location, 'locate', () {
                    final session = _session;
                    if (session != null && session.active) {
                      session.follow = true;
                      if (_gps != null) unawaited(_move(_gps!, 16));
                    } else {
                      unawaited(_locate());
                    }
                  }),
                ],
              ),
            ),
          if (_picking)
            Positioned(bottom: 0, left: 0, child: Card(child: _attribution())),
          _sheet(),
        ],
      ),
      bottomNavigationBar:
          _navigating || MediaQuery.viewInsetsOf(context).bottom > 0
          ? null
          : NavigationBar(
              height: 62,
              elevation: 6,
              backgroundColor: Theme.of(context).colorScheme.surface,
              selectedIndex: _tab,
              onDestinationSelected: _tabTo,
              labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
              destinations: [
                for (final (key, icon) in [
                  ('search', Icons.search),
                  ('directions', Icons.alt_route),
                  ('nav', Icons.navigation_outlined),
                  ('saved', Icons.bookmark_outline),
                  ('profile', Icons.person_outline),
                ])
                  NavigationDestination(icon: Icon(icon), label: w(key)),
              ],
            ),
    );
  }

  @override
  void dispose() {
    _cancelSearch();
    _mapTimeout?.cancel();
    _session?.dispose();
    _query.dispose();
    _routeSheet.dispose();
    _http.close();
    super.dispose();
  }
}
