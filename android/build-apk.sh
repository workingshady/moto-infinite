#!/usr/bin/env bash
# Builds the signed release APK (and AAB) of the Moto Infinite TWA, i.e. what `bubblewrap build` does,
# without prompts. Run from git bash:  bash android/build-apk.sh
#
# Needs: JDK 17, the Android SDK (build-tools 36.1.0, platform 36) and the release keystore, which lives
# OUTSIDE the repo. Passwords come from the environment, never from a file in the repo:
#   export BUBBLEWRAP_KEYSTORE_PASSWORD='...'   # from C:\Users\worki\moto-infinite-signing\KEEP-SAFE.txt
#   export BUBBLEWRAP_KEY_PASSWORD='...'        # optional, defaults to the store password (PKCS12)
set -euo pipefail

cd "$(dirname "$0")"
: "${BUBBLEWRAP_KEYSTORE_PASSWORD:?set BUBBLEWRAP_KEYSTORE_PASSWORD (see KEEP-SAFE.txt)}"
export KSPW="$BUBBLEWRAP_KEYSTORE_PASSWORD"
export KEYPW="${BUBBLEWRAP_KEY_PASSWORD:-$BUBBLEWRAP_KEYSTORE_PASSWORD}"
export JAVA_HOME="${JAVA_HOME:-/c/Program Files/Java/jdk-17}"
export PATH="$JAVA_HOME/bin:$PATH"
SDK="${ANDROID_HOME:-/d/dev/Android/Sdk}"
BT="$SDK/build-tools/36.1.0"
KEYSTORE="${MOTO_KEYSTORE:-/c/Users/worki/moto-infinite-signing/keystore.jks}"
ALIAS=motoinfinite

if command -v cmd >/dev/null 2>&1; then cmd //c ".\\gradlew.bat assembleRelease bundleRelease"; else ./gradlew assembleRelease bundleRelease; fi

"$BT/zipalign" -f -p 4 app/build/outputs/apk/release/app-release-unsigned.apk app-release-unsigned-aligned.apk
java -jar "$BT/lib/apksigner.jar" sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" \
  --ks-pass env:KSPW --key-pass env:KEYPW --out app-release-signed.apk app-release-unsigned-aligned.apk
rm -f app-release-unsigned-aligned.apk app-release-signed.apk.idsig
jarsigner -keystore "$KEYSTORE" -storepass:env KSPW -keypass:env KEYPW \
  -signedjar app-release-bundle.aab app/build/outputs/bundle/release/app-release.aab "$ALIAS" >/dev/null

java -jar "$BT/lib/apksigner.jar" verify --print-certs app-release-signed.apk | grep -i "SHA-256"
echo "Built android/app-release-signed.apk and android/app-release-bundle.aab"
