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

import 'core/platform_api.dart';
import 'core/strings.dart';
import 'features/location.dart';
import 'features/map_style.dart';
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
  Position? _lastFollowedFix;
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    final key = '$dark/${w.language}';
    if (_styleKey != key) {
      _styleKey = key;
      unawaited(_loadStyle(dark, key));
    }
  }

  Future<void> _loadStyle(bool dark, String key) async {
    try {
      final style = await nativeStyle(dark, w.language);
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
      if (!await requestLocation()) throw const ApiFailure('gps');
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          timeLimit: Duration(seconds: 15),
        ),
      );
      final point = Point.parse(position.latitude, position.longitude);
      if (!mounted) return null;
      setState(() => _gps = point);
      unawaited(_move(point, 15));
      _redraw();
      return _coordinate(point, w('locate'));
    } catch (_) {
      if (mounted) _toast(w('gps'));
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
      _error = null;
    });
    try {
      final routes = await _api.route(
        origin.point,
        destination.point,
        _mode,
        w.language,
        alternatives: true,
      );
      if (!mounted || token != _request) return;
      setState(() {
        _routes = routes;
        _routeIndex = 0;
      });
      _redraw();
      unawaited(_fit(routes.first));
    } catch (error) {
      if (mounted && token == _request) {
        final code = _problem(error);
        debugPrint('KUNDE route: $code');
        setState(() => _error = code);
      }
    } finally {
      if (mounted && token == _request) setState(() => _loading = false);
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
            style: Theme.of(context).textTheme.titleLarge,
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
        for (final field in [
          'address',
          'locality',
          'hours',
          'phone',
          'website',
        ])
          if (place.data[field] is String &&
              (place.data[field] as String).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(place.data[field] as String),
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

  Widget _planner() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (final (index, key, place) in [
        (0, 'origin', _origin),
        (1, 'destination', _destination),
      ])
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(index == 0 ? Icons.trip_origin : Icons.place_outlined),
          title: Text(place == null ? w(key) : _name(place)),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _chooseEndpoint(index),
        ),
      Wrap(
        spacing: 6,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
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
          for (final mode in ['car', 'foot', 'bike'])
            ChoiceChip(
              label: Text(w(mode)),
              selected: _mode == mode,
              onSelected: (chosen) {
                if (!chosen) return;
                _request++;
                setState(() {
                  _mode = mode;
                  _routes = [];
                  _loading = false;
                  _error = null;
                });
                _redraw();
              },
            ),
        ],
      ),
      const SizedBox(height: 10),
      FilledButton(
        onPressed: _origin == null || _destination == null || _loading
            ? null
            : _buildRoute,
        child: Text(w('build')),
      ),
      if (_route != null) ...[
        const SizedBox(height: 8),
        Text(w('traffic'), style: Theme.of(context).textTheme.bodySmall),
        for (final (index, route) in _routes.indexed)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              index == _routeIndex
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
            ),
            title: Text(
              '${_distance(route.meters)} · ${_duration(route.seconds)}',
            ),
            onTap: () {
              setState(() => _routeIndex = index);
              _redraw();
              unawaited(_fit(route));
            },
          ),
        FilledButton.icon(
          onPressed: _starting ? null : _start,
          icon: const Icon(Icons.navigation_outlined),
          label: Text(w('start')),
        ),
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: Text(w('directions')),
          children: [
            for (final step in _route!.steps)
              ListTile(
                title: Text(step.instruction),
                subtitle: _route!.language == w.language
                    ? null
                    : Text(_route!.language.toUpperCase()),
              ),
          ],
        ),
      ],
    ],
  );

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
            applicationVersion: '0.6.0',
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
        Wrap(
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

  Widget _sheet() {
    if (_picking) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        final height = constraints.maxHeight;
        final footer = MediaQuery.textScalerOf(context).scale(11) > 15
            ? 96
            : 48;
        final minSize = ((footer + 18) / height).clamp(.17, .55);
        final initialSize = _navigating
            ? .26
            : _tab == 0 && _selected == null && _results.isEmpty
            ? .21
            : .43;
        return DraggableScrollableSheet(
          key: ValueKey((_tab, _navigating, _selected != null)),
          initialChildSize: math.max(initialSize, minSize),
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
                      const SizedBox(height: 8),
                      if (_loading) const LinearProgressIndicator(),
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
                      if (_tab == 2) _navigation(),
                      if (_tab == 3)
                        _favorites.isEmpty
                            ? Text(w('empty'))
                            : _resultsList(_favorites.values.toList()),
                      if (_tab == 4) _profile(),
                    ],
                  ),
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

  Widget _top() {
    final session = _session;
    final next = session?.progress.nextStep;
    if (_navigating && next != null) {
      final step = session!.progress.route.steps[next];
      final icon = switch (session.instructionKey(step)) {
        'right' => Icons.turn_right,
        'left' => Icons.turn_left,
        'uturn' => Icons.u_turn_left,
        'destinationAhead' => Icons.flag_outlined,
        _ => Icons.navigation,
      };
      return Card(
        color: const Color(0xff2563eb),
        child: ListTile(
          textColor: Colors.white,
          iconColor: Colors.white,
          leading: Icon(icon),
          title: Text(session.instruction(step)),
          subtitle: Text(
            [
              _distance(session.progress.maneuverMeters),
              if (step.street?.isNotEmpty ?? false) step.street!,
              if (session.instructionKey(step) == null &&
                  session.progress.route.language != w.language)
                session.progress.route.language.toUpperCase(),
            ].join(' · '),
          ),
        ),
      );
    }
    return Card(
      margin: EdgeInsets.zero,
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.explore,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Text(
                  'KUNDE Maps',
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ],
            ),
            if (_picking) Text(w('tap')),
            if (_tab == 0) ...[
              const SizedBox(height: 6),
              TextField(
                controller: _query,
                maxLength: 100,
                onChanged: _search,
                decoration: InputDecoration(
                  counterText: '',
                  prefixIcon: const Icon(Icons.search),
                  hintText: w(
                    _endpoint == null
                        ? 'hint'
                        : _endpoint == 0
                        ? 'origin'
                        : 'destination',
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
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
              if (_endpoint == null)
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: ActionChip(
                          label: Text(w('near')),
                          onPressed: () => _nearby(null, fromDevice: true),
                        ),
                      ),
                      for (final category in _categories)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ChoiceChip(
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
        ),
      ),
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
                    compassViewMargins: math.Point(
                      12,
                      MediaQuery.paddingOf(context).top +
                          (_tab == 0 ? 170 : 92),
                    ),
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
          Positioned(
            right: 12,
            top: MediaQuery.sizeOf(context).height * .32,
            child: FloatingActionButton.small(
              tooltip: w('locate'),
              onPressed: () {
                final session = _session;
                if (session != null && session.active) {
                  session.follow = true;
                  if (_gps != null) unawaited(_move(_gps!, 16));
                } else {
                  unawaited(_locate());
                }
              },
              child: const Icon(Icons.my_location),
            ),
          ),
          if (_picking)
            Positioned(bottom: 0, left: 0, child: Card(child: _attribution())),
          _sheet(),
        ],
      ),
      bottomNavigationBar: _navigating
          ? null
          : NavigationBar(
              selectedIndex: _tab,
              onDestinationSelected: _tabTo,
              labelBehavior:
                  NavigationDestinationLabelBehavior.onlyShowSelected,
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
    _http.close();
    super.dispose();
  }
}
