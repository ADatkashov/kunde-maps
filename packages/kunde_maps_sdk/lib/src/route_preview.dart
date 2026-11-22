import 'package:material_ui/material_ui.dart';

import 'material_scope.dart';
import 'services.dart';
import 'strings.dart';

/// Distance, travel time and arrival for a computed route.
///
/// It states plainly that the time is typical and traffic is not included,
/// and it shows no price: fares belong to the host's business backend.
class RoutePreview extends StatelessWidget {
  const RoutePreview({
    super.key,
    required this.data,
    required this.language,
    this.now,
  });

  final RoutePreviewData data;
  final String language;

  /// Fixed clock for tests; defaults to the current time.
  final DateTime? now;

  @override
  Widget build(BuildContext outer) => MapsMaterialScope(
    child: Builder(builder: (context) => _content(context)),
  );

  Widget _content(BuildContext context) {
    final s = MapsStrings(language);
    final eta = data.eta(now);
    final km = data.distanceMeters >= 1000
        ? '${(data.distanceMeters / 1000).toStringAsFixed(1)} ${language == 'en' ? 'km' : 'км'}'
        : '${data.distanceMeters} ${s('m')}';
    Widget cell(String label, String value) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelSmall),
          Text(value, style: Theme.of(context).textTheme.titleMedium),
        ],
      ),
    );
    final minutes = '${eta.minutes} ${language == 'en' ? 'min' : 'мин'}';
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            cell(s('distance'), km),
            cell(s('duration'), minutes),
            cell(s('arrival'), eta.clock),
          ],
        ),
        if (!data.trafficAware)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              s('typicalTime'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}
