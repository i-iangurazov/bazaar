# Isolated iOS staging and internal TestFlight

This channel is for the isolated Bazaar preview before the production release.
It preserves bundle ID `kg.bazaar.app`, Capacitor plugins and the existing iPhone /
iPad capabilities. A staging install uses the same app identity and can replace
another installed Bazaar build; it is not a separate App Store product.

## Fixed build boundary

| Channel | Scheme / configuration | Remote app | Distribution |
| --- | --- | --- | --- |
| Normal production | `App` / `Release` | `https://www.bazaar.kg/dashboard` | App Store path after separate authorization |
| Isolated staging | `AppStaging` / `ReleaseStaging` | `https://bazaar-ios-preview-20261111.vercel.app/dashboard` | Internal TestFlight only |
| Existing development | `App` / `Debug` | Explicit compiled development configuration | Local development; not a store archive |

`ReleaseStaging` is optimized Release code with `BAZAAR_STAGING`, not `DEBUG`.
Native code compiles its exact HTTPS origin, blocks other hosts/ports and rejects
a mismatched bundled configuration before WebKit loads a remote page. The normal
Release continues to trust only the official `www` origin. Staging and DEBUG
cannot be combined. JavaScript has no origin or environment selector.

The `Prepare fixed native channel` build phase produces the final
`App.app/capacitor.config.json` from the shared source. It writes inside that
configuration's build directory, retains plugin configuration/class registration,
disables result logging and web inspection for both Release channels, and sets the
exact URL/navigation host and channel marker. It does not overwrite the source
JSON. The release helper syncs only iOS with the production base configuration,
then the staging configuration generates its isolated copy. Building staging
therefore does not switch the next production source configuration to a preview.
Normal Release refuses a non-production source URL.

`Info.plist` and the bundled JSON both identify the channel and allowed
distribution. Staging displays **Bazaar Test** while keeping the established icon.
The release helper inspects the actual archived app's bundle ID, version/build,
markers, URL/navigation host, cleartext, logging and inspection settings before
export. A staging archive cannot be exported through its production path.

For staging export it always writes `testFlightInternalTestingOnly = true`.
Apple states that these builds cannot be distributed through external TestFlight
or the App Store; internal testers must be App Store Connect users with access to
the app. This flag was confirmed in the installed Xcode 26.6 CLI help. Use the
generated export options, not a manually substituted distribution method.
See [Apple distribution options](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
and [internal tester restrictions](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers).

## Sandbox and isolated services

TestFlight apps use Apple's Sandbox for In-App Purchases. This is Apple's actual
test environment, not a simulated success in Bazaar. A Sandbox Apple Account is
needed for additional scenario controls; it is distinct from a Bazaar login and
from the account used to install TestFlight. Device account changes remain owner
actions. [Apple's TestFlight purchase guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testing-subscriptions-and-in-app-purchases-in-testflight)
and [StoreKit Sandbox guide](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox)
describe the current behavior.

The compiled staging bridge additionally requires `environment: "Sandbox"` in
the authenticated server authorization before opening an Apple sheet. It filters
non-Sandbox verified transaction updates/history/unfinished evidence and refuses
their server ACK/refund paths, avoiding forwarding production purchase history
from the same bundle ID to the preview. On iOS 15, where StoreKit lacks the native
environment property, this exclusion uses the payload of already StoreKit-verified
JWS. It never replaces server cryptographic verification or grants access.

The preview server must independently use `VERCEL_ENV=preview`,
`APPLE_BILLING_MODE=sandbox`, the exact `APPLE_BILLING_PREVIEW_ORIGIN`, and an
allowlist containing only dedicated synthetic organizations. Its database,
storage, cookies and provider configuration must remain isolated from customers.
Actual Apple product registration, keys, approved commercial mappings, notification
delivery and Sandbox transactions remain separate prerequisites. Native flags
cannot create those resources or turn a Production transaction into Sandbox.

Cancellation journals remain scoped to their compiled origin. A staging retry
cannot clear a production record or move purchase ownership. Creator/role/departure
reconciliation limits remain documented in `APPLE_NATIVE_BILLING.md`.

## Reproducible commands

Use full Xcode, the already-installed iOS platform and Node 22. Supply a verified
unused build number in the app's shared App Store Connect build-number sequence.
Do not reuse an example number without checking the account. Existing agreements
and a paid developer membership do not create a signing identity/profile.

Unsigned staging archive rehearsal (no upload or signing):

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
BAZAAR_MOBILE_ENV=staging \
MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER="$NEXT_BAZAAR_BUILD_NUMBER" \
pnpm mobile:release ios unsigned staging-testflight
```

When the intended team, distribution certificate/private key and profile are
actually available, the analogous `signed` command creates an archive and local
internal-only export. `APPLE_TEAM_ID` must be configured locally. The helper
does not upload or submit either channel, does not log credentials, and sets
`NODE_BINARY` to its own running Node executable for the Xcode preparation step.
Direct CLI/Xcode builds need the same Node binary available explicitly or on PATH.

Outputs are separate:

- Staging: `artifacts/mobile-release-<version>-<build>-staging-testflight/`.
- Production: `artifacts/mobile-release-<version>-<build>/`.
- Each inspected archive receives `ReleaseChannel.json`; signed exports receive
  their matching `ExportOptions.plist`. Do not mix artifacts between directories.

Before an authorized internal upload, inspect those files and the app, verify the
archive uses the intended team/profile, upload with the generated internal-only
options, and observe successful Apple processing. Add the owner/internal tester,
install on the real iPhone and complete the device checklist against the preview.
No external tester or public App Review submission is implied.

After those checks and explicit production authorization, build a **new normal
Release** against `www.bazaar.kg`. Do not promote the isolated staging archive into
the customer release. Recheck all production rollout and payment approval gates.

## Verification status — 2026-11-11

Source and focused regression checks cover per-build config generation,
preservation of the source, compiler/channel mismatch, wrong archive/origin,
production export refusal and forced internal-only export. The real entry point
is exercised only against disposable local paths.

Both complete unsigned arm64 Simulator Release builds passed using the same
DerivedData cache, serial `nice -n 10` / `-jobs 2`, with no simulator boot:

- `AppStaging` / `ReleaseStaging`: exit 0, log
  `.local/ios-release-20261111/staging-app-simulator-build.log`.
- `App` / `Release`: exit 0, log
  `.local/ios-release-20261111/production-release-simulator-build.log`.

Inspection of each actual built `App.app` passed the archive channel validator.
Staging contains the exact preview, Bazaar Test name and internal-only marker;
normal Release contains `www`, Bazaar and the production marker. Both preserve
`kg.bazaar.app`, all 11 plugin classes, offline page, version/build 1.0.0/1, and
disabled cleartext/logging/web inspection. The shared source URL remains
production. Evidence: `staging-bundle-inspection.json` and
`production-bundle-inspection.json` under the same local evidence directory.
These are unsigned Simulator builds, not archives or unused-build-number approval.

The production policy executable was compiled independently in production,
`BAZAAR_STAGING` and `DEBUG` modes: **53 checks passed in each**. Its explicit
negative compile with both staging and DEBUG failed at the intended `#error`.
Logs: `apple-billing-channel-policy-{production,staging,development}.log` and
`apple-staging-debug-rejection.log` in that directory.

An unsigned **device-platform archive** also passed (session 13279, exit 0):
`.local/ios-release-20261111/Bazaar-Staging-LOCAL-REHEARSAL-unsigned.xcarchive`.
The real `iPhoneOS` arm64 app targets iOS 15 and contains the same fixed preview,
identity, 11 plugins, localized purpose texts and 18-category privacy manifest.
Version/build **1.0.0/111111 is only a local rehearsal label**, not a verified
unused App Store Connect number. The app has no signature or provisioning
profile and is **not installable or TestFlight-ready**. Log:
`staging-device-archive-local-rehearsal.log`.

That archive predates the new attempt-bound pre-sheet recovery protocol. It is
baseline device-platform evidence, not a current upload candidate. Rebuild the
final source with the matching server protocol before any signed TestFlight work.

The subsequent attempt-recovery device archive also passed (session 66584,
exit 0 / `ARCHIVE SUCCEEDED`):
`Bazaar-Staging-ATTEMPT-RECOVERY-LOCAL-REHEARSAL-unsigned.xcarchive`, under the same
ignored evidence directory, with **local rehearsal 1.0.0/111112**. It compiles the
matching UUID authorization, caught pre-SDK `not_started` boundary, v2 journal and
protection-until-first-authentication branch. The standalone production journal /
boundary executable passed **57 checks**. The actual archive passes the strict
staging validator and is refused by the production export path. Its source
configuration still points at `www`; only the built staging copy uses the preview.

Its read-only audit verifies iPhoneOS arm64 / minimum iOS 15, all 11 plugin classes,
18 source-matching privacy categories, all three permission languages, no app
signature/profile and no synthetic StoreKit/XCTest assets. The marker scan covers
**33 files / 3,788,368 bytes** with **0 findings**, with the same explicitly limited
marker-scan scope described below. Evidence:

- `staging-device-archive-attempt-recovery.log`.
- `staging-device-attempt-archive-inspection.json`.
- `staging-attempt-archive-export-guard.json`, including source hashes and actual
  WMO thread count 10.
- `apple-cancellation-journal-attempt-check.log`.

The previous valid archive was preserved and no Simulator, signing, account or
upload action was performed. This newer archive is still unsigned, not installable
or TestFlight-ready, and its build number has not been checked in App Store
Connect. Signed distribution and the physical-device/Sandbox scenarios remain open.

The read-only archive inspection scanned **33 files / 3,770,936 bytes** with no
forbidden server-secret names, provider-key prefixes, private-key material or
embedded session values found, and no `.storekit` / XCTest / synthetic fixture
assets. It also byte-compared the privacy manifest to source. No matching secret
values/excerpts were logged. No known server-secret values existed in that scan
process's environment, so this is a marker scan, not proof against every possible
credential encoding. Evidence: `staging-device-archive-inspection.json`; the
reproducible read-only scanner is `inspect-staging-archive.py` in the same ignored
local evidence directory.

Resource evidence is precise: the successful builds/archive used `nice -n 10`
and two Xcode jobs, while WMO invocations still auto-selected **10 internal
threads**. An override in `OTHER_SWIFT_FLAGS` did not change that: Xcode appends
its generated thread option later. A reconstructed standalone driver plan was
therefore insufficient evidence of Xcode's effective limit. The attempted
supported parallel-WMO-off setting, with and without an explicit global
whole-module mode, caused a package object/output-map linker mismatch on this
toolchain; those retries failed and are not valid archives. Logs:
`staging-device-archive-capped.log`, `staging-device-archive-capped-fresh.log`,
`staging-device-archive-capped-wholemodule.log`. Xcode 26.6 also rejects the old
`-dry-run` option. Further resource experiments stopped, and the verified
working archive/configuration was retained. The helper uses default WMO,
`-jobs 2`, `-j2` and `nice`; it does **not claim to cap WMO internals at two**.
Any additional local compile requires serialized coordination and an observed
working resource plan. No optimization level or production feature was changed
to conceal this limitation. The relevant primary implementation is
[Swift's driver thread-option parsing](https://github.com/swiftlang/swift-driver/blob/main/Sources/SwiftDriver/Driver/Driver.swift)
and [Apple's Swift build-system compiler planning](https://github.com/swiftlang/swift-build/blob/main/Sources/SWBCore/SpecImplementations/Tools/SwiftCompiler.swift).

Passive CLI inspection still found **0 valid code-signing identities** and **no
connected physical device** (`staging-signing-identities.log` and
`staging-connected-devices.log`). No signed staging archive, App Store Connect
upload/processing, Sandbox purchase or iPhone TestFlight installation has yet
been verified. Account/Xcode GUI permission denials remain in force; no alternate
account-access route was used.
