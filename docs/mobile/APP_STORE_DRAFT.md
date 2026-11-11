# Bazaar — App Store listing and review draft

Prepared 2026-11-11. **Draft only; not ready for submission.** No App Store
Connect record, metadata, price, public seller declaration or release setting was
changed. The current native evidence is a compiled Simulator app, not a signed
device archive, completed Sandbox purchase or TestFlight release. The complete
release scope remains in `IOS_RELEASE_PROGRESS.md`.

## App record proposal

| Field | Concrete draft / remaining decision |
| --- | --- |
| Name | Bazaar |
| Bundle ID | `kg.bazaar.app` — preserve the existing identity |
| Platform / devices | iOS; existing iPhone and iPad support; minimum iOS 15 |
| Other Apple platforms | Inspect Mac with Apple silicon / Vision Pro availability defaults in the actual account; no compatibility or release on those platforms is claimed by the iPhone/iPad checks |
| Version / build | Source currently `1.0.0` / `1`; select an unused build number after inspecting the actual App Store Connect record |
| Primary category | Business, matching the existing retail operations application |
| Download price | Proposed free download with approved digital offers sold through Apple; this does not approve any IAP price or offer |
| Initial territory | Kyrgyzstan is a proposal requiring owner confirmation, not a saved availability setting |
| Release control | Manual release after approval; submission and publication still need explicit authorization |
| Copyright / seller | Owner must confirm the actual rights holder, year and public seller information; no legal name/address copied from private documents |
| Age rating / accessibility | Complete the current questionnaires against the actual release; no 4+, accessibility support or other rating is assumed |

The historical shared `store/listing.json` also describes Android. Its Google
Play publication status is not an App Store status. Its copy/assets can be reused
only after the checks below; it is not an approved iOS metadata export.

## Supported listing languages

Apple's current list supports Russian and English (U.K./U.S.), but not Kyrgyz as
an App Store metadata localization. The country table lists English (U.K.) for
Kyrgyzstan; displayed language also depends on device, storefront, added
localizations and primary language. Proposed listing: English (U.K.) `en-GB`
with Russian `ru`; the existing `en-US` copy can also be retained if that locale
is selected. Verify actual storefront presentation before release.
[Apple localization reference](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/).

**Keep Kyrgyz in the app.** `messages/kg.json` and native `ky.lproj` stay. The
Kyrgyz text below remains useful for the app, website and other supported
channels; do not invent an App Store `ky-KG` locale or replace Kyrgyz app text
with another language.

## Public copy — Russian

Name: **Bazaar**

Subtitle: **Продажи и учёт магазина**

Promotional text:

Товары, остатки, касса, складские операции и отчёты — с доступом вашей команды к одной организации Bazaar.

Description:

Bazaar помогает вести ежедневную работу магазина с iPhone и iPad.

• Находите товары, проверяйте цены и остатки.
• Работайте с кассой, продажами и заказами.
• Оформляйте приёмку, перемещения, списания и инвентаризации.
• Просматривайте отчёты и показатели магазинов.
• Сканируйте штрихкоды камерой и делитесь документами через системное меню.

Для работы нужны интернет, учётная запись Bazaar и доступ к организации и магазину. Доступные разделы зависят от роли сотрудника и тарифа организации. Уже оплаченный доступ организации сохраняется при входе в ту же организацию с iPhone, iPad или веб-версии.

Приложение доступно на русском, кыргызском и английском языках.

Помощь: https://www.bazaar.kg/help
Конфиденциальность: https://www.bazaar.kg/privacy

Keywords: **магазин,товары,остатки,продажи,склад,касса,штрихкод**

## Public copy — English (U.K.; reusable for en-US)

Name: **Bazaar**

Subtitle: **Sales and store inventory**

Promotional text:

Products, stock, POS, inventory operations and reports, with your team working in one Bazaar organisation.

Description:

Bazaar helps you manage daily store operations from your iPhone and iPad.

• Find products and check prices and stock.
• Work with POS, sales and orders.
• Manage receiving, transfers, write-offs and stock counts.
• View store reports and business metrics.
• Scan product barcodes with the camera and share documents through your device.

An internet connection, a Bazaar account and access to an organisation and store are required. Available features depend on your staff role and the organisation's plan. Existing paid organisation access remains available when you sign in to the same organisation on iPhone, iPad or the website.

The app is available in Russian, Kyrgyz and English.

Help: https://www.bazaar.kg/help
Privacy: https://www.bazaar.kg/privacy

Keywords: **inventory,store,retail,sales,stock,orders,barcode,warehouse,POS**

## Kyrgyz source copy — keep; not an App Store locale

Name: **Bazaar**

Subtitle: **Дүкөндүн сатуусу жана эсеби**

Description:

Bazaar iPhone жана iPad аркылуу дүкөндүн күнүмдүк ишин жүргүзүүгө жардам берет.

• Товарларды таап, бааларды жана калдыктарды текшериңиз.
• Касса, сатуулар жана буйрутмалар менен иштеңиз.
• Кабыл алууну, которууларды, эсептен чыгарууну жана инвентаризацияны жүргүзүңүз.
• Дүкөндөрдүн отчётторун жана көрсөткүчтөрүн көрүңүз.
• Камера менен штрихкоддорду сканерлеп, документтерди түзмөк аркылуу бөлүшүңүз.

Иштөө үчүн интернет, Bazaar аккаунту жана уюмга, дүкөнгө кирүү укугу керек. Жеткиликтүү бөлүмдөр кызматкердин ролуна жана уюмдун тарифине жараша болот. Уюмдун мурда төлөнгөн мүмкүнчүлүктөрү ошол эле уюмга iPhone, iPad же веб-версиядан киргенде сакталат.

Колдонмо орус, кыргыз жана англис тилдеринде жеткиликтүү.

Жардам: https://www.bazaar.kg/help
Купуялык: https://www.bazaar.kg/privacy

### Copy limits and publication conditions

The app name/subtitle must fit their 30-character fields; descriptions here are
well below 4,000 characters and promotional text below 170. Keywords have a
**100-byte** limit, not 100 Cyrillic characters. The new Russian keywords above
are 96 UTF-8 bytes. The old `store/listing.json` Russian keywords are 118 bytes;
do not paste them unchanged. The existing asset script only checks character
count, so it does not establish App Store keyword validity. The English keywords
are 63 bytes. The first App Store version has no “What's New” field; historical
release notes can stay in internal/Android materials.
[Apple version fields](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/).

Lightweight final text check: Russian name/subtitle/promotional text/description
are 6/23/106/752 characters, English 6/25/106/760; keyword byte counts above were
measured from the exact draft strings. No production build or provider call was
needed for this text validation.

Before publishing this copy, verify each named workflow on the actual iOS build,
including camera/share and cross-platform paid access. No offline sales,
certified fiscal/KKM compliance, proven push delivery, unlimited AI, automatic
marketplace integration or unapproved subscription price is advertised here.
This conservative copy does not remove those features from the release audit.

## Support, privacy, terms and owner declarations

| URL / item | Evidence / release action |
| --- | --- |
| `https://www.bazaar.kg/help` | Public GET returned HTTP 200 on 2026-11-11; Guide includes `support@bazaar.kg`. Confirm the mailbox is monitored and the contact flow works. No email was sent by this audit. |
| `https://www.bazaar.kg/privacy` | Public GET returned HTTP 200. The deployed text still says November 7 and describes support-request deletion and web payment processing. Deploy/review the new in-app deletion, Apple billing and AI-consent policy before App Review; an existing working URL alone is insufficient. |
| `https://www.bazaar.kg` | Existing marketing site; do not treat current web KGS prices as Apple storefront prices. |
| `https://www.bazaar.kg/legal/offer` | Public GET returned HTTP 200. Current Apple server configuration's terms URL; final approved Apple product/renewal/credit terms must be published and verified here. HTTP success does not approve those commercial terms. |
| Seller, copyright, review contact, territory | Still owner decisions. Keep private bank/tax documents, home address and reviewer credentials out of this repository and public copy. |

Use `IOS_APP_PRIVACY_AUDIT.md` for concrete collected-data categories and tracking
evidence, and `IOS_PRIVACY_ACCOUNT_DELETION.md` for AI processors, erasure and
retained records. App Privacy must include server/hosted-web behavior as well as
native SDKs. A framework's empty data array is not a “Data Not Collected” answer
for Bazaar. Final declared purposes, linkage, processors/regions, retention and
enabled communication/AI services need owner review and archive reconciliation.

Current `Info.plist` contains `ITSAppUsesNonExemptEncryption=false`. This means no
non-exempt encryption, **not** “the app uses no encryption.” The inspected native
code uses system HTTPS/StoreKit and has no custom native crypto implementation;
server-side BAAM media encryption is a separate processor/storage fact. Check
the final linked SDKs and dynamic web features, then complete Apple's export
questions and any required documentation before upload. No exemption or CCATS
classification is certified by this draft.
[Apple plist meaning](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption),
[export compliance workflow](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/).

The age-rating questionnaire must reflect actual BAAM/generative content,
business/customer content, communication and external-link behavior. Do not infer
a rating from the Business category. Accessibility claims require the relevant
real-device checks; a responsive layout alone is not a completed evaluation.

## Icon and launch-asset audit

Inspected visually and by image metadata on 2026-11-11; **no raster was changed**.

| Asset | Observed result |
| --- | --- |
| `public/brand/icon.png` | Existing blue rising-chart Bazaar mark; 195×183, alpha, sRGB; unchanged source traced to commit `4e48e65b` |
| `public/brand/logo.png` | Matching BAZAAR wordmark, 724×181, alpha, sRGB |
| Native `AppIcon-512@2x.png` | 1024×1024, no alpha, sRGB; universal iOS icon set references it; compiled app build accepted the catalog |
| `store/assets/app-store-icon-1024.png` | 1024×1024, no alpha, sRGB; matching existing mark, prepared by the store-assets script |
| Light/dark Splash images | All six referenced 1x/2x/3x PNGs are 2732×2732; matching light/navy backgrounds and mark; these are launch assets, not store screenshots |

`scripts/mobile/generate-assets.ts` (introduced with Capacitor in `3f90093c`)
resizes/composites the existing raster; it draws no new axes and performs no
rotation. No editable SVG/vector master for the Bazaar mark was found in the
inspected asset directories, and the PNGs have no EXIF orientation. Enlargement
explains visible source softness. Thin straight marks are also visible outside
the blue badge in existing generated icon/splash sources. Their intended status
is **unconfirmed**; root/owner must compare the originals before treating chart
axes as a stray artifact or editing the brand. A clean approved higher-resolution
master would improve future scaling, but none was invented for this draft.

The launch storyboard uses `Splash` with `scaleAspectFill`; verify clipping,
centering, light/dark appearance and rotation on the final iPhone/iPad build.
Icon choice and launch appearance still need final visual approval; the metadata
inspection is not a device screenshot review.

## Native screenshots — pending, with a concrete capture plan

The 14 files in `store/screenshots/browser-candidates/` are November 3 browser
captures from an isolated synthetic database. Their provenance explicitly says
`nativeRuntime:false` and `storeSubmissionReady:false`. Keep those labels; do not
resize/relabel them as native evidence or submit them as verified iOS captures.

Capture the tested release build with a dedicated synthetic review organisation,
English and Russian UI, no customer records, secrets or development overlays.
The current Apple requirements call for an iPhone Dynamic Island medium-display
set and, because Bazaar supports iPad, a 13-inch iPad set. Use accepted native
portrait sizes such as **1206×2622** for iPhone 17 Pro and **2064×2752** for a
13-inch iPad Pro, checking the actual captured device dimensions. PNG/JPEG must
be opaque; provide 1–10 per required device size. Recheck Apple's specifications
at upload rather than assuming the old 1242×2688 browser set covers the current
requirement.
[Apple screenshot specification](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

| Order | Actual screen / intended message |
| --- | --- |
| 1 | POS with a small synthetic receipt: products, fractional prices, totals and readable controls |
| 2 | Product list and stock: search, prices, quantities, existing icon actions |
| 3 | Receiving/transfer or count: retain the established operational columns, especially on iPad |
| 4 | Dashboard/report with synthetic period/store values |
| 5 | Actual native barcode/document flow, after successful permission/share checks |
| 6 | App Store purchase screen with real approved product metadata and organisation consent; capture only after real Sandbox/TestFlight verification |

Keep per-file provenance: build/commit, device/OS, locale, route, data fixture,
capture date and native runtime. StoreKit `.storekit` placeholder prices are not
evidence of real available offers. IAP review screenshots are separate from the
public gallery: show the offered item/service clearly in a supported device size.
[Apple IAP review screenshot requirements](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information/).

## Review fixture to provision before submission

No review credential is created or committed by this draft. Build the fixture in
a dedicated persistent review organisation after the release rollout is
authorized; do not use a customer's or friend's organisation and do not assume
the disposable preview login will exist during Apple review.

- **Operations fixture:** a dedicated administrator with synthetic products,
  variants/barcodes, decimal prices, stock, one register, reports and documents;
  a second synthetic staff login demonstrates restricted access. Provide known
  barcode values and sample share/export actions. Give the operations fixture
  verified review access without asking Apple to buy a real subscription.
- **Billing fixture:** a separate self-service administrator/organisation with
  no GoPay/prepaid/trial coverage, protected/manual/lifetime access or old pending
  invoices that would correctly block purchase. Use actual approved Apple SKUs
  and Sandbox review behavior. Do not clear a customer's paid term to create
  this state. The operations fixture's protected review access must not be
  mistaken for an eligible paid-checkout fixture.
- **Deletion fixture:** a separate disposable synthetic login for testing
  password confirmation, immediate own-account erasure and owner handoff. Do
  not erase the sole login Apple still needs for the rest of the review.
- Privately supply current login/password, review contact and exact fixture
  organisation/store names in App Store Connect review fields. Verify access
  from a fresh install without invitations, owner approval, a personal OTP or
  contacting support. Never place these values in public screenshots or Git.
- Validate the features intended for release, including Baam/voice/AI consent and
  any enabled integration, against the real release services. Do not replace
  an unconfigured provider with simulated success for the reviewer.

## Review notes — English draft to complete with verified fixture values

Bazaar is a retail operations application for an organisation and its staff.
Users sign in, select an authorised store, and work with products, stock, POS,
orders and reports. The app requires an internet connection. Feature access
depends on the organisation's plan and staff permissions.

Use the operations credentials in the private App Review account fields. The
account opens a dedicated demonstration organisation containing synthetic data.
The review attachment will identify its store/register, sample product barcode
and the steps for a sale, inventory operation and document export.

Digital Bazaar purchases in iOS use Apple In-App Purchase. Existing paid
organisation access is recognised across iOS and the website. Purchase or
restore does not move a transaction to a different organisation or grant the
same credits twice. The separate billing review account is eligible for the
approved offers. Open Billing → App Store subscription to view the product,
organisation, price and term, or use Restore purchases. Available Apple
subscriptions can be managed through Manage Apple subscription. Website GoPay
checkout is not exposed as an iOS digital-purchase alternative.

Payments recorded at a merchant's physical-store POS are business records for
that merchant and are separate from purchasing digital Bazaar access.

Open Settings → Profile → Privacy and account for AI processing consent and
Delete my account. AI sharing is optional and requires an explicit decision
before data is sent to the named external processors. Account deletion requires
password confirmation; necessary company financial/audit records may remain.
Deleting a Bazaar login does not cancel Apple auto-renewal. The confirmation
offers Apple's management flow and still allows immediate deletion. Use the
separate disposable deletion credentials from the private attachment for this
check so the main review login stays available.

**Before using these notes:** replace the fixture-dependent sentences with
observed names/steps, verify all paths on the shipping build, attach the
review-access details privately, and record any real integration dependencies.
This text is not evidence that the fixture or live Apple checkout already exists.

### Internal review/support preflight — cancellation recovery

The compiled native bridge durably journals a definite StoreKit cancellation and
retries its server acknowledgement after login/resume; a lost network response
must not be presented as a completed server cancellation. Verify cancellation,
offline interruption, restart and subsequent retry on the real review build.
The new attempt-bound pre-sheet path separately reports a caught `not_started`
outcome when this invocation never called StoreKit, including post-auth
backgrounding or a lost final-auth response. It never labels that as cancellation
in the App Store. A different winning attempt and every ambiguous post-SDK outcome
retain their payment protection; no timeout or missing-history auto-cancel exists.
Money already recorded by the server requires receipt/status review rather than
a cancelled message. The original intent creator and organization still govern
authorization: after payer deletion, loss of ADMIN or departure, a different
administrator cannot clear that proof. Keep this case in the support/reconciliation
runbook and verify its resolution before enabling sales; do not weaken tenant
binding, clear a money hold by timeout, or promise automatic reassignment.
This operational note is an internal release gate, not finished public listing
copy or evidence that the device scenario has passed.

## IAP metadata and commercial gates

`APPLE_CATALOG_PROPOSAL.md` and `apple-catalog.draft.json` retain all current,
legacy and WhatsApp configurations. They are not approved prices or registered
products. Do not omit additions, silently make prepaid terms recurring, use KGS
service valuations as Apple's charges, or promise instant cross-provider
upgrades not supported by the approved model.

For each actually approved SKU, prepare its own display name (2–30 characters),
description (up to 45), selected term/additions, product type, storefront price,
review notes and review screenshot. Keep the SKU-to-offer/contract mapping
unambiguous in the in-app consent screen and private review notes. When using
auto-renewal, publish the approved recurrence/cancellation terms; for non-renewing
prepayment, do not describe automatic renewal. Final product registration,
pricing, terms, transition matrix and successful Sandbox tests remain open.

## StoreKit CLI test issue — primary-source follow-up

This machine's complete Simulator App build passed, but both local StoreKit test
runs hit configuration-save `SKInternalErrorDomain Code=3` and `notEntitled` for
synthetic purchases. Explicit test-only configuration and a local ad hoc test
signature did not resolve it. See `APPLE_NATIVE_BILLING.md` for logs/results.

[Apple DTS thread 826971](https://developer.apple.com/forums/thread/826971)
acknowledges the iOS 26.5 CLI issue. The accepted Apple reply said no workaround;
a later Apple reply reported a fix in Xcode 26.6 RC, while subsequent non-Apple
reports still describe failures with the 26.5 runtime. This machine already uses
Xcode 26.6, so repeating the same command is not a supported resolution.

There is **no verified Apple-supported headless workaround for this exact
installed combination in the inspected sources**. The GUI warm-up and older
runtime suggestions in that thread are user reports, not an Apple assurance;
do not bypass the declined Xcode GUI access or download another runtime without
coordination. A compatible official toolchain/runtime update, an authorized Xcode
test session, or real Sandbox/device testing are follow-up paths, each requiring
fresh observed results. No private StoreKit API, fabricated entitlement or copied
daemon container is proposed. Failed local testing cannot be replaced by browser
screenshots or declared passed in the review submission.
