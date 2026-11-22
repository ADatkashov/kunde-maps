/// Compatibility layer over `kunde_maps_sdk`.
///
/// The Maps app keeps its original names while the logic lives in the SDK
/// (single source of map and routing code). New code should import
/// `package:kunde_maps_sdk/kunde_maps_sdk.dart` directly.
library;

import 'package:http/http.dart' as http;
import 'package:kunde_maps_sdk/kunde_maps_sdk.dart';

import 'diagnostics.dart';

export 'package:kunde_maps_sdk/kunde_maps_sdk.dart'
    show
        Json,
        inKazakhstan,
        metersBetween,
        newRequestId,
        RouteProgress,
        Projection,
        secureUrl,
        nativeStyle,
        routeFeatures,
        routeSourceId,
        primaryRouteLayerId,
        LocationFix;

typedef Point = GeoPoint;
typedef Place = MapPlace;
typedef Maneuver = RouteManeuver;
typedef RoadRoute = MapRoute;
typedef ApiFailure = MapsException;

final mapsConfig = MapsConfig.fromEnvironment();
final webUrl = mapsConfig.webUrl;
final searchUrl = mapsConfig.searchUrl;
final routingUrl = mapsConfig.routingUrl;
final tileUrl = mapsConfig.tileUrl;

class _AppDiagnostics implements MapsDiagnostics {
  @override
  void set(String key, Object? value) => diagnostics.set(key, value);

  @override
  void setAll(Map<String, Object?> entries) => diagnostics.setAll(entries);
}

class PlatformApi extends MapsClient {
  PlatformApi(http.Client client, {super.sleep, super.timeout})
    : super(mapsConfig, client, diagnostics: _AppDiagnostics());
}
