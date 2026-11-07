#!/usr/bin/env bash
# Turns an Apple Developer ID certificate into the GitHub secrets the Release workflow signs with.
#
#   scripts/macos-signing-secrets.sh <developerID_application.cer> <private.key> [AuthKey_XXXX.p8 <issuer-id>]
#
# The .cer comes from developer.apple.com, made from a request signed with <private.key>.
# The optional .p8 and issuer id come from App Store Connect and turn on notarization.
set -euo pipefail

cer=${1:?certificate .cer}
key=${2:?private key}
p8=${3:-}
issuer=${4:-}
repo=${REPO:-drmas/betterlgtm}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

openssl x509 -inform DER -in "$cer" -out "$work/cert.pem" 2>/dev/null || cp "$cer" "$work/cert.pem"
identity=$(openssl x509 -in "$work/cert.pem" -noout -subject -nameopt multiline | sed -n 's/^ *commonName *= *//p')
case "$identity" in
  "Developer ID Application:"*) ;;
  *) echo "Expected a 'Developer ID Application' certificate, got: $identity" >&2; exit 1 ;;
esac

password=$(openssl rand -base64 24)
openssl pkcs12 -export -legacy -inkey "$key" -in "$work/cert.pem" -name "$identity" \
  -out "$work/cert.p12" -passout "pass:$password" 2>/dev/null \
  || openssl pkcs12 -export -inkey "$key" -in "$work/cert.pem" -name "$identity" \
       -out "$work/cert.p12" -passout "pass:$password"

base64 -w0 "$work/cert.p12" | gh secret set APPLE_CERTIFICATE -R "$repo"
printf '%s' "$password" | gh secret set APPLE_CERTIFICATE_PASSWORD -R "$repo"
printf '%s' "$identity" | gh secret set APPLE_SIGNING_IDENTITY -R "$repo"
echo "Signing secrets set for: $identity"

if [ -n "$p8" ]; then
  key_id=$(basename "$p8" .p8); key_id=${key_id#AuthKey_}
  gh secret set APPLE_API_KEY_P8 -R "$repo" < "$p8"
  printf '%s' "$key_id" | gh secret set APPLE_API_KEY -R "$repo"
  printf '%s' "${issuer:?issuer id is required with the .p8}" | gh secret set APPLE_API_ISSUER -R "$repo"
  echo "Notarization secrets set for key $key_id"
fi
