#!/bin/bash
# Genera el APK release del velocímetro.
# Uso: ./build-apk.sh   (desde la carpeta del proyecto)

set -e

export JAVA_HOME="$HOME/dev/tools/jdk-17.0.21+9/Contents/Home"
export ANDROID_HOME="$HOME/dev/android-sdk"
export ANDROID_SDK_ROOT="$HOME/dev/android-sdk"
export PATH="$HOME/dev/flutter/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$JAVA_HOME/bin:$PATH"

cd "$(dirname "$0")"
flutter pub get
flutter build apk --release

echo ""
echo "APK generado en:"
echo "  build/app/outputs/flutter-apk/app-release.apk"
