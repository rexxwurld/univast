#!/usr/bin/env bash
# Creates a permanent signing key for UNIVAST and prints the four values to add as GitHub repository secrets.
# Keep univast-release.keystore somewhere safe (NOT in git): lose it and phones must uninstall before updating.
set -euo pipefail

ALIAS="${1:-univast}"
read -rsp "Choose a keystore password (min 6 chars): " PASS; echo
KEYSTORE="univast-release.keystore"

keytool -genkeypair -v -keystore "$KEYSTORE" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=UNIVAST, O=UNIVAST, C=NG"

echo
echo "Add these in GitHub: Settings > Secrets and variables > Actions > New repository secret"
echo "  ANDROID_KEYSTORE_PASSWORD = (the password you just typed)"
echo "  ANDROID_KEY_PASSWORD      = (same password)"
echo "  ANDROID_KEY_ALIAS         = $ALIAS"
echo "  ANDROID_KEYSTORE_BASE64   = (contents of the file below)"
base64 -w0 "$KEYSTORE" > "$KEYSTORE.base64.txt" 2>/dev/null || base64 "$KEYSTORE" | tr -d '\n' > "$KEYSTORE.base64.txt"
echo "    $KEYSTORE.base64.txt"
