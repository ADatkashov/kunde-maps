import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'errors.dart';
import 'geo.dart';
import 'models.dart';
import 'services.dart';
import 'strings.dart';

/// Search box with results: debounced, cancels outdated requests, shows
/// localised errors. Selecting a result calls [onSelected].
class PlaceSearchField extends StatefulWidget {
  const PlaceSearchField({
    super.key,
    required this.search,
    required this.language,
    required this.center,
    required this.onSelected,
    this.hint,
    this.autofocus = false,
    this.debounce = const Duration(milliseconds: 350),
  });

  final PlaceSearch search;
  final String language;

  /// Ranking centre: the map centre or the device position.
  final GeoPoint Function() center;
  final void Function(MapPlace place) onSelected;
  final String? hint;
  final bool autofocus;
  final Duration debounce;

  @override
  State<PlaceSearchField> createState() => _PlaceSearchFieldState();
}

class _PlaceSearchFieldState extends State<PlaceSearchField> {
  final _text = TextEditingController();
  Timer? _timer;
  Completer<void>? _abort;
  List<MapPlace> _results = const [];
  bool _loading = false;
  String? _error;
  bool _searched = false;

  MapsStrings get _s => MapsStrings(widget.language);

  void _changed(String input) {
    _timer?.cancel();
    _abort?.complete();
    final query = input.trim();
    if (query.length < 2) {
      setState(() {
        _results = const [];
        _error = null;
        _loading = false;
        _searched = false;
      });
      return;
    }
    _timer = Timer(widget.debounce, () => unawaited(_run(query)));
  }

  Future<void> _run(String query) async {
    final abort = Completer<void>();
    _abort = abort;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final found = await widget.search.search(
        query,
        widget.center(),
        language: widget.language,
        abort: abort.future,
      );
      if (!mounted || abort.isCompleted) return;
      setState(() {
        _results = found;
        _loading = false;
        _searched = true;
      });
    } catch (error) {
      if (!mounted || abort.isCompleted) return;
      setState(() {
        _loading = false;
        _searched = true;
        _results = const [];
        _error = error is MapsException ? error.code : 'invalid';
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _abort?.complete();
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _text,
          autofocus: widget.autofocus,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            prefixIcon: const Icon(Icons.search),
            hintText: widget.hint ?? _s('search'),
            suffixIcon: _loading
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : null,
          ),
          onChanged: _changed,
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              _s.error(_error!),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          )
        else if (_searched && !_loading && _results.isEmpty)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(_s('noResults')),
          ),
        for (final place in _results)
          ListTile(
            leading: const Icon(Icons.place_outlined),
            title: Text(place.name(widget.language, _s('search'))),
            subtitle: _subtitle(place),
            onTap: () => widget.onSelected(place),
          ),
      ],
    );
  }

  Widget? _subtitle(MapPlace place) {
    final text = place.data['address'] ?? place.data['locality'];
    return text is String && text.isNotEmpty ? Text(text) : null;
  }
}
