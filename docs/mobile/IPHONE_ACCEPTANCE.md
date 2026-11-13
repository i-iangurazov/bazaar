# Bazaar iPhone acceptance record

Status: **partial physical TestFlight acceptance; full acceptance pending**.
Compilation, browser checks and synthetic signed fixtures do not complete this
record. The owner's required delivery order is a complete
candidate, isolated website/internal TestFlight acceptance, then a separately
authorized App Store release.

Record the exact source SHA, app version/build, staging archive identity, Apple
processing result, iPhone model/iOS version, tester and UTC time before marking
any result passed. Save native screenshots and interruption evidence outside Git
with the build identity. Current browser screenshot candidates are not native
App Store screenshots.

## Current physical-device checkpoint — updated 2026-11-13

The owner confirmed Transporter **Delivered**, supplied the App Store Connect
status **Complete / Internal / Ready to Test**, and installed **1.0.0 (111120)**
through TestFlight. The app record is **Bazaar POS**, Apple ID **6833508529**,
bundle ID `kg.bazaar.app`, Russian primary language, team `DWR6Z246Y8`.
The signed staging IPA comes from native source `56c744aa`; its inspected SHA256
is `d6ee74fb1ebf68d0183ef1d28a00e1bf9b873182bfe2adb53a27a36c7963d55d`.
Hosted interface changes are recorded separately in [native page QA](IOS_NATIVE_PAGE_QA.md).

The owner reported a successful login and working screen, product search with
the keyboard, and a scanner opening after camera permission with a live image.
The subsequently observed phone is iPhone 18 Pro Max / iOS 27.0.1. Actual full
newcomer registration, business/store creation, login and the working screen were
checked on this phone. A first real Apple Sandbox purchase and owner-run restore
are also recorded below. Barcode decoding and a complete page pass remain open.
Agent-run Simulator checks are separate evidence.

All 145 base/pack products are registered as Apple drafts, and 102 available
15%-scenario draft prices were approved and configured. The first Starter product
alone has observed KGZ-only availability and is enabled for synthetic C's Sandbox
test. The remaining prices, availability, temporary-upgrade bands and pack terms
are incomplete; ordinary customer sales stay off. See the
[release record](IOS_RELEASE_PROGRESS.md).

Actual purchase fixture labels differ from the original planned sequence below:
**C is now the first Starter buyer**, while A remains the protected GoPay fixture.
The owner completed the C purchase at `2026-11-13T15:21:52Z`. Signed/ledger money
is USD 26.95 / KGZ; the phone card displayed `$24.95`, which is an unresolved
discrepancy. Notification processing granted one period ending
`2026-12-13T15:21:52Z`; ordinary Chrome login showed the same active Apple access.
After owner-run Restore, server evidence contains CLIENT, NOTIFICATION and RESTORE
observations, still one transaction and the same single period. A's financial
records and quotas are preserved. Original generic phone messaging and native
finish acknowledgement still require the updated candidate check; refund,
reinstall and cross-organization restore have not passed.

Use only the dedicated preview services and synthetic organizations. Private
demo and two distinct SELF_SERVE Bazaar logins for Apple Sandbox scenarios are in the owner's local
release evidence directory; they must not be copied into Git or public listing
materials. Use Apple's actual test environment and registered products. Never
use a customer organization or real GoPay charge for these checks.

The staging build uses the same `kg.bazaar.app` identity and may replace another
Bazaar installation. It is explicitly internal-TestFlight-only, and cannot be
promoted into the public release. See [channel setup](IOS_TESTFLIGHT_STAGING.md).

## Numbered device acceptance sequence

Prepare isolated synthetic fixtures before starting: **A** with active GoPay-funded
coverage and known plan/additions/expiry, **B** eligible for an approved Apple
Sandbox purchase without other coverage, and a different organization **C** for
ownership checks. A is a test-ledger fixture, not a real GoPay charge. A protected
operations/demo login is not a substitute for GoPay coverage or an eligible Apple
buyer. Use the same preview website as the staging app, never the customer site.

1. **Install the signed internal build.** Accept the TestFlight invitation and
   install Bazaar Test on iPhone. Record build/source/device details above,
   verify the intended preview organization, and confirm registered Apple products
   are available in Sandbox. An unsigned local rehearsal cannot satisfy this step.
   **Result: Partial.** Owner confirmed installation of `111120` and successful
   initial login. Starter Sandbox availability is subsequently established by
   the real C purchase; complete catalog availability remains unverified.
2. **Keep existing web-paid access.** Sign into A in the preview website and on
   iPhone. Compare plan, additions and expiry, then open an included paid feature.
   Access must work without buying again through Apple. An automatic subscription
   must not charge the already-covered period; any separately approved voluntary
   future prepayment must show dates after existing coverage before consent.
   **Result: Not run.**
3. **Cancel before buying.** Sign into B, open the approved product, compare the
   localized price/currency, organization and term with Apple's sheet, then tap
   Cancel. Confirm no entitlement grant and a server-acknowledged cancellation.
   Repeat with a lost connection if the definite OS cancellation can be observed:
   reconnect/relaunch and verify its durable retry resolves without a new charge.
   An unknown SDK error remains pending/review; it must not be labelled cancelled.
   **Result: Not run.**
4. **Purchase once and use the website.** After the previous cancellation is
   resolved, complete the approved Sandbox purchase for B. Record the verified
   initial transaction and resulting rights/dates. Open the same organization in
   the preview website: the same access must be available without GoPay payment,
   and replay/refresh must not grant it twice. **Result: Partial actual pass using
   C: one signed purchase, one period and ordinary web access observed; phone
   price discrepancy and initial verification message remain unresolved.**
5. **Interrupt and relaunch.** Exercise connection loss/app closure around purchase
   confirmation or the finish acknowledgement. Restore connection and reopen B:
   a verified paid transaction must recover without another purchase; existing
   durable access remains usable while finish synchronization retries. If Apple
   has not established a purchase, preserve pending/review instead of inventing
   success or cancellation. Record which interruption actually occurred.
   **Result: Not run as a controlled interruption scenario. The initial real
   purchase's generic phone error and notification-only grant are preserved.**
6. **Restore, reinstall and keep ownership.** With terminal cancellations already
   acknowledged, record B's rights and consumed quota/credits. Restore purchases,
   then reinstall from TestFlight and restore using the same Apple/Bazaar accounts.
   Rights must recover without duplicate periods, credits or quota resets. Switch
   to C and restore: B's purchase must stay bound to B, and C must not gain it.
   **Result: Partial: owner-run C Restore reached the server without another
   transaction or period. Reinstall, foreign-organization case and native finish
   acknowledgement remain unverified.**

These steps are the first-run sequence, not a replacement for the full matrix.
Only the explicitly bounded owner-reported checks below have passed. Keep the
other cases **Not run** until evidence from the installed candidate establishes
that individual result; a Simulator pass cannot fill a physical-device result.

| Check | Required observed result | Result / evidence |
| --- | --- | --- |
| Internal TestFlight installation and initial login | The installed signed build reaches the working screen after login | Owner-reported pass for `1.0.0 (111120)`; full device identity/capture record remains to complete |
| Logout, password recovery, expired session and restart | Cookies survive restart as intended, recovery works, and protected data is unavailable after logout | Not run |
| Organization and role boundaries | Owner, manager and employee retain their real permissions; a different login cannot adopt the previous organization's purchases | Not run |
| Existing GoPay coverage | iPhone shows the current plan/additions/expiry and permits paid features without another Apple charge | Not run |
| Apple purchase and web access | Localized Apple price and explicit organization/term consent match the sheet; exactly one verified grant appears in iOS and web | Partial: C Sandbox grant and ordinary web access observed; displayed-price discrepancy and initial phone message remain open |
| Prepaid and future periods | New explicit renewal preserves all paid coverage and future selections; no quota reset or overlapping charge | Not run |
| Complete approved catalog | All approved plans, 1/6/12-month terms, allowed store/reserve combinations and enabled WhatsApp packs match actual products, prices and entitlements | Not run |
| Multi-organization Apple Account | Original immutable binding survives two Bazaar organization logins, restore and changes of Apple Account; same-group conflict opens no new sheet | Not run |
| Repeated and simultaneous purchase | Double taps and concurrent web/iPhone requests cannot create two grants or two Bazaar-initiated charges | Not run |
| Definite cancellation while offline | Cancellation is saved on device, retry acknowledges it after reconnection, and pending access is not mistaken for a charge or a grant | Not run |
| Pending approval | A delayed purchase remains pending after local timeout/restart; an old unpaid GoPay invoice cannot bypass it | Not run |
| Network lost after Apple charge | Closing/reopening the app and restoring connection recovers the signed operation; the app does not require another payment | Not run |
| Durable confirmation, lost finish ACK | Paid access is visible before Apple synchronization completes, and the unfinished receipt is retried safely | Not run |
| Restore and reinstall | Large/paginated history, an unrelated organization's receipt and a temporary verification failure preserve progress and do not duplicate access | Partial: actual C Restore preserves its one period; reinstall, unrelated organization and native finish remain open |
| Renewal, expiry, grace and billing retry | Signed Apple state drives access and dates; failure/expiry messaging is accurate and monthly usage remains consumed | Not run |
| Plan/addition changes | Every agreed immediate/scheduled transition uses the approved commercial model; pending reductions respect actual stores/users/products and enabled features | Not run |
| Direct temporary upgrade over web-paid access | In A, use an explicitly approved Sandbox C band: actual Apple price/currency, source and target additions, exact remaining dates and parent dependency match consent; web/iPhone show the same higher current-term access while original/future paid periods and consumed quotas stay unchanged | Not run |
| Temporary upgrade price/source change | A changed storefront, Apple price or paid source blocks the old quote; consent refreshes without opening a full-term renewal or inventing a currency conversion | Not run |
| Temporary upgrade cancellation, interruption and restore | Definite cancellation or caught pre-sheet abort resolves through the matching native attempt; lost confirmation/finish and restore recover the same receipt without another charge, extra period, balance or quota reset | Not run |
| Temporary upgrade dependency/refund | In isolated approved fixtures, refunding the increment removes only its additions; revoking/restoring its paid parent suspends/restores dependent access only while valid, with independent paid coverage preserved and review money shown separately | Not run |
| Out-of-app renewal and provider switching | App Store settings changes and missed/out-of-order notifications reconcile; overlap has a visible management/refund path; Bazaar does not claim it can cancel Apple itself | Not run |
| Refund/revocation | Only the corresponding rights/unused credit change; independent GoPay periods survive; submitted refund is distinct from Apple's decision | Not run |
| POS and fractional values | Product search, quantities/prices, payment methods for physical goods, held receipts, return flow and cashier permissions work without changing authoritative amounts | Not run |
| Product search with keyboard | Search accepts keyboard input and finds products in the app | Owner-reported pass for `111120` |
| Products, balances, reports and documents | Create/edit, images, KGS/currencies, business dates, report download and document open/share work | Not run |
| Receiving, transfers, write-offs and stock count | Established columns, product selection, actions and mobile behavior remain usable; retries do not duplicate movements | Not run |
| Scanner opening and camera permission | Permission can be granted and the scanner displays a live camera image | Owner-reported pass for `111120`; this is not a barcode-decode result |
| Camera/scanner/photos/files remaining cases | Deny/retry, unavailable hardware, barcode found/not found/rapid duplicate and document/photo import have correct results | Not run |
| Baam voice and AI privacy | Explicit consent/decline/revoke behaves correctly at the actual provider boundary; voice recording/playback, private photos and shared adopted product photos work with approved test provider setup | Not run |
| Keyboard, links and backgrounding | Safe areas, keyboard focus, bottom navigation, custom/universal links, lock/unlock and return from background work | Not run |
| Offline and recovery | Losing connection during relevant mutations never reports a false success; recovery does not repeat a financial or stock operation | Not run |
| Own-account deletion | Reauthentication/confirmation, owner succession/sole-owner case, session invalidation and personal-data removal work; required company records remain and Apple renewal warning/management are available | Not run |
| Languages and screenshots | Russian, Kyrgyz and English include loading/error/recovery states; actual native screenshots match the final public-release candidate | Not run |

An unavailable real Apple product, signing identity, provider setup or physical
device is a remaining prerequisite, not a passed case. Do not ask the owner to
accept an incomplete candidate as the finished purchase-enabled build.
