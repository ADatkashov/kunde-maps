import 'dart:io';

import 'package:flutter_tts/flutter_tts.dart';

/// Spoken guidance. Replaceable in tests and in apps with their own TTS.
abstract class VoiceGuide {
  /// Speaks [text]; returns false when the language is not available.
  /// [active] is re-checked right before speaking so a stale prompt is dropped.
  Future<bool> speak(String language, String text, bool Function() active);
  Future<void> stop();
}

/// Text to speech through `flutter_tts`.
class TtsVoiceGuide implements VoiceGuide {
  final _tts = FlutterTts();
  bool _configured = false;

  @override
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

  @override
  Future<void> stop() async {
    await _tts.stop();
  }
}
