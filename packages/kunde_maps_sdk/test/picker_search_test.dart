// Reproduces the report "tap the address field in the map picker: a gray
// rectangle covers the screen" on a flutter/material host in the reporter's
// conditions: Russian, dark system theme, the on-screen keyboard open.
import 'dart:ui' show Brightness, Size;

import 'package:flutter/foundation.dart';
// ignore: deprecated_member_use
import 'package:flutter/material.dart' as flutter_material;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kunde_maps_sdk/kunde_maps_sdk.dart';
import 'package:material_ui/material_ui.dart' show TextField;

MapsConfig _config() => MapsConfig(
  environment: MapsEnvironment.dev,
  searchUrl: 'https://search.test',
  routingUrl: 'https://routing.test',
  tileUrl: 'https://tiles.test/k.pmtiles',
  webUrl: 'https://web.test',
  language: 'ru',
);

void main() {
  testWidgets('map picker: tapping the search row opens a working field', (
    tester,
  ) async {
    // maplibre_gl has no platform view in unit tests; on this platform it draws a text.
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);

    final config = _config();
    final search = PlaceSearch(
      MapsClient(
        config,
        MockClient(
          (_) async => http.Response(
            '{"results":[]}',
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      ),
    );
    await tester.pumpWidget(
      flutter_material.MaterialApp(
        theme: flutter_material.ThemeData.dark(),
        home: flutter_material.Scaffold(
          appBar: flutter_material.AppBar(
            title: const flutter_material.Text('Куда'),
          ),
          body: LocationPicker(
            config: config,
            search: search,
            dark: true,
            title: 'Куда',
            onPicked: (_) {},
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 200));
    expect(tester.takeException(), isNull);

    await tester.tap(
      find.descendant(
        of: find.byType(LocationPicker),
        matching: find.text('Куда'),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull, reason: 'opening the search field');
    // The on-screen keyboard (about a third of the screen) appears.
    tester.view.viewInsets = const FakeViewPadding(bottom: 900);
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull, reason: 'keyboard inset');
    expect(find.byType(PlaceSearchField), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'абай');
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull, reason: 'typing an address');
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('search field on Android in the picker card (scroll view, keyboard)', (
    tester,
  ) async {
    // Android-only paths: selection controls, spell check, autofocus with the IME.
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);
    final config = _config();
    final search = PlaceSearch(
      MapsClient(
        config,
        MockClient(
          (_) async => http.Response(
            '{"results":[]}',
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      ),
    );
    await tester.pumpWidget(
      flutter_material.MaterialApp(
        theme: flutter_material.ThemeData.dark(),
        home: flutter_material.Scaffold(
          appBar: flutter_material.AppBar(
            title: const flutter_material.Text('Куда'),
          ),
          body: flutter_material.Stack(
            children: [
              flutter_material.Positioned(
                left: 12,
                right: 12,
                top: 12,
                child: flutter_material.SafeArea(
                  child: flutter_material.Card(
                    child: flutter_material.Padding(
                      padding: const flutter_material.EdgeInsets.all(8),
                      child: flutter_material.ConstrainedBox(
                        constraints: const flutter_material.BoxConstraints(
                          maxHeight: 400,
                        ),
                        child: flutter_material.SingleChildScrollView(
                          child: PlaceSearchField(
                            search: search,
                            language: 'ru',
                            center: () => const GeoPoint(43.2, 76.9),
                            autofocus: true,
                            onSelected: (_) {},
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 200));
    expect(tester.takeException(), isNull, reason: 'autofocused field');
    tester.view.viewInsets = const FakeViewPadding(bottom: 900);
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull, reason: 'keyboard inset');
    await tester.enterText(find.byType(TextField), 'абай');
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull, reason: 'typing an address');
    // Long press opens the Android selection toolbar (material_ui vs host localizations).
    await tester.longPress(find.byType(TextField));
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull, reason: 'selection toolbar');
    debugDefaultTargetPlatformOverride = null;
  });
}
