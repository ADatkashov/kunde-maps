import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';

import '../core/strings.dart';

enum GpsAccess { ok, serviceOff, denied, deniedForever }

/// Why the device position can or cannot be used, so the UI can tell the user
/// whether to switch location on or to grant the permission.
Future<GpsAccess> locationAccess() async {
  if (!await Geolocator.isLocationServiceEnabled()) return GpsAccess.serviceOff;
  var permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) {
    permission = await Geolocator.requestPermission();
  }
  return switch (permission) {
    LocationPermission.whileInUse || LocationPermission.always => GpsAccess.ok,
    LocationPermission.deniedForever => GpsAccess.deniedForever,
    _ => GpsAccess.denied,
  };
}

Future<bool> requestLocation() async => await locationAccess() == GpsAccess.ok;

Future<bool> navigationNotificationsGranted() async {
  if (!Platform.isAndroid) return true;
  const channel = MethodChannel('kz.kunde.maps/permissions');
  return await channel.invokeMethod<bool>('navigationNotifications') ?? false;
}

LocationSettings navigationSettings(Words words, String mode) {
  if (Platform.isAndroid) {
    return AndroidSettings(
      accuracy: LocationAccuracy.bestForNavigation,
      distanceFilter: 2,
      intervalDuration: const Duration(seconds: 1),
      foregroundNotificationConfig: ForegroundNotificationConfig(
        notificationTitle: 'KUNDE Maps',
        notificationText: words('nav'),
        enableWakeLock: true,
        setOngoing: true,
      ),
    );
  }
  return AppleSettings(
    accuracy: LocationAccuracy.bestForNavigation,
    activityType: mode == 'car'
        ? ActivityType.automotiveNavigation
        : ActivityType.fitness,
    distanceFilter: 2,
    pauseLocationUpdatesAutomatically: false,
    allowBackgroundLocationUpdates: true,
    showBackgroundLocationIndicator: true,
  );
}

class Voice {
  final _tts = FlutterTts();
  bool _configured = false;

  Future<bool> speak(
    String language,
    String text,
    bool Function() active,
  ) async {
    final locale = switch (language) {
      'kk' => 'kk-KZ',
      'en' => 'en-US',
      _ => 'ru-RU',
    };
    try {
      if (await _tts.isLanguageAvailable(locale) != true) return false;
      if (!_configured && Platform.isIOS) {
        await _tts.setIosAudioCategory(IosTextToSpeechAudioCategory.playback, [
          IosTextToSpeechAudioCategoryOptions.duckOthers,
        ], IosTextToSpeechAudioMode.voicePrompt);
        _configured = true;
      }
      await _tts.setLanguage(locale);
      if (!active()) return true;
      await _tts.speak(text, focus: true);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> stop() async {
    await _tts.stop();
  }
}
