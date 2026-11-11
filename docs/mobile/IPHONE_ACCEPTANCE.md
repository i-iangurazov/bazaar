# Bazaar iPhone acceptance record

Status: **not run**. Compilation, browser checks and synthetic signed fixtures do
not complete this record. The owner's required delivery order is a complete
candidate, isolated website/internal TestFlight acceptance, then a separately
authorized App Store release.

Record the exact source SHA, app version/build, staging archive identity, Apple
processing result, iPhone model/iOS version, tester and UTC time before marking
any result passed. Save native screenshots and interruption evidence outside Git
with the build identity. Current browser screenshot candidates are not native
App Store screenshots.

Use only the dedicated preview services and synthetic organizations. Private
demo and two distinct SELF_SERVE Apple Sandbox logins are in the owner's local
release evidence directory; they must not be copied into Git or public listing
materials. Use Apple's actual test environment and registered products. Never
use a customer organization or real GoPay charge for these checks.

The staging build uses the same `kg.bazaar.app` identity and may replace another
Bazaar installation. It is explicitly internal-TestFlight-only, and cannot be
promoted into the public release. See [channel setup](IOS_TESTFLIGHT_STAGING.md).

| Check | Required observed result | Result / evidence |
| --- | --- | --- |
| Install, login, logout, password recovery, expired session | The intended organization/role/store appears, cookies survive restart, and protected data is unavailable after logout | Not run |
| Organization and role boundaries | Owner, manager and employee retain their real permissions; a different login cannot adopt the previous organization's purchases | Not run |
| Existing GoPay coverage | iPhone shows the current plan/additions/expiry and permits paid features without another Apple charge | Not run |
| Apple purchase and web access | Localized Apple price and explicit organization/term consent match the sheet; exactly one verified grant appears in iOS and web | Not run |
| Prepaid and future periods | New explicit renewal preserves all paid coverage and future selections; no quota reset or overlapping charge | Not run |
| Complete approved catalog | All approved plans, 1/6/12-month terms, allowed store/reserve combinations and enabled WhatsApp packs match actual products, prices and entitlements | Not run |
| Multi-organization Apple Account | Original immutable binding survives two Bazaar organization logins, restore and changes of Apple Account; same-group conflict opens no new sheet | Not run |
| Repeated and simultaneous purchase | Double taps and concurrent web/iPhone requests cannot create two grants or two Bazaar-initiated charges | Not run |
| Definite cancellation while offline | Cancellation is saved on device, retry acknowledges it after reconnection, and pending access is not mistaken for a charge or a grant | Not run |
| Pending approval | A delayed purchase remains pending after local timeout/restart; an old unpaid GoPay invoice cannot bypass it | Not run |
| Network lost after Apple charge | Closing/reopening the app and restoring connection recovers the signed operation; the app does not require another payment | Not run |
| Durable confirmation, lost finish ACK | Paid access is visible before Apple synchronization completes, and the unfinished receipt is retried safely | Not run |
| Restore and reinstall | Large/paginated history, an unrelated organization's receipt and a temporary verification failure preserve progress and do not duplicate access | Not run |
| Renewal, expiry, grace and billing retry | Signed Apple state drives access and dates; failure/expiry messaging is accurate and monthly usage remains consumed | Not run |
| Plan/addition changes | Every agreed immediate/scheduled transition uses the approved commercial model; pending reductions respect actual stores/users/products and enabled features | Not run |
| Out-of-app renewal and provider switching | App Store settings changes and missed/out-of-order notifications reconcile; overlap has a visible management/refund path; Bazaar does not claim it can cancel Apple itself | Not run |
| Refund/revocation | Only the corresponding rights/unused credit change; independent GoPay periods survive; submitted refund is distinct from Apple's decision | Not run |
| POS and fractional values | Product search, quantities/prices, payment methods for physical goods, held receipts, return flow and cashier permissions work without changing authoritative amounts | Not run |
| Products, balances, reports and documents | Create/edit/search, images, KGS/currencies, business dates, report download and document open/share work | Not run |
| Receiving, transfers, write-offs and stock count | Established columns, product selection, actions and mobile behavior remain usable; retries do not duplicate movements | Not run |
| Camera/scanner/photos/files | Allow/deny/retry, unavailable hardware, barcode found/not found/rapid duplicate and document/photo import have correct results | Not run |
| Baam voice and AI privacy | Explicit consent/decline/revoke behaves correctly at the actual provider boundary; voice recording/playback, private photos and shared adopted product photos work with approved test provider setup | Not run |
| Keyboard, links and backgrounding | Safe areas, keyboard focus, bottom navigation, custom/universal links, lock/unlock and return from background work | Not run |
| Offline and recovery | Losing connection during relevant mutations never reports a false success; recovery does not repeat a financial or stock operation | Not run |
| Own-account deletion | Reauthentication/confirmation, owner succession/sole-owner case, session invalidation and personal-data removal work; required company records remain and Apple renewal warning/management are available | Not run |
| Languages and screenshots | Russian, Kyrgyz and English include loading/error/recovery states; actual native screenshots match the final public-release candidate | Not run |

An unavailable real Apple product, signing identity, provider setup or physical
device is a remaining prerequisite, not a passed case. Do not ask the owner to
accept an incomplete candidate as the finished purchase-enabled build.
