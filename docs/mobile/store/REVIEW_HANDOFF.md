# Store submission handoff

Original preparation: 2026-11-03. iOS handoff updated 2026-11-13.
Drafts below are not submissions or approved declarations. The current iOS
execution record is [IOS_RELEASE_PROGRESS.md](../IOS_RELEASE_PROGRESS.md);
use [APP_STORE_DRAFT.md](../APP_STORE_DRAFT.md) for current listing/review copy,
[the staging guide](../IOS_TESTFLIGHT_STAGING.md) for internal TestFlight, and
[IPHONE_ACCEPTANCE.md](../IPHONE_ACCEPTANCE.md) for actual-device acceptance.

Apple account setup and local implementation have progressed beyond the original
November 3 audit. Source `56c744aa` produced a signed AppStaging archive and local
distribution IPA, version `1.0.0`, build `111120`. The owner uploaded it through
Transporter, supplied the App Store Connect result **Complete, Internal, Ready to
Test**, and installed it through internal TestFlight. The owner reported login,
product search with the keyboard, and scanner camera permission/live image. These
bounded physical-iPhone results do not establish complete device acceptance or an
actual Sandbox purchase. This staging build connects to the isolated Preview and
is restricted by `TFInternalTestingOnly=true`; a normal production `App`/`Release`
App Store candidate remains unprepared. Historical Android observations below are
dated November 3 and are not a fresh console check.

Identity: `kg.bazaar.app`. Production shell: `https://www.bazaar.kg/dashboard`.
Version/build are supplied by `MOBILE_APP_VERSION` / `MOBILE_BUILD_NUMBER`.
The earlier iOS `1.0.0/111112` archive was a local rehearsal. Build `111120` is now
used; check a new unused number before any later native upload. Google Play
accepted build 1 in the historical record.

## Ready to copy

The asset inventory below originated on November 3. Current iOS text, supported
metadata locales and screenshot requirements are governed by
[APP_STORE_DRAFT.md](../APP_STORE_DRAFT.md); the old `listing.json` alone is not a
verified App Store submission package.

- `listing.json`: Russian, English and Kyrgyz names, descriptions and release notes, with field limits checked by `pnpm mobile:store-assets`.
- App Store locales: map `ru` to Russian and `en-US` to English (U.S.). Kyrgyz copy is supplied for the app/marketing and where supported by the console; do not invent an unsupported App Store locale.
- `assets/`: opaque 1024px App Store icon, 512px Play icon, 1024×500 Play feature graphics in three languages. Existing Bazaar logo is preserved.
- Screenshot candidates must retain their provenance. Browser captures of synthetic fixtures are visual preparation only. Replace/verify against the native release on iPhone/iPad and Android before submission. Do not present a browser rendering or a fabricated permission dialog as device verification.
- Proposed category: Business. Proposed free download, existing Bazaar account required. This does not promise a free SaaS subscription or bypass server plan gates.

## Account and signing requirements

Apple: the owner has completed Developer enrollment/payment, bank and tax setup,
and Paid Apps agreements; their active setup was observed in the November 11
record. Full Xcode is installed and its license accepted. Do not repeat those
steps. Xcode account login, the intended team `DWR6Z246Y8`, bundle ID
`kg.bazaar.app` and the owner's device registration were subsequently confirmed.
The `111120` local IPA was verified with Apple Distribution signing for that team,
an unexpired profile, `get-task-allow=false`, no `ProvisionedDevices`, and the
internal-only restriction. Its owner-operated upload and installation are recorded
above. Preserve that identity and the protected signing credentials; signing this
staging build does not establish a normal production App Store candidate.

Remaining verification after internal TestFlight installation:

1. Continue the [iPhone acceptance steps](../IPHONE_ACCEPTANCE.md) against the
   isolated Preview. The bounded login/search/keyboard/camera reports above do not
   cover every device scenario or actual Apple payment. USB pairing is optional
   for TestFlight distribution and is needed only for local device debugging.
2. Approve the actual Apple product model, prices and terms, then complete the
   registered IAP products and server-key setup through protected configuration.
   See [the catalog proposal](../APPLE_CATALOG_PROPOSAL.md). Do not paste private
   keys, passwords or verification codes into chat or Git.
3. Prepare and verify a separate normal production `App`/`Release` candidate and
   the remaining seller, privacy, territory and review declarations before any
   separately authorized public submission. The internal-only staging IPA cannot
   be promoted to the App Store release.

On 13 November the owner's updated Chrome access was verified through the same
browser integration, and the owner completed the fresh Apple login. The owner
accepted the API access request and created the App Manager catalog key; its
private file is held in protected local storage outside Git. The first current
non-renewing product was created as a draft with Russian and English (U.K.)
metadata. Its price and availability remain unset. Catalog registration and
actual Sandbox purchases remain work in progress. Public App Review and release
retain their separate authorization.

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
MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER="$NEXT_BAZAAR_BUILD_NUMBER" pnpm mobile:release android unsigned
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer BAZAAR_MOBILE_ENV=staging \
  MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER="$NEXT_BAZAAR_BUILD_NUMBER" pnpm mobile:release ios unsigned staging-testflight
# After installing the existing protected identities:
MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER="$NEXT_BAZAAR_BUILD_NUMBER" pnpm mobile:release android signed
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer BAZAAR_MOBILE_ENV=staging \
  MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER="$NEXT_BAZAAR_BUILD_NUMBER" pnpm mobile:release ios signed staging-testflight
```

Android needs Node 22, JDK 21 in PATH, Android SDK 36 in ANDROID_HOME. AAB output: `android/app/build/outputs/bundle/release/app-release.aab`. Preserve `mapping/release` with that exact version. An unsigned AAB cannot be uploaded. Verify the signed AAB with jarsigner and compare its upload certificate to the intended Play app. `assembleDebug` produces a development APK. With the same protected signing environment, `./gradlew --no-daemon :app:assembleRelease` in `android/` produces a release APK; build 1 was built and its signature/alignment verified locally. Direct APK distribution uses the upload key, whereas Play uses its own app signing key, so these channels cannot update each other in place. Physical installation and public APK hosting are outstanding.

iOS signed mode creates an archive and locally exported IPA under `artifacts/mobile-release-<version>-<build>/`; it does not upload. Unsigned mode only rehearses compilation. Confirm SDK using `xcrun --sdk iphoneos --show-sdk-version`, validate the signed archive in Organizer, upload to the intended App Store Connect app, wait for processing, then select the build for internal TestFlight.

For the isolated preview use the explicit `staging-testflight` release channel;
its separate `AppStaging`/`ReleaseStaging` build and output directory require an
internal-only TestFlight export. The normal production channel rejects its
archive. Follow [the staging guide](../IOS_TESTFLIGHT_STAGING.md); after testing,
create a new normal `App`/`Release` for any separately authorized App Store path.

`.github/workflows/mobile-build.yml` is a manual **unsigned build rehearsal** for both platforms. It requires a pushed workflow and working Actions access. It neither signs nor uploads. Local preparation of this workflow is not a successful hosted build. Do not push main merely to run it if that would trigger an unauthorized web production deployment.

After signed uploads: configure Play internal testing and TestFlight internal testers; run the complete release checklist on real devices. External TestFlight can require beta review. For affected new personal Play accounts, internal testing does not replace the 12-testers/14-consecutive-days closed-test requirement for production access. Complete console questionnaires and review credentials, then obtain confirmation of seller, privacy/payment declarations and public submission/release settings. Keep release manual after approval until explicitly authorized.

## Release checks beyond certificates

Implementation and automated evidence do not complete the physical-device or
store-declaration gates below. See the current execution record for check results.

1. **Account deletion:** an in-app own-account flow and server enforcement are now implemented and regression-tested, including authentication/session invalidation, owner handling and preservation of required company records. Verify the actual shipping flow, public policy/support links and Apple renewal warning on iPhone. See [the privacy/deletion record](../IOS_PRIVACY_ACCOUNT_DELETION.md); the November 3 “not found” finding is superseded.
2. **Privacy:** the current compiled app manifest includes 18 app-level collected-data categories plus Filesystem timestamp use (`C617.1`). AI consent/revocation and current policy text are implemented; final deployed links, seller/controller contacts, retention/processor declarations and App Store privacy answers still need release verification. See [the data audit](../IOS_APP_PRIVACY_AUDIT.md). This does not establish “no data collected,” and no public legal/contact value is invented here.
3. **Billing:** StoreKit 2, server-verified Apple records, shared organization access with web GoPay, overlap guards and attempt-bound cancellation/recovery are implemented and tested. Direct current-term tier/store/reserve upgrades over a prepaid GoPay or non-renewing Apple term (proposal C) are implemented and verified by unit and isolated real-database tests; see [temporary upgrades](../APPLE_TEMPORARY_UPGRADES.md). Commercial Apple products, price bands, discount/minimum policy and terms are not approved, and sales remain disabled. Actual server setup and real Sandbox/iPhone purchase, cancellation and restore remain open. Existing GoPay-paid access must work without a second charge for the same coverage. Use the Apple purchase path for iOS digital sales; do not rely on the old draft's possible enterprise exemption or enable unapproved commercial terms.
4. **Push:** Firebase/APNs credentials and physical-device delivery are unverified. The November 3 source audit noted no production callers of `sendMobilePushToUsers`; recheck the intended release behavior instead of treating that old observation as current end-to-end evidence. Advertise only delivery behavior verified on the actual build.
5. **Links:** on 2026-11-03 production assetlinks was `[]`, and AASA had empty application details. Configure real team/app-signing identities and verify HTTPS app/universal links. Custom `bazaar:` links are a separate mechanism.
6. **Devices and assets:** scanning, file sharing, offline recovery, keyboard/safe areas, session changes and native screenshots remain device gates. Native features add utility beyond a web wrapper but do not guarantee approval under guideline 4.2.

## Review instructions draft (English)

Bazaar is a retail operations application for authorized staff of stores. It provides access to products, stock, sales, inventory documents, orders and reports. Access depends on the staff role and organization plan. It connects to the existing Bazaar service over HTTPS and requires an internet connection. Native integrations include barcode scanning and system document sharing.

Provide an active review account backed by a dedicated demonstration organization, with the needed plan/features, seeded synthetic products and a store/register. Include exact login details through the stores' private review-access fields; do not commit credentials here. Demonstrate camera permission denial and recovery, a known product barcode, document sharing and reconnect behavior. Do not require reviewers to make a real sale, payment or contact the owner to unlock access.

The private preview fixtures and implemented deletion/policy pages do not prove
the App Store Connect fields are completed. Verify the actual review login/contact,
legal seller, age/content questionnaires, privacy labels, public policy/deletion
instructions, subscription terms, copyright, countries and release controls before
submission. These remain declaration/acceptance gates, not ready-to-upload
placeholder values.

## Official references checked 2026-11-03

- [Apple SDK minimum, effective April 28, 2026](https://developer.apple.com/news/?id=ueeok6yw)
- [Android target API requirement](https://developer.android.com/google/play/requirements/target-sdk)
- [Apple account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/)
- [Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Play personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Apple review guidelines including 3.1 and 4.2](https://developer.apple.com/app-store/review/guidelines/)
- [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Play listing assets](https://support.google.com/googleplay/android-developer/answer/9866151)
