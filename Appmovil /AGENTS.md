# Velocímetro GPS (Flutter)

App Android que muestra la velocidad usando el GPS del dispositivo.

## Stack
- Flutter 3.35.4 stable, Dart 3.9.2
- Paquete `geolocator` para ubicación/velocidad

## Entorno (instalado manualmente en esta máquina)
- Flutter SDK: `~/dev/flutter`
- JDK 17 (Temurin): `~/dev/tools/jdk-17.0.21+9`
- Android SDK: `~/dev/android-sdk` (cmdline-tools, platform-tools, platforms;android-36, build-tools 35/36, NDK, CMake)

## Comandos

```bash
# Build del APK release (configura las variables de entorno solo)
./build-apk.sh

# Equivalente manual:
export JAVA_HOME=~/dev/tools/jdk-17.0.21+9/Contents/Home
export ANDROID_HOME=~/dev/android-sdk
export PATH=~/dev/flutter/bin:$JAVA_HOME/bin:$PATH
cd "Appmovil "
flutter build apk --release
```

## Notas
- El APK sale firmado con el certificado **debug** de Flutter. Para Google Play Store hace falta generar un keystore de release (`keytool -genkey`) y configurarlo en `android/app/build.gradle` + `android/key.properties`.
- Permisos GPS declarados en `android/app/src/main/AndroidManifest.xml` (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`).
- Código principal: `lib/main.dart`.
