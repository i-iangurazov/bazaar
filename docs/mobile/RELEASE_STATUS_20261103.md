# Bazaar mobile release preparation — 2026-11-03

Work is on **main**, as explicitly requested by the owner during this task. Starting source: `8c95e74`. Unrelated concurrent changes to signup attribution, translations, privacy and marketing are outside this delivery. The release preparation does not deploy the website or change business records. A signed Android AAB has been uploaded and published to the active Google Play internal track; public review submission has not occurred.

## Completed

- Confirmed merged [Capacitor PR #6](https://github.com/i-iangurazov/bazaar/pull/6) and live GitHub production configuration. Application identity remains `kg.bazaar.app`; shell loads `https://www.bazaar.kg/dashboard`.
- Added release commands with a consistent version/build across Android and iOS, explicit signed/unsigned modes, signing prerequisites and SDK/version guards. Signed mode checks AAB signature; iOS export writes a local App Store Connect IPA without uploading.
- Added iOS Filesystem privacy manifest to the Xcode resources, localized camera descriptions (en/ru/ky), and a common default marketing version `1.0.0`.
- Prepared manual hosted unsigned Android/iOS archive workflow; not pushed or executed remotely.
- Prepared localized listing copy, two store icons, three feature graphics, review handoff and PWA installation instructions. Saved the Google Play store listing draft in ru/en/ky, with icon and default feature graphic. Final native screenshots remain a required asset gate.
- Captured and inspected 14 phone/tablet browser screenshots using a local production build and isolated synthetic fixtures. Native-device capture remains outstanding.
- Built Android **signed and unsigned release AABs**, **signed release APK** and **debug APK** using JDK 21 / SDK 36. App ID and target SDK were checked in the merged release manifest. Both AAB/debug outputs initially existed as older outputs; the successful final build reran package tasks and preserved the resulting artifacts.

## Verification

| Check | Result |
| --- | --- |
| `pnpm mobile:sync` | Passed, 11 native plugins |
| `pnpm mobile:test` | 63 tests passed, including 8 release identity cases |
| PWA manifest focused tests | 2 passed |
| Database mobile registrations | 5 passed in a newly initialized PostgreSQL on 127.0.0.1:55461, `bazaar_hardening_ci`; no production DB access |
| TypeScript, Next lint, i18n | Passed; final checkpoint logs kept with artifacts |
| Production Next build | Passed in an isolated source copy; 129 pages; two workers and cache disabled to fit disk |
| Android `:app:bundleRelease :app:assembleDebug :app:lintRelease` | Passed; release lint 0 errors / 22 warnings (resources, icons, SDK/dependency recommendations) |
| Debug APK zipalign, 16 KB | Passed |
| Signed Release APK | `assembleRelease` passed; `apksigner verify --print-certs` matches Bazaar upload certificate; zipalign 16 KB passed; package 1.0.0 (1), SDK 36, no debug flag |
| AAB assets/config | Production URL, no forbidden server credential setting names in text assets; signed upload identity verified; an unsigned rehearsal is preserved separately |
| 64-bit ELF load-segment alignment | All 10 packaged arm64/x86_64 libraries have 16 KB alignment; device runtime not tested |
| iOS plist/Xcode resource syntax | `plutil -lint` passed |
| iOS Release archive | Attempted; stopped before compilation: full Xcode missing, active path `/Library/Developer/CommandLineTools` |
| Android device | `adb devices -l` returned an empty list |

Initial Android lint and web build attempts hit ENOSPC. Only this run's disposable source copies and downloaded Gradle documentation/source were removed; web build and target Android lint were rerun successfully. The test PostgreSQL was recovered after the disk incident, then shut down with its disposable data removed after screenshots. Local generated Prisma client was restored. No customer database reset, seed, migration or transaction was performed.

Artifacts (ignored, local):

```text
artifacts/mobile-release-20261103/builds/Bazaar-1.0.0-1-signed.aab
artifacts/mobile-release-20261103/builds/Bazaar-1.0.0-1-unsigned.aab
artifacts/mobile-release-20261103/builds/Bazaar-1.0.0-1-debug.apk
artifacts/mobile-release-20261103/builds/Bazaar-1.0.0-1-release.apk
artifacts/mobile-release-20261103/builds/mapping/
artifacts/mobile-release-20261103/bundle-audit.json
artifacts/mobile-release-20261103/public-checks.json
artifacts/mobile-release-20261103/logs/
```

## Release boundaries and remaining blockers

1. **Android signing:** completed after explicit owner approval. A dedicated RSA-4096 Bazaar upload key is stored outside Git at `~/.local/share/bazaar-release/android/bazaar-upload.keystore` (0600; parent 0700). Password is in macOS Keychain, service `kg.bazaar.app.android-upload`, account `bazaar-upload`. Signed AAB signature was verified. Secure off-device backup remains an owner operation. The upload key is not the Google Play app signing key.
2. **Play app creation:** completed after the owner checked and confirmed declarations. App ID `4973851578570693264`, package `kg.bazaar.app`, Personal developer account. Signed AAB version 1.0.0/build 1 published to the internal track, with ru/en/ky notes. Track is Active and the owner is the sole eligible tester after explicit consent. The invite page was checked and shows the invitation; accepting it and device installation remain user steps. Dashboard explicitly requires a closed test with at least 12 testers for 14 consecutive days before applying for production access. The closed test has not started; the owner reports no group of 12 testers available.
3. **Apple:** owner confirmed no Apple developer account. Enrollment, team, agreements, distribution certificate/private key, provisioning, full Xcode with SDK 26+, archive validation and TestFlight are outstanding.
4. **Store policy/service readiness:** account deletion flow/public deletion URL not established; privacy/data safety, actual seller/contact/retention and billing treatment require completion. The web billing screen can initiate subscription checkout; do not assert a store-policy exemption.
5. **Native integration verification:** no physical device. Scanning, permission denial/retry, file sharing, offline mutation recovery, session/store switching, keyboard/safe areas, app links and final native screenshots remain device gates.
6. **Push/links:** APNs/FCM setup is unverified; source push sender has no production call sites. Production assetlinks and AASA application lists were empty. The actual Play App Signing SHA-256 fingerprint was obtained from the console and `store/assetlinks.production.json` prepared; no production web configuration was changed. Native notifications are not advertised as a completed feature.

## Fastest available installation

[Add Bazaar to the home screen](INSTALL_BEFORE_STORE_REVIEW.md) from Safari on iPhone/iPad or Chrome on Android. HTTPS manifest, service worker, login and icons were checked on the public service. This requires no store approval; physical-device installation itself was not tested here. It remains an online web application with existing account/role/plan controls. No public store publication date is promised.

A signed release APK is also preserved for direct Android distribution, with verified signature/package/alignment. No public APK hosting or physical installation is established. Its upload-key signing identity differs from the Google Play distributed app; switching channels requires uninstalling the previous app and loses local settings/session. Verify a phone before broad APK distribution.

Machine-readable evidence: [verification record](store/verification-20261103.json).

Full account/signing/review procedure and official policy references: [store/REVIEW_HANDOFF.md](store/REVIEW_HANDOFF.md).

## Confirmed internal installation link

[Join the Bazaar internal test](https://play.google.com/apps/internaltest/4701689887089077061) using the owner Google account explicitly approved for the tester list. The page shows a valid invitation, while the track shows Active and Available to internal testers. Temporary name: `kg.bazaar.app (unreviewed)`. Invitation acceptance and installation on Android remain user/device steps; no phone was attached here.

Play App Signing is enabled and the signing key is managed by Google. Public app signing SHA-256: `F7:53:85:3A:89:27:64:DF:99:BD:FE:23:06:A8:01:F1:68:13:3F:F5:E1:F0:92:B3:EC:3A:AA:05:C6:1A:C5:04`. This differs from the upload certificate recorded in the verification JSON.
