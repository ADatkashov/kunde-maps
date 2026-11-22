/// Estimated arrival. Built from a typical travel time without traffic, so
/// show it as "about", never as a guarantee.
class Eta {
  const Eta(this.duration, this.arrival);

  factory Eta.fromSeconds(double seconds, {DateTime? now}) {
    if (!seconds.isFinite || seconds < 0) {
      throw ArgumentError.value(seconds, 'seconds', 'finite and >= 0');
    }
    final start = now ?? DateTime.now();
    final duration = Duration(seconds: seconds.round());
    return Eta(duration, start.add(duration));
  }

  final Duration duration;
  final DateTime arrival;

  /// Whole minutes, at least 1 while any time remains.
  int get minutes => duration.inSeconds == 0
      ? 0
      : (duration.inSeconds / 60).ceil().clamp(1, 1 << 30);

  /// `HH:mm` in the arrival's own time zone.
  String get clock =>
      '${arrival.hour.toString().padLeft(2, '0')}:'
      '${arrival.minute.toString().padLeft(2, '0')}';
}
