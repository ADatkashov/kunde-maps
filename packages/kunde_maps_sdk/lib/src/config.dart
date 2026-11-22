/// Deployment environment of the Maps Platform the SDK talks to.
enum MapsEnvironment { dev, staging, production }

/// Features a host app may switch on or off. The host reads them from its own
/// backend (for KUNDE: the capabilities endpoint) so rollout stays
/// backend-controlled; the SDK only enforces them.
class MapsFeatures {
  const MapsFeatures({
    this.search = true,
    this.routing = true,
    this.navigation = true,
    this.voice = true,
    this.livePositions = true,
  });

  /// Everything off: a safe default while a backend flag is still unknown.
  const MapsFeatures.none()
    : search = false,
      routing = false,
      navigation = false,
      voice = false,
      livePositions = false;

  final bool search;
  final bool routing;
  final bool navigation;
  final bool voice;
  final bool livePositions;
}

/// Everything an SDK instance needs to know about its environment.
///
/// All URLs must be HTTPS without credentials. No API key belongs in a mobile
/// build: server-to-server callers use their own keys, apps rely on the public
/// quotas of the Maps Platform.
class MapsConfig {
  MapsConfig({
    required this.environment,
    required this.searchUrl,
    required this.routingUrl,
    required this.tileUrl,
    required this.webUrl,
    this.features = const MapsFeatures(),
    this.requestTimeout = const Duration(seconds: 35),
    this.language = 'ru',
  }) {
    for (final value in [searchUrl, routingUrl, tileUrl, webUrl]) {
      secureUrl(value);
    }
    if (!supportedLanguages.contains(language)) {
      throw ArgumentError.value(language, 'language', 'ru, kk or en');
    }
  }

  /// Reads the same four `--dart-define` values the KUNDE Maps app uses and
  /// falls back to the DEV platform.
  factory MapsConfig.fromEnvironment({
    MapsFeatures features = const MapsFeatures(),
    String language = 'ru',
  }) => MapsConfig(
    environment: const bool.fromEnvironment('KUNDE_MAPS_PRODUCTION')
        ? MapsEnvironment.production
        : MapsEnvironment.dev,
    webUrl: const String.fromEnvironment(
      'KUNDE_WEB_URL',
      defaultValue: 'https://kunde-maps-web-dev.onrender.com',
    ),
    searchUrl: const String.fromEnvironment(
      'KUNDE_SEARCH_URL',
      defaultValue: 'https://kunde-maps-search-dev.onrender.com',
    ),
    routingUrl: const String.fromEnvironment(
      'KUNDE_ROUTING_URL',
      defaultValue: 'https://kunde-maps-routing-dev.onrender.com',
    ),
    tileUrl: const String.fromEnvironment(
      'KUNDE_TILE_URL',
      defaultValue:
          'https://pub-237f2a01acb04791aad25708c16f3d8a.r2.dev/kazakhstan.pmtiles',
    ),
    features: features,
    language: language,
  );

  static const supportedLanguages = {'ru', 'kk', 'en'};

  final MapsEnvironment environment;
  final String searchUrl;
  final String routingUrl;
  final String tileUrl;
  final String webUrl;
  final MapsFeatures features;
  final Duration requestTimeout;
  final String language;

  MapsConfig copyWith({MapsFeatures? features, String? language}) => MapsConfig(
    environment: environment,
    searchUrl: searchUrl,
    routingUrl: routingUrl,
    tileUrl: tileUrl,
    webUrl: webUrl,
    features: features ?? this.features,
    requestTimeout: requestTimeout,
    language: language ?? this.language,
  );
}

/// Parses an HTTPS URL and rejects anything else (including embedded
/// credentials).
Uri secureUrl(String value) {
  final uri = Uri.parse(value);
  if (uri.scheme != 'https' || uri.host.isEmpty || uri.userInfo.isNotEmpty) {
    throw const FormatException('HTTPS URL required');
  }
  return uri;
}

/// Optional hook for non-personal runtime facts (hosts, status codes,
/// timings). The SDK never passes coordinates, addresses or tokens to it.
abstract class MapsDiagnostics {
  void set(String key, Object? value);
  void setAll(Map<String, Object?> entries);
}
