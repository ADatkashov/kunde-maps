import 'dart:convert';

import 'package:flutter/services.dart';

import '../core/platform_api.dart';

const routeSourceId = 'kunde-route';
const primaryRouteLayerId = 'kunde-route-main';

Json routeFeatures(List<RoadRoute> routes, RoadRoute? selected) => {
  'type': 'FeatureCollection',
  'features': [
    for (final route in routes)
      {
        'type': 'Feature',
        'properties': {'selected': identical(route, selected)},
        'geometry': {
          'type': 'LineString',
          'coordinates': [
            for (final point in route.points) [point.lon, point.lat],
          ],
        },
      },
  ],
};

Future<String> nativeStyle(
  bool dark,
  String language, {
  bool showPoi = true,
}) async {
  final path = dark ? 'assets/style-dark.json' : 'assets/style.json';
  final style = jsonDecode(await rootBundle.loadString(path)) as Json;
  final source = (style['sources'] as Json)['kunde'] as Json;
  source['url'] = 'pmtiles://${secureUrl(tileUrl)}';
  style['glyphs'] = '${secureUrl(webUrl).origin}/fonts/{fontstack}/{range}.pbf';
  final layers = style['layers'] as List;
  if (!showPoi) {
    layers.removeWhere((layer) => (layer['id'] as String).startsWith('poi-'));
  }
  for (final layer in layers) {
    final templates = layer['metadata']?['kunde:text'] as Json?;
    if (templates != null && templates.containsKey(language)) {
      layer['layout']['text-field'] = templates[language];
    }
  }
  (style['sources'] as Json)[routeSourceId] = {
    'type': 'geojson',
    'data': routeFeatures(const [], null),
  };
  for (final (id, selected, color, width) in [
    ('kunde-route-alternatives', false, dark ? '#A3ADBD' : '#737F92', 4),
    ('kunde-route-casing', true, dark ? '#10182B' : '#FFFFFF', 10),
    (primaryRouteLayerId, true, dark ? '#7DA6FF' : '#2563EB', 6),
  ]) {
    (style['layers'] as List).add({
      'id': id,
      'type': 'line',
      'source': routeSourceId,
      'filter': [
        '==',
        ['get', 'selected'],
        selected,
      ],
      'layout': {'line-cap': 'round', 'line-join': 'round'},
      'paint': {'line-color': color, 'line-width': width, 'line-opacity': 1},
    });
  }
  return jsonEncode(style);
}
