# Native Apple billing contract and verification

The iOS application keeps bundle ID `kg.bazaar.app`, Capacitor 8 and minimum iOS
15. StoreKit does not establish Bazaar organization access. Signed transactions
are submitted to the authenticated server; only its verified durable records and
entitlement projection determine effective access on iOS and the website.

## Bridge

`src/lib/native/appleBilling.ts` registers `BazaarAppleBilling`. It is unavailable
in ordinary browsers and Android. Product metadata includes Apple's localized
price/name/description, decimal price string, currency, product type, and an
auto-renewable subscription's group/period. Full catalogs are fetched in
sequential batches of at most 100 IDs, including additions and all approved terms.

`purchaseAppleProduct(intentId)` accepts only an opaque server-owned intent ID.
Native code reads the current WebKit session, POSTs
`/api/billing/apple/native/authorize`, loads the returned StoreKit product, and
re-authorizes immediately before Apple's purchase sheet. The server selects the
allowlisted SKU and organization-bound UUID `appAccountToken`. JavaScript cannot
choose either value. Results distinguish `purchased`, `pending`, `cancelled` and
`not_started`; errors have stable codes. A purchase result never grants rights or
finishes a transaction.

The first native request includes `prepareOnly: true`: it validates ownership,
catalog and conflicts without marking the intent as durably authorized. A
metadata/preflight failure therefore does not create a possibly-charged hold.
The second request omits that flag, supplies a native-generated UUID `attemptId`,
and durably binds that attempt immediately before the sheet. Native requires the
echoed UUID to match. After durable authorization, every further prepare/authorize
request for the same intent is refused, including the same UUID. Retrying an
unknown result cannot reopen a second payment sheet, including for consumables
and non-renewing products. Late purchases retain their recovery protection.

The original trusted origin is captured before authorization. The shared
`BazaarApplePreSheetAttempt` boundary catches only final authorization and
post-auth preflight failures. For example, backgrounding while auth HTTP runs or
losing its response can be durably recorded if this invocation never called
`Product.purchase`. Its result is `not_started`, with required
`cancellationAcknowledged` / `cancellationRecorded` and an
`error: {code, serverCode?}` reason. It never claims that Apple cancelled a sheet
or that another attempt did not pay. A different winning attempt cannot be
cancelled with this UUID. Once the SDK invocation begins, all unknown errors
bypass this handler; only explicit StoreKit `userCancelled` creates cancellation
proof. There is no armed record, cold-start inference or timeout cancellation.

Before presenting an auto-renewable purchase, native code checks StoreKit's
verified current entitlements in the selected subscription group. A different or
missing organization token, missing group, or unverified entitlement fails closed
before Apple's sheet. The same stable organization token can change its approved
plan; unrelated verified groups do not block it. Non-renewing/consumable offers
keep their existing explicit-intent behavior. This preflight never grants access
and does not replace immutable server transaction/organization binding.

Signed evidence has string `transactionId`/`originalTransactionId` (never a JS
number), `productId`, `signedTransactionInfo`, dates, ownership information and
optional `appAccountToken`/environment. The app must confirm the JWS on the server,
then call `finishAppleTransaction(transactionId)`. Native code reads StoreKit's
verified transaction and independently POSTs
`/api/billing/apple/native/acknowledge` with the transaction ID and JWS. It calls
`Transaction.finish()` only after `finishAllowed: true`. JavaScript cannot supply
an acknowledgement flag. The ACK route requires a durable matching server record
and does not create an entitlement. A refused/network-failed ACK leaves the
transaction in StoreKit's queue for recovery.

## Recovery and Apple account actions

- The following cancellation-file protocol is retained for **legacy keyless
  attempts**. New enrolled attempts use the earned-completion protocol below.
  A definite StoreKit cancellation (the `.userCancelled` result or thrown
  `StoreKitError.userCancelled` from `Product.purchase`) or caught pre-SDK abort
  is synchronously written
  to `Application Support/AppleBillingRecovery/cancelled-intents.json` before the
  native promise can resolve. Only the opaque intent ID, attempt UUID and canonical
  compiled origin are stored, with schema version 2. The atomic file has iOS data
  protection until first user authentication, owner-only file/directory permissions
  and backup exclusion. This allows a caught background callback to write after
  the device locks; no authorization material is stored. It
  contains no JWS, cookies, account token, user ID or organization ID and does not
  use UserDefaults. Corrupt/unknown/oversized journals fail closed; a persistence
  error is reported as `APPLE_CANCELLATION_STORAGE_FAILED` rather than a falsely
  completed cancellation. Pending, unverified and network-unknown outcomes after
  invoking StoreKit are never journaled as cancellations.
- Native POSTs `/api/billing/apple/native/cancel` with `{intentId, attemptId}`.
  Authorized cancellation requires the matching immutable winning attempt plus
  original creator/organization and no recorded money. Only the
  current authenticated, scoped server response can clear that journal entry:
  `canceled: true` acknowledges cancellation; `recorded: true` acknowledges money
  already stored on the server and takes precedence. Recorded money goes through
  receipt/status review, never a cancelled-payment message. Malformed, missing or
  lost responses retain the journal for another attempt. The cancelled bridge
  result has required `cancellationAcknowledged` and `cancellationRecorded`
  booleans; an `APPLE_CANCELLED` exception is never converted into that result by
  the TypeScript wrapper. The web/tRPC cancellation path remains only for a
  never-authorized soft intent; checkout does not use it as a fallback after
  native final authorization might have happened.
- `retryAppleCancellations()` retries this journal on authenticated login/resume
  and returns `pendingCount`, `acknowledgedCount` and `recordedCount`. It does not
  open an Apple sheet. Entries for other compiled origins are untouched. A missing
  session or 401 retains entries without claiming they belong to the current
  organization; 403/404 entries remain stored and are excluded from the current
  organization's pending count. They can be acknowledged after the appropriate
  administrator returns. Explicit HTTP 409 `applePurchaseAttemptMismatch` also
  preserves proof without counting the losing attempt as a pending cancellation.
  This exclusion keys origin/intent/attempt, never hiding another proof for the
  same intent. Other 409s remain unresolved. Version 1 entries are preserved and
  migrated without inventing attempt IDs; they cannot cancel an authorized intent
  under the new protocol. Successful ACK removal rereads the file, preserving
  other entries added while a network request was in flight.
- A native `Transaction.updates` observer starts when the plugin loads. It emits
  verified evidence or an explicit verification failure while the trusted app is
  loaded. It never finishes an update automatically.
- `getUnfinishedAppleTransactions()` rereads StoreKit's durable queue, including
  after app termination. It never prompts for Apple Account authentication. Each
  valid record must be server-confirmed before it is acknowledged and finished.
- `restoreApplePurchases()` is an explicit user action. It calls `AppStore.sync`
  once and returns the first history page. Continue with
  `getAppleTransactionHistory(nextCursor)` until `nextCursor` is `null`. Every
  page returns verification failures separately. Date/ID cursors do not skip
  older records when new transactions arrive. Unfinished recovery is separate
  from history paging, so an old unpaid fulfillment obligation cannot be hidden
  by the first page of newer renewals.
- `SKIncludeConsumableInAppPurchaseHistory` enables finished-consumable history
  on supporting OS versions. The server ledger remains authoritative, including
  when a device/older OS cannot return a finished consumable. Restore never
  constitutes a second purchase or grants the same credits again.
- `showAppleSubscriptionManagement()` opens Apple's management sheet.
  `requestAppleRefund(transactionId)` first requires a recorded same-organization
  transaction, then opens Apple's refund request flow. `submitted` means a
  request was sent; verified server notifications determine refund/revocation.

### Earned completion and operational recovery limits

New native attempts persist a device-only P256 private key in Keychain before
final authorization; the server immutably enrolls its public key with the winning
attempt and trusted origin. A separate protected/no-backup earned-completion
journal is written only after definite OS cancellation, a caught pre-SDK abort,
or actual verified old-SKU success for a frozen auto-renewable CHANGE. No private
key, password or session cookie is stored in that file or returned to JavaScript.

The signed completion challenge protocol can resolve that exact earned result
after logout, role loss or deletion of its original payer. It cannot open another
sheet, create a session, transfer ownership, grant access or request a refund.
Recorded money always takes precedence, including unresolved REVIEW money. A
read-only RECORDED_ONLY probe can acknowledge later durable money without
fabricating a missing renewal proof or a cancellation. The app retains every
unresolved/inaccessible proof and key; another actor's session cannot adopt it.

The original fresh ADMIN endpoint remains only for **keyless legacy** cancellation
journals. A missing enrolled key, unknown/hard-crash SDK outcome with no earned
proof, or ambiguous signed evidence still requires support/reconciliation. Neither
elapsed time, empty history nor a changed role proves absence of a charge.
Preserve the authorized pending/review record; do not reassign it or open a second
payment to remove a warning. Details and operator boundaries are in
[APPLE_DEFERRED_OUTCOMES.md](APPLE_DEFERRED_OUTCOMES.md) and
[APPLE_SUPPORT_RECOVERY.md](APPLE_SUPPORT_RECOVERY.md).

For a deferred change, native synchronously stores the actually returned verified
old transaction before awaiting subscription status, then captures a verified
same-chain/group/token renewal JWS for the exact target and authorized interval.
Once captured, both payloads remain immutable for offline replay. The UI receives
only a separate `deferred` outcome and acknowledgement flags, never signing keys
or stored renewal evidence. It refreshes authoritative current/scheduled access;
historical acceptance (`scheduled:false`) is not a currently scheduled plan.
The old transaction is not confirmed/finished as a newly purchased target.

`retryAppleCompletions()` runs on login/logout, role changes, focus/online and
visibility without reading payment history or requiring a session. Paid receipt
confirmation/finish and legacy cancellation recovery remain authenticated ADMIN
operations. Earlier native builds with no new method keep that legacy path;
UNIMPLEMENTED is not misreported as a known pending device proof.
Review operations must distinguish this case from a currently authorized
administrator whose journal will retry normally. This limitation still requires
a verified support/reconciliation procedure before commercial release.

A hard process termination before a caught abort proof is written remains
ambiguous and retains REVIEW protection. Empty StoreKit history, a missing local
journal or an elapsed timeout is not proof that no purchase was invoked. This
minimal recovery deliberately does not infer cancellation on cold start.

## Native security boundary

The custom bridge controller checks the actual WebKit message frame and origin
before Capacitor discards that information. Every bridge message must come from
the trusted main frame and the currently loaded exact origin. This also covers
plugin class aliases, listeners and indirect bridge callbacks. Production trusts
only `https://www.bazaar.kg:443`. The dedicated non-DEBUG `ReleaseStaging` channel
trusts only `https://bazaar-ios-preview-20261111.vercel.app:443`, with a matching
per-build Capacitor configuration and Sandbox-only purchase authorization/evidence.
An ordinary DEBUG build retains its explicit development origin. JavaScript
cannot alter these origins. Each billing operation
checks it again, including before returning signed records after navigation.
The controller refuses a mismatched Release config before loading a remote page.
See `IOS_TESTFLIGHT_STAGING.md` for archive checks and the forced internal-only
TestFlight export; a staging archive is not a production/App Store artifact.

Native API calls use an ephemeral URLSession, standard TLS validation, no shared
cookie/credential/cache storage and no redirects. Only unexpired, domain-scoped
NextAuth session cookie chunks at `/` are copied from WebKit. Cookies/JWS are not
logged or copied into UserDefaults/files by this integration. Background events
do not retain signed payloads for untrusted/offline pages; unfinished recovery
obtains them from StoreKit when the user returns.

Native requests fail before copying auth cookies if WebKit has an active scoped
impersonation session. Omitting unrelated cookies therefore cannot hide
impersonation from the server's billing boundary. Capacitor native logging is
disabled so its DEBUG result logging cannot expose signed transaction payloads.

The microphone permission purpose was added for the existing Baam voice capture.
Camera/photo/voice purposes are localized in English, Russian and Kyrgyz. Purpose
strings do not request permissions by themselves. AI processing consent remains
an independently enforced application/server requirement.

## Local checks

`tests/unit/native-apple-billing.test.ts` covers platform gating, catalog batching,
localized prices, intent-only purchase, journaled cancellation/retry, exact IDs, ACK
refusal/retry, background recovery versus explicit sync, pagination, listeners and
Apple management/refund responses. Run with the repository's isolated test runner.

The new `scripts/mobile/test-apple-completion.swift` compiles production crypto,
challenge, source-binding and protected-journal code directly. It checks canonical
P256 SPKI/P1363 encoding, exact challenge scope, lost-response/restart recovery,
strict money/deferred ACKs, immutable evidence, source and renewal exclusions,
backup/permissions, corruption and storage failure. It performs no Keychain,
StoreKit, account, network or provider operations. Compile it with
`BazaarBillingOrigin.swift` and `BazaarAppleCompletion.swift`, using the same SDK
and private output directory as the policy command below. The current completion
source and its updated bridge/UI tests still require the coordinated run and a
fresh native compile; previous archives do not verify this addition.

`scripts/mobile/test-apple-cancellation-journal.swift` compiles the production
journal with the production origin policy. It covers restart/lost-response
recovery, idempotency, scoped ACK removal, strict response decoding, recorded-money
precedence, backup/permissions, bounded opaque contents, storage failure and
corrupt/unknown-version preservation. Compile/run it separately from the policy
executable below. Verified 2026-11-11: it compiled and exited 0 with **40 checks
passed**; evidence: `.local/ios-release-20261111/apple-cancellation-journal-check.log`.
Those 40 checks and earlier native builds predate the attempt-bound v2/pre-sheet
addition. The updated executable also covers attempt isolation, v1 preservation,
lost final-auth response, post-auth background failure, no cancellation after SDK
invocation, pending SDK results and persistence-failure propagation. Updated
compile/check evidence: exit 0 and **57 checks passed** in
`.local/ios-release-20261111/apple-cancellation-journal-attempt-check.log`.
The updated iOS protection branch and complete native purchase path also compiled
in the latest unsigned device archive:
`.local/ios-release-20261111/staging-device-archive-attempt-recovery.log`
(session 66584, `ARCHIVE SUCCEEDED`). Device lock/unlock and real interruption
still require iPhone checks; the executable performs no Apple/network purchase.

The production origin/cookie policy is compiled directly into an executable:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer nice -n 10 \
  /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc \
  -sdk /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.5.sdk \
  ios/App/App/BazaarBillingOrigin.swift scripts/mobile/test-apple-billing-policy.swift \
  -o .local/ios-release-20261111/apple-billing-policy-check
.local/ios-release-20261111/apple-billing-policy-check
```

Verified 2026-11-11: exit 0, **33 policy checks passed**, including impersonation
and same-subscription-group organization-token checks. Final evidence:
`.local/ios-release-20261111/apple-billing-policy-check-final.log`. `plutil` validates the
project/plist; `xmllint` validates the storyboard/shared test scheme. These checks
do not establish a compiled native app or a real Apple purchase.

The separate shared `AppStoreKitTests` scheme contains `AppNativeTests` with
synthetic `kg.bazaar.testing.*` SKUs. Its configuration is included only in the
test bundle. Five StoreKit tests use the actual production transaction finisher:
ACK refusal/recovery, preserving another purchase, repeated ACK, unknown IDs, and
unverified transactions. The DEBUG-only test-host flag prevents loading the
customer website. This scheme is never the release configuration or a production
SKU/price approval. Run one simulator and one architecture, serialized with other
heavy work, with `-jobs 2 -parallel-testing-enabled NO`.

Verified 2026-11-11: the complete unsigned arm64 Simulator **App build passed**
using Xcode 26.6, SDK 26.5, one architecture and `-jobs 2`. The log is
`.local/ios-release-20261111/storekit-app-simulator-build-matched.log`. The final
incremental build of the group guard, read-only prepare phase and collected-data
manifest also passed; log:
`.local/ios-release-20261111/storekit-app-simulator-build-final.log`. This
compiled the bridge, StoreKit implementation, message/origin guard and actual
phone plugin dependencies.

The subsequent cancellation-journal build also exited 0 / `BUILD SUCCEEDED` with
the same one-architecture unsigned Simulator setup:
`.local/ios-release-20261111/storekit-app-simulator-build-cancellation.log`.
The origin/cookie/subscription policy was recompiled and all 33 checks passed;
log: `.local/ios-release-20261111/apple-billing-policy-check-cancellation.log`.
No simulator was booted and the known-failing StoreKit purchase harness was not
repeated for this change. These checks establish compiled storage/recovery policy,
not a successful sandbox purchase or real-device cancellation lifecycle.

The subsequent full non-DEBUG `AppStaging`/`ReleaseStaging` and normal
`App`/`Release` Simulator builds also passed. The actual bundles were inspected
for their distinct fixed origins, identity/distribution markers and all 11 native
plugins. The updated pure policy passed 53 checks in each compiled channel, and
the staging+DEBUG combination fails compilation intentionally. Complete logs,
bundle inspection, compiler-thread cap evidence and still-missing signing/device
verification are recorded in `IOS_TESTFLIGHT_STAGING.md`. The unsigned arm64
device-platform staging archive also passed and its actual app/manifest/plugins
and secret markers were inspected. Its local rehearsal build is not signed,
installable or TestFlight-ready. The successful Release builds/archive used
`-jobs 2` but actual WMO threads 10. Attempts to cap WMO internals exposed an
object/output-map mismatch; the helper retains the verified working mode and
does not claim an effective two-thread WMO cap.

The final compiled `App.app/PrivacyInfo.xcprivacy` is plist-valid and byte-matches
the source (SHA-256 `d8b53410b91be51749ded955acdbac4bb000c4181bf4a49fc8455bb538ac6532`).
It contains 18 unique app-level collected-data dictionaries with the four required
keys, linked status and non-tracking status. Category/purpose evidence and final
owner/configuration review are documented in `IOS_APP_PRIVACY_AUDIT.md`; no App
Store Connect privacy questionnaire was submitted. The distribution archive's
final privacy report remains a separate release check.

The installed SDK reports build `23F81a` / version 26.5.1 while the official
runtime download installed iOS 26.5 `23F73`. Xcode initially rejected every
destination despite `simctl` showing that verified installed runtime. The
supported command `simctl runtime match set iphoneos26.5 23F73` selected the
installed runtime; destinations and compilation then worked. The override is
specific to this SDK and reversible with `simctl runtime match set iphoneos26.5
--default`. No platform files or signatures were modified and no duplicate
runtime was downloaded. Also keep the explicit shared `App` scheme: once a
shared test scheme exists, Xcode need not generate an implicit application scheme.

The StoreKit test target also compiled and executed on one iPhone 17 Pro
Simulator (iOS 26.5 `23F73`). Both the initial unsigned run and the retry with
the explicit test configuration and local ad hoc signature returned exit 65:
four synthetic purchase cases failed with `SKInternalErrorDomain Code=3` while
saving the StoreKit test configuration and `StoreKitError.notEntitled`; the
unknown-ID case passed. Logs and result bundles:

- `.local/ios-release-20261111/storekit-native-tests.log` / `.xcresult`
- `.local/ios-release-20261111/storekit-native-tests-configured.log` / `.xcresult`

These errors match the [iOS 26.5 CLI StoreKit Testing regression discussed with
Apple DTS](https://developer.apple.com/forums/thread/826971). This is a diagnostic
inference, not evidence that purchase/fulfillment passed. No invented StoreKit
entitlement, private API/container workaround, live purchase or GUI/account-access
workaround was used. A diagnostic collection step additionally could not locate
`simctl` because the global developer directory remains Command Line Tools;
build commands themselves used the explicit full Xcode directory. The test
simulator is shut down and no simulator remains booted.

Successful native StoreKit lifecycle execution, a signed device archive,
sandbox/real iPhone and TestFlight evidence remain required. Local StoreKit evidence
cannot substitute for server JWS verification with Apple's production/sandbox
certificates or for approved App Store Connect products and signing.

## Direct current-term upgrade candidate

The current candidate adds the separate, default-disabled model C described in
[APPLE_TEMPORARY_UPGRADES.md](APPLE_TEMPORARY_UPGRADES.md). It uses a configured
non-renewing band product for additions to an existing paid GoPay or non-renewing
Apple term. The purchase bridge still accepts only an opaque intent ID; JavaScript
cannot provide its price, storefront or account token.

`getStorefront()` returns Apple's numeric storefront ID and separate three-letter
country code. Product metadata includes exact Decimal-derived `priceMillis` and a
storefront ID only when that ID remained stable during the request. Unavailable
storefront metadata blocks C while unconstrained existing renewal products retain
their previous behavior. No currency conversion is performed in the bridge.

For a server-provided `priceConstraint`, native re-fetches the actual product and
requires NON_RENEWING type, identical storefront ID/currency and exact milliunits
before final one-use authorization. It repeats this check using the fresh final
authorization immediately before invoking StoreKit. A constrained purchase also
refuses a new storefront through StoreKit's `onStorefrontChange` option. These
APIs are declared available at the existing iOS 15 minimum in the installed SDK;
the app minimum and privacy manifest are unchanged.

A caught failure before the StoreKit invocation uses the existing attempt-bound
`not_started` journal. An unknown failure after invocation remains receipt/review
recovery, without inferring cancellation. The UI displays actual localized Apple
price, source and target configurations, exact source/upgrade intervals, preserved
future coverage, and dependency on the original paid access. Changed conditions
invalidate consent. Recorded money, active/suspended access, and lost server/finish
acknowledgements have separate states. C never falls back to a full-period renewal.

The earlier archived app described above predates this extension. Source-level
checks, an updated native compile, registered product/price review and actual
Sandbox/device scenarios must be recorded separately before treating C as verified.
Neither its implementation nor synthetic price fixtures approve commercial sales,
below-minimum blocking, FX equivalence or complete offer parity.

## Primary references

- [StoreKit unfinished transactions](https://developer.apple.com/documentation/storekit/transaction/unfinished)
- [StoreKit transaction updates](https://developer.apple.com/documentation/storekit/transaction/updates)
- [StoreKit transaction history](https://developer.apple.com/documentation/storekit/transaction/all)
- [Finishing a transaction](https://developer.apple.com/documentation/storekit/transaction/finish())
- [Capacitor iOS plugins](https://capacitorjs.com/docs/plugins/ios)
