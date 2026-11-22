import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('loads stored locale and theme into the Flutter app', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({'language': 'en', 'theme': 'dark'});
    final preferences = await SharedPreferences.getInstance();
    await tester.pumpWidget(KundeMaps(preferences));
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.locale, const Locale('en'));
    expect(app.themeMode, ThemeMode.dark);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('Address or place'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
