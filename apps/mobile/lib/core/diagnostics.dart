import 'package:flutter/foundation.dart';

/// Set with `--dart-define=KUNDE_DIAGNOSTICS=true` (DEV builds) to show the
/// diagnostics panel in the route planner. Debug builds always show it.
const diagnosticsEnabled = bool.fromEnvironment('KUNDE_DIAGNOSTICS');

bool get showDiagnostics => diagnosticsEnabled || kDebugMode;

/// Safe, non-personal runtime facts about the route pipeline.
///
/// It never stores coordinates, tokens or addresses: only hosts, request IDs,
/// HTTP status codes, timings, counts and fixed failure categories.
class Diagnostics extends ChangeNotifier {
  final Map<String, String> _values = {};

  Map<String, String> get values => Map.unmodifiable(_values);

  /// `null` for a key that was never set or was set to null (stored as '-').
  String? operator [](String key) {
    final value = _values[key];
    return value == '-' ? null : value;
  }

  void set(String key, Object? value) {
    final text = value?.toString() ?? '-';
    if (_values[key] == text) return;
    _values[key] = text;
    notifyListeners();
  }

  void setAll(Map<String, Object?> entries) {
    var changed = false;
    entries.forEach((key, value) {
      final text = value?.toString() ?? '-';
      if (_values[key] != text) {
        _values[key] = text;
        changed = true;
      }
    });
    if (changed) notifyListeners();
  }

  void clear() {
    if (_values.isEmpty) return;
    _values.clear();
    notifyListeners();
  }

  @override
  String toString() =>
      _values.entries.map((entry) => '${entry.key}=${entry.value}').join(' ');
}

final diagnostics = Diagnostics();
