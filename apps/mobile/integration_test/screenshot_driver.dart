import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  await integrationDriver(
    responseDataCallback: null,
    onScreenshot: (name, bytes, [args]) async {
      final folder = await Directory('build/phase61-screenshots')
          .create(recursive: true);
      await File('${folder.path}/$name.png').writeAsBytes(bytes, flush: true);
      return bytes.isNotEmpty;
    },
  );
}
