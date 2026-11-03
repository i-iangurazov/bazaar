# Store submission handoff

Prepared 2026-11-03. Drafts below are not submissions or approved declarations.
Identity: `kg.bazaar.app`. Production shell: `https://www.bazaar.kg/dashboard`.
Marketing version/build: `MOBILE_APP_VERSION=1.0.0`, `MOBILE_BUILD_NUMBER=1`.
Google Play has accepted build 1; use a new version code (at least 2) for another AAB upload. Check the next unused build number in both consoles before uploading.

## Ready to copy

- `listing.json`: Russian, English and Kyrgyz names, descriptions and release notes, with field limits checked by `pnpm mobile:store-assets`.
- App Store locales: map `ru` to Russian and `en-US` to English (U.S.). Kyrgyz copy is supplied for the app/marketing and where supported by the console; do not invent an unsupported App Store locale.
- `assets/`: opaque 1024px App Store icon, 512px Play icon, 1024×500 Play feature graphics in three languages. Existing Bazaar logo is preserved.
- Screenshot candidates must retain their provenance. Browser captures of synthetic fixtures are visual preparation only. Replace/verify against the native release on iPhone/iPad and Android before submission. Do not present a browser rendering or a fabricated permission dialog as device verification.
- Proposed category: Business. Proposed free download, existing Bazaar account required. This does not promise a free SaaS subscription or bypass server plan gates.

## Account and signing requirements

Apple: the owner confirmed on 2026-11-03 that only a Google developer account exists. Apple Developer enrollment is therefore outstanding. Verify account holder/legal seller and agreements during enrollment, then create the app record and check the bundle identifier. No Apple team can be inferred from the website domain or the seller's bank account. Install full Xcode with iOS SDK 26+; local Command Line Tools cannot archive. Install Apple Distribution certificate/private key and matching App Store provisioning, including Push Notifications and Associated Domains. Set `APPLE_TEAM_ID` only to the real team. Existing valid identities/profiles were not found on the checked Mac.

Google: the owner's **personal Chrome profile** successfully opened the Ilias Iangurazov Personal developer account. Bazaar was absent from its app list. The Create app form confirmed **Package name available** for `kg.bazaar.app`; name Bazaar, Russian default language, App and Free were prepared. The owner then checked both declarations and explicitly confirmed creation. Bazaar app record `4973851578570693264` now exists; a signed version 1.0.0/build 1 AAB was uploaded into internal release 1. The Bazaar dashboard explicitly requires 12 closed-test participants for 14 consecutive days before applying for production access. Internal release 1.0.0/build 1 is now published, track Active, with the owner as the sole eligible tester. The invite link opens successfully; installation/real device checks remain outstanding. The initial check in an unrelated work profile was discarded. No Play service account or upload keystore settings were supplied locally. The existing Android debug keystore is not a protected upload identity.

Do not generate a replacement upload key for an existing listing. Obtain the established upload identity or use the console's supported recovery. For this new package, the owner explicitly authorized a new dedicated Bazaar upload key after automatic approval review initially required explicit consent. The key was created at `~/.local/share/bazaar-release/android/bazaar-upload.keystore` (0600, directory 0700), password in macOS Keychain service `kg.bazaar.app.android-upload`, account `bazaar-upload`. Back up this key and its password securely. Do not substitute the signing identity of another app. Enable Play App Signing. Play App Signing is confirmed enabled. Its current **app signing** SHA-256 fingerprint is `F7:53:85:3A:89:27:64:DF:99:BD:FE:23:06:A8:01:F1:68:13:3F:F5:E1:F0:92:B3:EC:3A:AA:05:C6:1A:C5:04`. Set this in server `ANDROID_APP_LINK_SHA256_FINGERPRINTS`; the exact console JSON is prepared in `assetlinks.production.json`. It has not been deployed. The upload certificate is a different identity.

Keep secrets in a protected environment/keychain, never in chat, Git or screenshots:

```text
BAZAAR_ANDROID_KEYSTORE_PATH
BAZAAR_ANDROID_KEYSTORE_PASSWORD
BAZAAR_ANDROID_KEY_ALIAS
BAZAAR_ANDROID_KEY_PASSWORD
APPLE_TEAM_ID
APNS_TEAM_ID / APNS_KEY_ID / APNS_PRIVATE_KEY
APNS_ENVIRONMENT=production / APNS_BUNDLE_ID=kg.bazaar.app
FCM_SERVICE_ACCOUNT_JSON_BASE64 (server only)
android/app/google-services.json (build workspace only)
```

## Reproducible build and upload sequence

```bash
pnpm install --frozen-lockfile
pnpm mobile:test
pnpm mobile:store-assets
MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER=1 pnpm mobile:release android unsigned
MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER=1 pnpm mobile:release ios unsigned
# After installing the existing protected identities:
MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER=1 pnpm mobile:release android signed
MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER=1 pnpm mobile:release ios signed
```

Android needs Node 22, JDK 21 in PATH, Android SDK 36 in ANDROID_HOME. AAB output: `android/app/build/outputs/bundle/release/app-release.aab`. Preserve `mapping/release` with that exact version. An unsigned AAB cannot be uploaded. Verify the signed AAB with jarsigner and compare its upload certificate to the intended Play app. `assembleDebug` produces a development APK. With the same protected signing environment, `./gradlew --no-daemon :app:assembleRelease` in `android/` produces a release APK; build 1 was built and its signature/alignment verified locally. Direct APK distribution uses the upload key, whereas Play uses its own app signing key, so these channels cannot update each other in place. Physical installation and public APK hosting are outstanding.

iOS signed mode creates an archive and locally exported IPA under `artifacts/mobile-release-<version>-<build>/`; it does not upload. Unsigned mode only rehearses compilation. Confirm SDK using `xcrun --sdk iphoneos --show-sdk-version`, validate the signed archive in Organizer, upload to the intended App Store Connect app, wait for processing, then select the build for internal TestFlight.

`.github/workflows/mobile-build.yml` is a manual **unsigned build rehearsal** for both platforms. It requires a pushed workflow and working Actions access. It neither signs nor uploads. Local preparation of this workflow is not a successful hosted build. Do not push main merely to run it if that would trigger an unauthorized web production deployment.

After signed uploads: configure Play internal testing and TestFlight internal testers; run the complete release checklist on real devices. External TestFlight can require beta review. For affected new personal Play accounts, internal testing does not replace the 12-testers/14-consecutive-days closed-test requirement for production access. Complete console questionnaires and review credentials, then obtain confirmation of seller, privacy/payment declarations and public submission/release settings. Keep release manual after approval until explicitly authorized.

## Review blockers independent of certificates

1. **Account deletion:** production login exposes account creation; a complete account deletion path was not found in the audited source. Implement and verify an in-app initiation flow and an externally reachable deletion-request URL. Define ownership transfer and documented retention of financial/audit records before deleting business users; never cascade-delete store records as a shortcut. A generic help link, disabling an employee or an unimplemented form does not establish compliance.
2. **Privacy:** the local iOS manifest now declares Filesystem file timestamp access (`C617.1`); this does not mean “no data collected.” Complete App Privacy and Play Data safety against both the native shell and all web/server features available through it. Obtain the real seller/controller, contact, retention policy and processor list. No legal identity/contact is invented here.
3. **Billing:** the app includes `/billing`, subscription checkout and a contact-to-upgrade link. Store billing/enterprise/companion-app treatment must be resolved for the actual seller, account model and storefronts. Do not claim an exemption or enable collection based on this draft. Existing business access and website billing were not changed by this release preparation.
4. **Push:** Firebase file/APNs credentials and physical-device delivery are unverified. `sendMobilePushToUsers` has no production call sites in the audited source; foundation code is not an end-to-end notification feature. Do not advertise notifications or use mock sends as evidence. Decide whether the first release includes tested push before completing privacy/review notes.
5. **Links:** on 2026-11-03 production assetlinks was `[]`, and AASA had empty application details. Configure real team/app-signing identities and verify HTTPS app/universal links. Custom `bazaar:` links are a separate mechanism.
6. **Devices and assets:** scanning, file sharing, offline recovery, keyboard/safe areas, session changes and native screenshots remain device gates. Native features add utility beyond a web wrapper but do not guarantee approval under guideline 4.2.

## Review instructions draft (English)

Bazaar is a retail operations application for authorized staff of stores. It provides access to products, stock, sales, inventory documents, orders and reports. Access depends on the staff role and organization plan. It connects to the existing Bazaar service over HTTPS and requires an internet connection. Native integrations include barcode scanning and system document sharing.

Provide an active review account backed by a dedicated demonstration organization, with the needed plan/features, seeded synthetic products and a store/register. Include exact login details through the stores' private review-access fields; do not commit credentials here. Demonstrate camera permission denial and recovery, a known product barcode, document sharing and reconnect behavior. Do not require reviewers to make a real sale, payment or contact the owner to unlock access.

The following are deliberately unset until verified: review login/contact, legal seller, age/content questionnaires, privacy labels, deletion URL, subscription-policy declarations, copyright, countries and public release controls. These are submission gates, not ready-to-upload placeholder values.

## Official references checked 2026-11-03

- [Apple SDK minimum, effective April 28, 2026](https://developer.apple.com/news/?id=ueeok6yw)
- [Android target API requirement](https://developer.android.com/google/play/requirements/target-sdk)
- [Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/)
- [Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Play personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Apple review guidelines including 3.1 and 4.2](https://developer.apple.com/app-store/review/guidelines/)
- [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Play listing assets](https://support.google.com/googleplay/android-developer/answer/9866151)
