import 'dart:io';

import 'package:flutter/services.dart';
import 'package:kunde_maps_sdk/kunde_maps_sdk.dart';

export 'package:kunde_maps_sdk/kunde_maps_sdk.dart' show GpsAccess;

/// Why the device position can or cannot be used, so the UI can tell the user
/// whether to switch location on or to grant the permission.
Future<GpsAccess> locationAccess() => const DeviceLocationSource().access();

Future<bool> requestLocation() async => await locationAccess() == GpsAccess.ok;

Future<bool> navigationNotificationsGranted() async {
  if (!Platform.isAndroid) return true;
  const channel = MethodChannel('kz.kunde.maps/permissions');
  return await channel.invokeMethod<bool>('navigationNotifications') ?? false;
}
