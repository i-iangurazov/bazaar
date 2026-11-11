# Bazaar iOS release - execution and verification record

Started: 2026-11-11 (Asia/Bishkek).
Status: **in progress; not ready for submission or release**.

## Scope and boundaries

The owner-approved goal covers the complete current Bazaar iOS application,
Apple In-App Purchase for every available paid digital offer, shared organization
access with the GoPay website, protection against overlapping purchases,
account deletion and privacy, real-device/TestFlight verification, store
materials, and release support. This record does not replace or narrow that goal.

Work belongs on `codex/playground`. Merging into `main`, production deployment,
App Review submission, public release, changes to commercial terms, and public
seller/contact declarations retain the approval gates in the goal and AGENTS.md.
No customer database may be seeded, reset, migrated, or used for test purchases.

The owner has authorized routine local setup, official Xcode component
installation, development and testing, and use of the existing signed-in browser.
Do not repeat completed owner steps or request passwords, OTPs, tax IDs, or bank
account numbers in chat or commit them to this repository.

## Verified starting state

- Initial checkout: clean `main` at `2c4355ed`.
- Fetched `origin`; local `codex/playground` had no commits absent from `main`.
  Switched to `codex/playground` and fast-forwarded it to `2c4355ed`, preserving
  the current website and all previously merged improvements. No push or change
  to `main` was made.
- Existing application: Capacitor 8, bundle ID `kg.bazaar.app`, production
  origin `https://www.bazaar.kg`, iPhone/iPad target, minimum iOS 15.
- In the owner's browser, Paid Apps Agreement, both tax forms, and the USD bank
  account showed `Active`. Membership is Individual. These are account setup
  observations, not verification of an app or payment integration.
- Xcode 26.6 is installed at `/Applications/Xcode.app`; the iOS SDK reports 26.5.
  The owner accepted its license. Commands use an explicit `DEVELOPER_DIR`
  because the global selection still points at Command Line Tools.
- First-launch initially returned 69; authorized component installation then
  succeeded, and `-checkFirstLaunchStatus` now returns 0. The iOS 26.5 arm64
  simulator runtime download/install finished successfully. The initial
  destination/platform registration problem was subsequently resolved; both
  staging and normal Release Simulator builds now pass.
- No valid local code-signing identity was found. App registration, signing,
  provisioning, server keys, and device availability still require inspection.
- At baseline the iOS application had no StoreKit implementation. This branch
  now adds a StoreKit 2 bridge and an independent verified Apple ledger alongside
  the existing GoPay/historical FreedomPay records; this is not yet a verified
  sandbox or signed release.
- The current web catalog contains versioned subscriptions, terms of 1/6/12
  months, store and reserve-pack additions, and a separate WhatsApp credit
  purchase flow. WhatsApp sales retain their worker, connection, and commercial
  readiness checks; their presence in code is not proof of live availability.

## Requirement-by-requirement release audit

Each item remains open until the stated evidence exists. A local implementation,
synthetic fixture, or browser screenshot is not a verified native release.

| ID | Required result | Evidence needed | Current state |
| --- | --- | --- | --- |
| R01 | Current application, accounts, roles, stores, commercial catalog, integrations and native capabilities audited | Source inventory, account observations, baseline builds/tests, recorded limitations | In progress |
| R02 | One authoritative organization entitlement model for Apple and GoPay | Real-DB tests showing identical effective access across web/iOS and eligible roles | Open |
| R03 | Existing paid, future prepaid, trial, manual, free/lifetime and legacy catalog rights preserved | Migration review and regression tests for all entitlement sources and monthly usage | Open |
| R04 | No duplicate sale for the same covered period or capabilities | Server purchase checks, organization locks, durable pending intents and concurrent DB tests | Open |
| R05 | Safe provider switching and recovery | Tests for prepaid GoPay remainder, Apple renewal states, pending/stale payments, cancellation and out-of-app renewals | Open |
| R06 | Purchases cannot move between organizations or unauthorized users | Tests for account/device changes, restore, several organizations, role changes and departing payers | Open |
| R07 | Every permitted current digital offer is available through Apple | Complete versioned offer/SKU matrix, prices, supported storefronts, approved terms and sandbox transactions | Open |
| R08 | Website GoPay and historical reconciliation continue working | Existing and new DB/protocol regressions; provider-specific amounts and histories preserved | Open |
| R09 | StoreKit 2 purchase, cancellation, pending, restore and management work | Native implementation, StoreKit Testing, sandbox and TestFlight evidence | Open |
| R10 | Signed transaction verification, Server API and Notifications V2 are complete | Certificate/app/environment/product/ownership checks, replay/order/missed-event tests, reconciliation | Open |
| R11 | Renewals, expiry, grace/retry, plan changes, refund and revocation update only the correct rights | DB lifecycle tests with independent Apple and GoPay grants | Open |
| R12 | Physical-store customer payments stay separate from Bazaar digital sales | Source and UI review; POS/payment regressions | Open |
| R13 | Signed, reproducible iOS archive and app registration are ready | Registered intended bundle ID, team/capabilities/profiles, archive/IPA validation and upload processing | Open |
| R14 | iOS and web maintain all established customer workflows | Native/mobile/desktop checks for POS, prices, products, inventory, documents, reports and enabled integrations | Open |
| R15 | Phone features and recovery work | Device checks for camera/scanner/photos/files/voice, keyboard, permissions, links, backgrounding, network loss and retry | Open |
| R16 | Complete own-account deletion preserves required business records | Reauthentication/confirmation, ownership handling, personal-data removal/session invalidation and real-DB tests | Open |
| R17 | Privacy, AI disclosures/consent and subscription deletion explanations are correct | Data/processor inventory, in-app consent tests, privacy manifest and store declarations reviewed against actual behavior | Open |
| R18 | Russian, Kyrgyz and English strings are complete | Translation validation and UI review of new/error/recovery states | Open |
| R19 | Required application checks and isolated integration tests pass | Typecheck, lint, translation check, relevant tests, web production build, native build; commands/results recorded | Open |
| R20 | Real iPhone TestFlight verification is complete | Signed processed build installed on a real iPhone; full owner/device test script completed with evidence | Open |
| R21 | App Store and IAP review materials are ready | Actual native screenshots, listing/icon/support/privacy, ratings/encryption, review credentials and separate synthetic organization | Open |
| R22 | Production operations and rollback are prepared | Verified notification/reconciliation monitoring, support playbook, safe server rollout and rollback rehearsal | Open |
| R23 | Human release/commercial decisions are concrete and reviewable | Review bundle with prices/renewal model, countries/public seller details, source changes, builds, tests and outstanding actions | Open |
| R24 | Authorized submission, review follow-up and public release are verified | Separate submission/approval/publication states and published-build checks after required authorization | Not authorized yet |

## Commercial invariants to preserve

- Effective access belongs to the Bazaar organization, not to a device, a
  particular employee, or the payment provider. Restoring a transaction is not a
  new grant or renewal. The original organization binding must survive UI
  organization changes and payer departures.
- A GoPay-funded period works in iOS. An Apple-funded period works on the web.
  Already paid rights must not trigger another checkout for the same coverage.
- Preserve future periods, unused prepaid coverage, extras, trial remainder,
  legacy immutable terms, protected organizations, manual/lifetime access and
  consumption already recorded in monthly buckets.
- Purchasing and updating a subscription must coordinate with both payment
  providers, delayed confirmations, old invoices and pending native purchases.
  Recovery must account for confirmed money instead of discarding a transaction
  that arrived after the UI closed or an intent expired.
- Apple renewals outside the app cannot be canceled by a Bazaar database write.
  Detect overlap, reconcile it and offer the correct provider's management/refund
  path. Never promise an unconditional cross-provider atomic financial action.
- Storefront charges and currencies must remain distinct from the catalog's
  service valuation. Never add USD/milliunit Apple amounts to KGS web totals or
  reuse web prorations as authoritative Apple charges.
- Do not invent new paid AI/API/image/email products when their allowance is
  already part of a plan. Honor the separate WhatsApp offer and readiness gates.
- Apple product type, renewal behavior, price points, discounts and provider
  switching need a concrete reviewed proposal before sales are enabled. Website
  prepayment must not become an undisclosed recurring charge.

## Work sequence

1. Prepare the complete current candidate: all agreed Apple purchases, shared
   GoPay access, privacy/deletion, native behavior, signing, commercial setup and
   relevant automated/Sandbox checks. A site with purchases disabled is not the
   finished candidate.
2. Put that candidate on the isolated test website and internal TestFlight;
   verify the real iPhone and give the owner a concrete acceptance result.
   Infrastructure rehearsals may occur earlier but do not complete this stage.
3. After the owner's acceptance and separate main/production/submission/publication
   authorizations, prepare the normal production Release, submit it to Apple,
   address review issues and observe the actual release.

## Verification log

| Date | Check | Result / limit |
| --- | --- | --- |
| 2026-11-11 | Git status, fetch and ancestry | Clean starting tree; existing improvement branch fast-forwarded to current main on its own branch |
| 2026-11-11 | Browser account setup | Paid Apps Agreement, bank and both tax forms showed Active |
| 2026-11-11 | `xcodebuild -version` with explicit developer directory | Xcode 26.6 / 17F113 |
| 2026-11-11 | `xcrun --sdk iphoneos --show-sdk-version` with explicit developer directory | 26.5 |
| 2026-11-11 | Xcode first-launch installation/check | Installation succeeded; subsequent status exits 0 |
| 2026-11-11 | `security find-identity -v -p codesigning` | 0 valid identities; no signed build claimed |

## Remaining owner/external dependencies

The owner is unavailable during the initial implementation and asked not to be
interrupted for routine setup. Continue all independent work. Preserve the
explicit final gates instead of enabling public sales or release by default.

Still to establish: Xcode account/signing availability, intended app registration,
approved Apple commercial configuration, secure server credential provisioning,
real iPhone connection/testing, public-country/privacy declarations, and final
production/submission/publication authorization. Do not mark the release complete
while any required verification or owner/external action remains outstanding.

## Implementation and checks recorded during this run

All counts below describe the named scope at the time of that check, not final
release acceptance. Later integrated changes still require the corresponding
final regression checks.

- Installed the repo-compatible Node 22.23.4 using the existing nvm setup and
  pinned official Apple server library 3.1.0.
- Baseline: 13 mobile test files / 63 tests, full typecheck, translation validation
  and normal web production build passed against explicitly isolated services.
- Baseline real-PostgreSQL subscription/contract/GoPay group: 3 files / 97 tests
  passed after 138 migrations in a new disposable localhost cluster.
- New migration `20261111120000_ios_apple_billing_privacy` applied successfully
  only to that isolated cluster (139 migrations). A separate lifecycle migration
  is being prepared; it must be applied before final Apple regressions.
- Account deletion/privacy, users, AI boundary/provider and session group:
  5 files / 32 tests passed, including 7 actual PostgreSQL deletion/privacy flows.
- First Apple integration group: 8 files / 93 tests passed: 10 real PostgreSQL
  Apple purchase scenarios, 18 official-library synthetic cryptographic checks,
  11 catalog checks, 9 native TypeScript boundary checks, existing web billing UI
  and explicit AI consent. These are not Apple Sandbox transactions.
- Apple purchase UI: 11 tests passed for RU/KG/EN storefront prices, target
  organization consent, no GoPay fallback on iOS, pending/cancelled payments,
  lost confirmation, paginated partial restore, product mismatch and refund UI.
- Compiled the production native origin/cookie policy on macOS: 25 checks passed.
  Full app attempts exposed a missing implicit App scheme (corrected with an
  explicit release scheme), then an Xcode platform/destination registration
  issue despite the installed runtime. No successful native compile is claimed.
- Intermediate combined typechecks found errors in the new work; fixes are being
  integrated. A final clean typecheck/lint/build is still required.

## Separate test deployment

The owner requested an accessible test site as the next milestone. Created a
new Vercel project `bazaar-ios-preview-20261111`, a new Neon Free project with an
empty `bazaar_ios_preview` database, and a dedicated Upstash Free Redis resource
through the existing installation. Database emptiness (0 public tables) and
Redis connectivity were verified before initialization. No customer data or
production provider credentials are copied. Remote migration, synthetic seed,
source build/deployment and browser checks remain in progress. No deployed URL
is claimed yet. The customer project/domain and `main` are unchanged.

Local credentials/state and test outputs live only under ignored `.local`, with
private configuration permissions. `.vercelignore` now also excludes these
files and native build caches. New preview sales/provider calls remain disabled.
The draft catalog contains 145 unapproved product proposals and no Apple prices;
it cannot be loaded as an approved environment mapping.

## Resource coordination and external gates

Three subagents work on server billing, native StoreKit and account privacy.
They run source analysis/edits in parallel; root coordinates a single heavy
compute slot. Tests use one worker, native compilation at most two jobs and one
architecture/destination, and local web builds can use `BAZAAR_BUILD_CPUS=2`.
Idle processes/simulators and only our disposable outputs are cleaned when no
longer needed; user apps, downloads and other projects are preserved.

Current tool access independently denied observation of App Store Connect and
control of Xcode's GUI. These account/UI restrictions are not bypassed through
another surface. Public documentation and local CLI work continue. No signing
identity and no connected physical iPhone were found during the initial audit;
registration, secure server keys, actual products/prices, signing, Sandbox,
TestFlight and real-device acceptance remain external gates. The owner has
already completed membership, tax, bank and agreement setup; those steps are
not requested again.

## Integrated verification checkpoint

- Integrated `pnpm typecheck` passed after the server/native/UI fixes.
- Full unsigned arm64 iOS Simulator App compilation passed with the official
  SDK and two jobs. Runtime registration was resolved with Apple's supported
  `simctl runtime match set` override for the installed compatible runtime; no
  second runtime download was started. Later guard/manifest edits also compiled.
- Five native StoreKit tests compiled and ran twice. Four purchase cases failed
  with the documented StoreKitTest `notEntitled` error even after explicit test
  configuration and local simulator ad hoc signing; only the unknown-ID
  fail-closed case passed. These are recorded failures, not sandbox acceptance.
  The test simulator was shut down afterward.
- Apple lifecycle/verification/origin group passed 4 files / 52 tests at its
  then-current source snapshot. Additional lifecycle cases were added afterward.
- The first whole isolated suite completed: 502 files / 4,615 tests passed, 17 files / 150
  tests failed, 1 file / 3 tests skipped. The failures are being resolved; this
  run is not a green release check. Identified causes included newly required AI
  consent fixtures, final outbox/quote mocks, immutable-expiry fixtures and
  incorrect test-database C locale.
- Verified the locale problem directly: default `lower('КИРИЛЛИЦА')` retained
  uppercase, while explicit ICU produced lowercase. Recreated only this run's
  owned disposable localhost database with ICU `und`; normal search semantics
  and customer databases were not changed. All 140 migrations were then applied
  afresh and the corrected regression group passed 21 files / 367 tests.
- The new remote Preview database applied all 140 migrations successfully. A
  separate synthetic organization, store, role accounts and products were seeded
  with private credentials. There are no financial/purchase transactions or
  customer data. Two additional distinct SELF_SERVE organizations now exist for
  Apple Sandbox acceptance; no purchases/charges were created. Preview
  deployment/source build still remains.

## Latest integrated checkpoint

- Latest Apple ledger/lifecycle/crypto/catalog/native-origin/bridge/resume group:
  105 tests passed, with one stale UI recovery expectation failing. That assertion
  was corrected to the intended generic recovery message when there is no known
  cancelled operation. The subsequent Apple UI/recovery group passed 2 files /
  36 tests, including cancellation ACK/loss/recorded-money races, durable access
  before native finish, scheduled Apple selections and safe unknown-state text.
- Existing GoPay checkout and saved-link resume UI passed 3 files / 94 tests,
  including RU/KG/EN overview and admin recovery. Both initial redirect and a
  pending invoice's Continue action now call the locked server resume check.
  REVIEW or known Apple obligations expose no active Continue link.
- Latest native normal Release and isolated ReleaseStaging Simulator builds
  passed. Actual bundle inspection verified distinct fixed origins/distribution
  markers, `kg.bazaar.app`, all 11 plugins, no cleartext/logging/web inspection,
  and the correct privacy manifest. This is unsigned Simulator evidence.
- Origin/cookie/group/channel policy executable passed 53 checks in each of
  production, staging and development; conflicting staging/debug flags are
  rejected. Durable native cancellation journal executable passed 40 checks.
- New isolated public image and private export Blob stores are connected only
  to Preview in the new project. They use the existing Vercel Pro team's usage
  credit/on-demand terms, not a newly purchased or guaranteed-free plan. No
  other project, plan or storage was changed. Cloud OIDC and actual storage
  execution still need deployment verification.
- Storage/project/tenant/download/privacy-recovery/staging-release group passed
  13 files / 122 tests, including real disposable PostgreSQL and mocked external
  storage operations. Subsequent small serverless retention/profile changes are
  included in the next full check.
- Integrated typecheck and lint passed at their recorded snapshots. The final
  translation check, latest-head typecheck/full suite, cloud production-mode web
  build and desktop/mobile inspection remain in progress.
- Passive local CLI audit again found zero valid signing identities and no
  connected physical iPhone. No signed archive, processed TestFlight build,
  Sandbox purchase, actual device acceptance, App Review submission or public
  release is claimed.
- A real unsigned iPhoneOS/arm64 staging archive subsequently passed and its
  actual app was inspected: fixed preview/internal-only markers, all 11 plugins,
  matching 18-category manifest and permission localizations. Its local rehearsal
  version/build is not an App Store Connect uniqueness claim. It has no signature
  or provisioning profile and cannot be installed or uploaded as a valid build.
- Local storage SDK smoke was denied before upload because Vercel's locally
  pulled OIDC token identifies Development, while both new stores admit only
  Preview. The expected isolation was retained: no Development connection or
  static-token fallback was added. Temporary credentials were removed. Actual
  Preview HTTP storage verification remains after deployment.
- Native archives were serialized with `nice10` and two Xcode jobs. Xcode's
  optimized Swift compiler still used its default ten WMO threads internally;
  attempts to change that produced package output-map/linker errors. Those
  resource-setting experiments were stopped, the working release settings were
  restored, and the valid original unsigned archive was preserved. Do not claim
  that this archive's compiler ran with only two internal threads.
