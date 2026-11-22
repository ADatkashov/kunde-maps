import 'package:kunde_maps_sdk/kunde_maps_sdk.dart';

import '../core/platform_api.dart';
import '../core/strings.dart';
import 'location.dart';

/// The Maps app's navigation session: the SDK [NavigationController] with
/// the app's strings and Android notification permission.
class NavigationSession extends NavigationController {
  NavigationSession(
    PlatformApi api,
    Words words,
    String mode,
    Point destination,
    RoadRoute road,
  ) : super(
        client: api,
        strings: MapsStrings(words.language),
        mode: mode,
        destination: destination,
        route: road,
        notificationPermission: navigationNotificationsGranted,
      );
}
