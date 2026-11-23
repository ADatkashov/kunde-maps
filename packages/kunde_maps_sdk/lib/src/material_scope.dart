import 'dart:ui' show Locale;

import 'package:material_ui/material_ui.dart';

/// Look of the SDK widgets. A host app wraps a subtree in
/// [MapsAppearanceScope] to match its brand; without it the SDK uses a neutral
/// blue and the platform brightness.
class MapsAppearance {
  const MapsAppearance({
    this.seedColor = const Color(0xFF2563EB),
    this.fontFamily,
    this.dark,
  });

  final Color seedColor;
  final String? fontFamily;

  /// Null follows the platform brightness.
  final bool? dark;
}

class MapsAppearanceScope extends InheritedWidget {
  const MapsAppearanceScope({
    super.key,
    required this.appearance,
    required super.child,
  });

  final MapsAppearance appearance;

  static MapsAppearance of(BuildContext context) =>
      context
          .dependOnInheritedWidgetOfExactType<MapsAppearanceScope>()
          ?.appearance ??
      const MapsAppearance();

  @override
  bool updateShouldNotify(MapsAppearanceScope old) =>
      old.appearance.seedColor != appearance.seedColor ||
      old.appearance.fontFamily != appearance.fontFamily ||
      old.appearance.dark != appearance.dark;
}

/// Makes the SDK widgets independent of the host's Material setup.
///
/// The SDK builds on `material_ui`. A host built on `package:flutter/material.dart`
/// has a different `Material`, `Theme` and `MaterialLocalizations` (a `TextField`
/// would fail with "No Material widget found"), so every public SDK widget
/// brings its own: default localizations, a theme from [MapsAppearance] and a
/// transparent Material.
class MapsMaterialScope extends StatelessWidget {
  const MapsMaterialScope({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final look = MapsAppearanceScope.of(context);
    final dark =
        look.dark ??
        MediaQuery.maybePlatformBrightnessOf(context) == Brightness.dark;
    return Localizations.override(
      context: context,
      delegates: const [_AnyLocaleMaterialLocalizations()],
      child: Theme(
        data: ThemeData(
          useMaterial3: true,
          fontFamily: look.fontFamily,
          colorScheme: ColorScheme.fromSeed(
            seedColor: look.seedColor,
            brightness: dark ? Brightness.dark : Brightness.light,
          ),
        ),
        child: Material(type: MaterialType.transparency, child: child),
      ),
    );
  }
}

/// `DefaultMaterialLocalizations` supports English only. In a Russian or Kazakh
/// host app the SDK's `TextField` would find no `MaterialLocalizations` and
/// fail to build (a gray box in release builds). This delegate serves the
/// English framework strings for every locale; the SDK's own texts come from
/// `MapsStrings`, never from here.
class _AnyLocaleMaterialLocalizations
    extends LocalizationsDelegate<MaterialLocalizations> {
  const _AnyLocaleMaterialLocalizations();

  @override
  bool isSupported(Locale locale) => true;

  @override
  Future<MaterialLocalizations> load(Locale locale) =>
      DefaultMaterialLocalizations.delegate.load(const Locale('en'));

  @override
  bool shouldReload(LocalizationsDelegate<MaterialLocalizations> old) => false;
}
