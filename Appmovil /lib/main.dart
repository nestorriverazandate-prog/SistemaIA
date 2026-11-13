import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

void main() {
  runApp(const VelocimetroApp());
}

class VelocimetroApp extends StatelessWidget {
  const VelocimetroApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Velocímetro GPS',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: const Color(0xFF0B0F14),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF00E5FF),
          brightness: Brightness.dark,
        ),
      ),
      home: const VelocimetroPage(),
    );
  }
}

enum _Unit { kmh, mph }

class VelocimetroPage extends StatefulWidget {
  const VelocimetroPage({super.key});

  @override
  State<VelocimetroPage> createState() => _VelocimetroPageState();
}

class _VelocimetroPageState extends State<VelocimetroPage> {
  StreamSubscription<Position>? _sub;
  bool _midiendo = false;
  _Unit _unidad = _Unit.kmh;

  double _velocidadMs = 0;
  double? _precision;
  double? _altitud;
  DateTime? _ultimaActualizacion;
  String? _error;

  Future<void> _toggleMedicion() async {
    if (_midiendo) {
      await _detener();
      return;
    }
    await _iniciar();
  }

  Future<void> _iniciar() async {
    setState(() {
      _error = null;
      _velocidadMs = 0;
    });

    final servicioActivo = await Geolocator.isLocationServiceEnabled();
    if (!servicioActivo) {
      setState(() => _error = 'Activa el GPS del dispositivo');
      return;
    }

    var permiso = await Geolocator.checkPermission();
    if (permiso == LocationPermission.denied) {
      permiso = await Geolocator.requestPermission();
    }
    if (permiso == LocationPermission.denied ||
        permiso == LocationPermission.deniedForever) {
      setState(() => _error = 'Permiso de ubicación denegado');
      return;
    }

    try {
      _sub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.best,
          distanceFilter: 3,
        ),
      ).listen(
        _onPosicion,
        onError: (Object e) {
          if (mounted) setState(() => _error = e.toString());
        },
      );
      setState(() => _midiendo = true);
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _detener() async {
    await _sub?.cancel();
    _sub = null;
    if (mounted) {
      setState(() {
        _midiendo = false;
        _velocidadMs = 0;
        _precision = null;
        _altitud = null;
        _ultimaActualizacion = null;
      });
    }
  }

  void _onPosicion(Position pos) {
    if (!mounted) return;
    setState(() {
      // position.speed viene en m/s; valores negativos o errores se ignoran
      if (pos.speed >= 0) _velocidadMs = pos.speed;
      _precision = pos.accuracy;
      _altitud = pos.altitude;
      _ultimaActualizacion = pos.timestamp;
      _error = null;
    });
  }

  double get _velocidadMostrada {
    final ms = _velocidadMs * 3.6; // m/s -> km/h
    return _unidad == _Unit.kmh ? ms : ms * 0.621371;
  }

  String get _unidadTexto => _unidad == _Unit.kmh ? 'km/h' : 'mph';

  String _formatearHora() {
    final t = _ultimaActualizacion;
    if (t == null) return '--:--:--';
    final l = t.toLocal();
    return '${l.hour.toString().padLeft(2, '0')}:'
        '${l.minute.toString().padLeft(2, '0')}:'
        '${l.second.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colorEstado = _midiendo
        ? const Color(0xFF00E676)
        : (_error != null ? Colors.redAccent : Colors.white38);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            children: [
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'VELÓCIMETRO GPS',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 3,
                    ),
                  ),
                  Row(
                    children: [
                      _chipUnidad('km/h', _Unit.kmh),
                      const SizedBox(width: 8),
                      _chipUnidad('mph', _Unit.mph),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.circle, size: 10, color: colorEstado),
                  const SizedBox(width: 6),
                  Text(
                    _midiendo
                        ? 'GPS activo'
                        : (_error != null ? 'Error' : 'Detenido'),
                    style: TextStyle(color: colorEstado, fontSize: 13),
                  ),
                ],
              ),
              const Spacer(),
              // Velocidad principal
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      _velocidadMostrada.toStringAsFixed(0),
                      style: const TextStyle(
                        fontSize: 140,
                        fontWeight: FontWeight.w800,
                        height: 1,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      _unidadTexto,
                      style: const TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF00E5FF),
                      ),
                    ),
                  ],
                ),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.redAccent),
                  ),
                ),
              const SizedBox(height: 24),
              // Datos secundarios
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _dato('Precisión',
                      _precision == null ? '--' : '${_precision!.toStringAsFixed(0)} m'),
                  _dato('Altitud',
                      _altitud == null ? '--' : '${_altitud!.toStringAsFixed(0)} m'),
                  _dato('Hora', _formatearHora()),
                ],
              ),
              const Spacer(),
              // Botón principal
              SizedBox(
                width: double.infinity,
                height: 68,
                child: FilledButton.icon(
                  onPressed: _toggleMedicion,
                  icon: Icon(_midiendo ? Icons.stop : Icons.play_arrow,
                      size: 30),
                  label: Text(
                    _midiendo ? 'DETENER' : 'INICIAR',
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor:
                        _midiendo ? Colors.red.shade700 : const Color(0xFF00E5FF),
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _chipUnidad(String texto, _Unit unidad) {
    final activo = _unidad == unidad;
    return GestureDetector(
      onTap: () => setState(() => _unidad = unidad),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: activo ? const Color(0xFF00E5FF) : Colors.white10,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          texto,
          style: TextStyle(
            color: activo ? Colors.black : Colors.white70,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _dato(String etiqueta, String valor) {
    return Column(
      children: [
        Text(
          valor,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(
          etiqueta,
          style: const TextStyle(fontSize: 12, color: Colors.white38),
        ),
      ],
    );
  }
}
