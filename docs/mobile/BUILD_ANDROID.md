# Android build

## Identity

- Application ID: `kg.bazaar.app`
- Version: `BAZAAR_ANDROID_VERSION_NAME` (default `1.0.0`)
- Build: `BAZAAR_ANDROID_VERSION_CODE` (default `1`)
- Minimum SDK: 26 (Android 8; required by native barcode scanning)
- Compile/target SDK: 36

## Build

Install Node 22, JDK 21 and Android SDK 36, then:

```bash
BAZAAR_MOBILE_ENV=production pnpm mobile:sync
cd android
./gradlew assembleDebug bundleRelease
```

Outputs:

```text
android/app/build/outputs/apk/debug/app-debug.apk
android/app/build/outputs/bundle/release/app-release.aab
```

## Release signing

Never commit a keystore. Supply these only in the protected release environment:

```text
BAZAAR_ANDROID_KEYSTORE_PATH
BAZAAR_ANDROID_KEYSTORE_PASSWORD
BAZAAR_ANDROID_KEY_ALIAS
BAZAAR_ANDROID_KEY_PASSWORD
```

Add the release certificate SHA-256 fingerprint to `ANDROID_APP_LINK_SHA256_FINGERPRINTS` on the server. Multiple fingerprints are comma-separated. Add Firebase's `google-services.json` only in the protected build workspace; it is ignored by Git.

Before Play upload, verify the AAB signature, Play App Signing identity, `https://www.bazaar.kg/.well-known/assetlinks.json`, camera-on-demand, notification rationale, links, offline mutation denial, and the POS regression matrix.
