import 'package:flutter_test/flutter_test.dart';

import 'package:velocimetro/main.dart';

void main() {
  testWidgets('Velocimetro muestra la interfaz inicial',
      (WidgetTester tester) async {
    await tester.pumpWidget(const VelocimetroApp());

    expect(find.text('VELÓCIMETRO GPS'), findsOneWidget);
    expect(find.text('INICIAR'), findsOneWidget);
    expect(find.text('km/h'), findsWidgets);
  });
}
