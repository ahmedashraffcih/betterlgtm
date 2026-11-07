# Signing and notarizing the macOS app

The Release workflow signs the macOS app with a **Developer ID Application** certificate and has Apple **notarize** it, so it opens without Gatekeeper warnings. Both turn on when the secrets below exist; without them the build is unsigned.

## What you need

- A paid [Apple Developer Program](https://developer.apple.com/programs/) membership ($99 a year). Only the Account Holder can create Developer ID certificates.
- The private key and certificate request for the certificate. Keep the key outside the repo; for this project it lives in `~/.betterlgtm-signing/`.

## 1. Create the certificate

1. Make a private key and a certificate signing request (skip if you already have `~/.betterlgtm-signing/DeveloperID.certSigningRequest`):

   ```bash
   mkdir -p ~/.betterlgtm-signing && cd ~/.betterlgtm-signing
   openssl genrsa -out developer-id.key 2048
   openssl req -new -key developer-id.key -out DeveloperID.certSigningRequest -subj "/emailAddress=you@example.com/CN=Your Name"
   ```

2. Go to [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/add), choose **Developer ID Application**, pick the **G2 Sub-CA**, and upload `DeveloperID.certSigningRequest`.
3. Download the certificate (`developerID_application.cer`) into `~/.betterlgtm-signing/`.

## 2. Create a notarization key

1. In [App Store Connect › Users and Access › Integrations › App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api), create a **Team Key** with the **Developer** role.
2. Download `AuthKey_<KEY ID>.p8` (it can only be downloaded once) into `~/.betterlgtm-signing/`.
3. Note the **Issuer ID** shown above the keys list.

## 3. Add the GitHub secrets

```bash
scripts/macos-signing-secrets.sh \
  ~/.betterlgtm-signing/developerID_application.cer \
  ~/.betterlgtm-signing/developer-id.key \
  ~/.betterlgtm-signing/AuthKey_<KEY ID>.p8 <ISSUER ID>
```

The script packs the certificate and key into a password-protected `.p12` and sets these repository secrets with `gh`:

| Secret | Contents |
|---|---|
| `APPLE_CERTIFICATE` | The `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | A random password for the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_API_KEY_P8` | The `.p8` notarization key |
| `APPLE_API_KEY` | The key ID |
| `APPLE_API_ISSUER` | The issuer ID |

## 4. Release

Tag a release as usual (see [CONTRIBUTING.md](../CONTRIBUTING.md#releasing)). The macOS jobs import the certificate into a temporary keychain, sign the app with the hardened runtime, submit it to Apple's notary service, staple the ticket, and then check the result with `codesign`, `stapler` and `spctl`.

To check a downloaded build yourself on a Mac:

```bash
codesign -dv --verbose=2 /Applications/BetterLGTM.app
spctl --assess --type execute --verbose /Applications/BetterLGTM.app
```

`spctl` should print `accepted` and `source=Notarized Developer ID`.

## Renewing

Developer ID certificates last five years. Repeat steps 1 and 3 before it expires; already-notarized releases keep working.
