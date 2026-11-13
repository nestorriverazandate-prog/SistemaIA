import 'dart:io';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

/// URL pública del sistema (frontend en Vercel). Cambia aquí si el dominio cambia.
const String kAppUrl = 'https://sistemaia-nestor-fbf5.vercel.app';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AgenciaApp());
}

class AgenciaApp extends StatelessWidget {
  const AgenciaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Agencia Gerontológica',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: const Color(0xFF0B0F14),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF00E5FF),
          brightness: Brightness.dark,
        ),
      ),
      home: const WebAppPage(),
    );
  }
}

class WebAppPage extends StatefulWidget {
  const WebAppPage({super.key});

  @override
  State<WebAppPage> createState() => _WebAppPageState();
}

class _WebAppPageState extends State<WebAppPage> {
  late final WebViewController _controller;
  bool _cargando = true;
  String? _error;
  bool _permisoCamara = false;
  bool _permisoUbicacion = false;

  @override
  void initState() {
    super.initState();
    _inicializar();
  }

  Future<void> _inicializar() async {
    // Permisos de Android necesarios para cámara (escáner QR) y GPS.
    final camara = await Permission.camera.request();
    final ubicacion = await Permission.locationWhenInUse.request();
    if (!mounted) return;
    setState(() {
      _permisoCamara = camara.isGranted;
      _permisoUbicacion = ubicacion.isGranted;
    });

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0B0F14))
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (int progress) {
            if (mounted) setState(() => _cargando = progress < 100);
          },
          onWebResourceError: (WebResourceError error) {
            if (error.isForMainFrame ?? false) {
              setState(() => _error = 'Sin conexión. Revisa tu internet.');
            }
          },
          onPageFinished: (_) {
            if (mounted) {
              setState(() {
                _cargando = false;
                _error = null;
              });
            }
          },
        ),
      );

    if (Platform.isAndroid) {
      final androidController =
          _controller.platform as AndroidWebViewController;

      // La web pide cámara (escáner QR) → conceder al WebView.
      await androidController.setOnPlatformPermissionRequest((request) async {
        await request.grant();
      });

      // La web pide geolocalización → conceder y recordar.
      await androidController.setGeolocationPermissionsPromptCallbacks(
        onShowPrompt: (params) async => const GeolocationPermissionsResponse(
          allow: true,
          retain: true,
        ),
        onHidePrompt: () {},
      );
    }

    await _controller.loadRequest(Uri.parse(kAppUrl));
  }

  Future<bool> _onBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _onBack() && context.mounted) {
          // Salir de la app solo si no hay historial.
          exit(0);
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              if (_error != null)
                _buildError()
              else
                WebViewWidget(controller: _controller),
              if (!_permisoCamara || !_permisoUbicacion)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: Material(
                    color: Colors.red.shade900,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      child: Text(
                        !_permisoCamara
                            ? 'Permiso de cámara denegado: el escáner QR no funcionará'
                            : 'Permiso de ubicación denegado: el GPS no registrará asistencia',
                        style: const TextStyle(fontSize: 12),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
                ),
              if (_cargando)
                const Center(
                  child: CircularProgressIndicator(color: Color(0xFF00E5FF)),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.wifi_off, size: 64, color: Colors.white38),
            const SizedBox(height: 16),
            Text(
              _error ?? 'No se pudo cargar la aplicación',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text(
              'La app necesita acceso a: $kAppUrl',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: Colors.white38),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () {
                setState(() {
                  _error = null;
                  _cargando = true;
                });
                _controller.reload();
              },
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}
