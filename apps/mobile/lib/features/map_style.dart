import 'dart:convert';

import 'package:flutter/services.dart';

import '../core/platform_api.dart';

Future<String> nativeStyle(bool dark, String language) async {
  final path = dark ? 'assets/style-dark.json' : 'assets/style.json';
  final style = jsonDecode(await rootBundle.loadString(path)) as Json;
  final source = (style['sources'] as Json)['kunde'] as Json;
  source['url'] = 'pmtiles://${secureUrl(tileUrl)}';
  style['glyphs'] = '${secureUrl(webUrl).origin}/fonts/{fontstack}/{range}.pbf';
  for (final layer in style['layers'] as List) {
    final templates = layer['metadata']?['kunde:text'] as Json?;
    if (templates != null && templates.containsKey(language)) {
      layer['layout']['text-field'] = templates[language];
    }
  }
  return jsonEncode(style);
}
