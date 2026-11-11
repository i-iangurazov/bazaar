# Bazaar iOS privacy evidence and declaration worksheet

Audited on 2026-11-11 against the compiled simulator app and this branch. These are evidence-backed draft answers for the release owner to review; nothing has been submitted to App Store Connect.

## Compiled artifact inspected

Artifact: `.local/ios-release-20261111/DerivedData/Build/Products/Debug-iphonesimulator/App.app`, `kg.bazaar.app`, version `1.0.0`, build `1`. This is a simulator/test build, not a signed distribution archive. Its test-framework contents must not be treated as the shipping SDK inventory.

| Item read from the actual bundle | Observed value |
| --- | --- |
| Initial web URL | `https://www.bazaar.kg/dashboard`; an unauthenticated request redirects to `/login?next=%2Fdashboard` |
| Navigation | HTTPS `www.bazaar.kg`; production web debugging and Capacitor logging disabled |
| Permission purposes | Camera, microphone and photo-library purpose strings are present in English, Russian and Kyrgyz (`en`, `ru`, `ky`) |
| Required-reason API declaration | File timestamp access, reason `C617.1`, for app-owned file/share operations |
| App privacy manifest after the incremental rebuild | `NSPrivacyTracking=false`, empty tracking domains; 18 distinct collected-data dictionaries, each with all four required keys, linked true and tracking false |
| Capacitor and Cordova framework manifests | Both included; their own collected-data and accessed-API arrays are empty, tracking is false |
| Other native functionality | Barcode camera SDK, device information/vendor identifier, files/share, keyboard, network, push, haptics, splash/status bar, and the StoreKit bridge |
| Permissions not found | No location, device address-book, health, motion, or ATT/advertising-identifier permission key |

The initial bundle omitted app-level collected-data dictionaries, an actual disclosure gap now corrected in the rebuilt simulator artifact. Empty framework arrays describe those frameworks, not Bazaar's authenticated web/backend behavior. Inspect the signed distribution archive and its privacy report again before submission. [Apple TN3184](https://developer.apple.com/documentation/technotes/tn3184-adding-data-collection-details-to-your-privacy-manifest) describes adding the app's own data categories, linkage, tracking status and purposes.

After that initial bundle inspection, the native owner added the baseline to `ios/App/App/PrivacyInfo.xcprivacy` and rebuilt the simulator app. An independent property-list read and SHA-256 comparison confirms the source and actual packaged file match: `d8b53410b91be51749ded955acdbac4bb000c4181bf4a49fc8455bb538ac6532`. Both contain 18 distinct categories with all four dictionary keys: the table below plus Audio Data, Emails/Text Messages and Performance Data. Linkage is conservatively true, tracking false; search/attribution use Analytics, authenticated technical/product events use Functionality and Analytics, and account/content/device/purchase types use Functionality. Absent location/address-book/advertising/crash/support categories were not added. This verifies packaging in the simulator artifact, not a distribution archive or runtime network trace. App Store Connect answers remain unsubmitted; processor conditions below still require review.

The StoreKit cancellation-recovery journal stores only its format version, an opaque purchase-intent identifier and the compiled canonical origin in app-owned Application Support. The file uses complete protection, private file/directory permissions and backup exclusion. It does not persist cookies, signed transactions, authorization tokens, or user/organization IDs, and does not introduce UserDefaults access. These are source/test evidence for local retry bookkeeping, not a new claim that purchase data is unlinked or that server-side purchase history is absent.

## Evidence-based App Privacy answers

**Does the app or its partners collect data? Yes.** Accounts, business records, private BAAM messages/photos, purchase records and authenticated diagnostic events are persisted off-device. Embedding the website in WKWebView does not remove this collection.

Use the exact constants below in `NSPrivacyCollectedDataType`. `Functionality` means `NSPrivacyCollectedDataTypePurposeAppFunctionality`; `Analytics` means `NSPrivacyCollectedDataTypePurposeAnalytics`. The dictionary also needs the exact keys `NSPrivacyCollectedDataTypeLinked`, `NSPrivacyCollectedDataTypeTracking`, and `NSPrivacyCollectedDataTypePurposes`. The full enum is verified against [Apple's type reference](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype), including its raw documentation JSON; spelling is significant, especially `PhotosorVideos`.

| App Store category / exact manifest constant | Concrete code evidence | Draft purpose and linkage |
| --- | --- | --- |
| Name / `NSPrivacyCollectedDataTypeName` | `User.name`, personal/business profile, customer/supplier names | Functionality; linked to the authenticated account/organization |
| Email Address / `NSPrivacyCollectedDataTypeEmailAddress` | Login/profile/invitations; user-entered customer contact fields | Functionality; linked |
| Phone Number / `NSPrivacyCollectedDataTypePhoneNumber` | Personal profile, store/business profile and customer/supplier records | Functionality; linked |
| Physical Address / `NSPrivacyCollectedDataTypePhysicalAddress` | Business/store address in `orgSettings`; entered addresses can be personal for a sole proprietor | Functionality; linked |
| Other Financial Info / `NSPrivacyCollectedDataTypeOtherFinancialInfo` | Stored sales, debts, expenses, cash/stock accounting and business income records | Functionality; linked to the organization/account |
| Payment Info / `NSPrivacyCollectedDataTypePaymentInfo` | POS stores the payment method (`CASH`, `CARD`, `TRANSFER`, `OTHER`) and payment references | Functionality; linked. This does **not** mean Bazaar receives Apple payment-card numbers or the owner's Apple Developer payout-bank documents. |
| Photos or Videos / `NSPrivacyCollectedDataTypePhotosorVideos` | Product photos, selected attachments and encrypted private BAAM image payloads persist on the server | Functionality; linked; optional feature use still needs disclosure |
| Other User Content / `NSPrivacyCollectedDataTypeOtherUserContent` | BAAM prompts/transcripts, uploaded documents and user-entered business content | Functionality; linked |
| User ID / `NSPrivacyCollectedDataTypeUserID` | User/organization IDs, organization-bound Apple app-account token, audit actor IDs | Functionality; linked. Analytics also applies where these IDs identify native/product-event analytics. |
| Device ID / `NSPrivacyCollectedDataTypeDeviceID` | `Device.getId()` uses `identifierForVendor`; push registration persists this installation ID, encrypted token/hash, device/app metadata and user ID | Functionality; linked, when notifications are used. This is IDFV/push registration, not an IDFA claim. |
| Purchase History / `NSPrivacyCollectedDataTypePurchaseHistory` | Apple signed transactions, subscriptions/consumables, web subscription invoices and entitlements | Functionality; linked |
| Product Interaction / `NSPrivacyCollectedDataTypeProductInteraction` | Native startup/connectivity events, guide views/feedback and persisted onboarding/first-operation product events | Analytics and Functionality where used for operational support; account-linked for authenticated native/product events |
| Other Diagnostic Data / `NSPrivacyCollectedDataTypeOtherDiagnosticData` | `/api/mobile/diagnostics` logs event, app/build/OS and optional bounded error detail together with user/organization IDs | Functionality and Analytics where used for technical quality; linked |
| Search History / `NSPrivacyCollectedDataTypeSearchHistory` | `/api/help/events` logs sanitized help searches and zero-result queries | Analytics; direct event payload does not include account/device ID. Confirm log/access-log correlation before claiming unlinked. Redaction of email/phone patterns does not make all remaining text anonymous. |
| Other Usage Data / `NSPrivacyCollectedDataTypeOtherUsageData` | First-party campaign attribution attached to signup/access requests and first-operation events | Analytics; linked after signup association |

The account-linked entries above must not be marked unlinked merely because an identifier is hashed, a token is encrypted, an organization ID is used, or an optional permission is required. Apple distinguishes routine optional feature collection from its narrow optional-disclosure exceptions. [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) supplies that distinction and the App Store category definitions.

### Provider-dependent or feature-dependent details to resolve

| Category | What is known / what remains to verify |
| --- | --- |
| Audio Data / `NSPrivacyCollectedDataTypeAudioData` | The selected recording is sent to OpenAI after explicit AI consent. Bazaar stores the transcript/hash/metadata rather than a raw audio-file record. The actual model (`BAAM_TRANSCRIPTION_MODEL`, default `gpt-transcribe`), provider retention and any real-time-only exclusion need owner/processor verification. Do not answer “not collected” based solely on the absence of a raw-audio database column. |
| Emails or Text Messages / `NSPrivacyCollectedDataTypeEmailsOrTextMessages` | Merchant email/WhatsApp features process message contents and participants. Include the category for the enabled release communication features; customer data processing and the separate WhatsApp privacy launch approval remain owner decisions. BAAM free-text history is already covered under Other User Content. |
| Performance Data / `NSPrivacyCollectedDataTypePerformanceData` | Server profiling/slow-request logs include durations; native diagnostics include startup readiness but no native crash/performance SDK was found. Determine the actual enabled performance instrumentation/logging and linkage; do not claim an absent crash SDK exists. |
| Customer Support / `NSPrivacyCollectedDataTypeCustomerSupport` | Include if the final in-app support flow collects support submissions or attaches diagnostics/content. An external support link by itself is not proof that an in-app support dataset is collected. |
| Developer/third-party advertising purposes | No advertising tracker was found in the inspected source/public page bundles. The existence of a merchant email-marketing feature is not, by itself, evidence that Bazaar uses app-user data for its own advertising. Confirm actual enabled marketing/processor practices rather than selecting these purposes from a feature name. |

No code evidence was found for collecting GPS location, a device address book, health/fitness, biometrics, a credit score, environment/hand/head scanning, gameplay, or advertising identifiers. A user-entered business address is Physical Address, not GPS. CRM customer contacts are not evidence that the app reads the device address book. Do not add these unrelated categories by inference.

## Tracking, initial routes and first-party attribution

The compiled app starts at `/dashboard`, not the marketing landing page. It can still reach first-party login, signup and public pages, so their behavior was inspected too.

The repository search of client/root layout, marketing/signup routes, providers, native code, public/mobile-shell resources and environment templates found no Meta Pixel/`fbq`, Meta CAPI, Google Analytics/Tag Manager, IDFA/ATT access, Hotjar, Clarity, Mixpanel, PostHog or Amplitude integration. The only marketing inline script is structured JSON-LD. Native and help diagnostics go to same-origin endpoints.

A read-only public HTTP check using the native user-agent inspected current `www.bazaar.kg` `/`, `/signup`, and `/dashboard`→`/login`, plus the public page/layout/signup/login JavaScript bundles. No listed tracker domains/functions were present. This is source/static-response evidence, not a JavaScript network trace of every authenticated flow or a guarantee about future server configuration.

`acquisitionFromSearch` accepts bounded ASCII campaign labels (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) plus a timestamp. Middleware keeps the first valid source in a 30-day first-party HttpOnly cookie, only on `/` and `/signup`; DNT/GPC suppress/delete it, and the API also suppresses attribution for those opt-outs. Full URLs, `fbclid`, `gclid`, Meta browser IDs and email/phone-shaped values are not accepted as attribution fields. Signup stores this first-party attribution with the account. This is collected first-party usage/attribution data, not demonstrated cross-company advertising tracking.

The shared web layout requests Google Fonts (`fonts.googleapis.com`/`fonts.gstatic.com`). That external service receives ordinary request metadata; its presence must not be described as “no external requests.” A font request alone is not evidence of targeted-ad tracking. Actual provider practices and the final deployed website remain part of owner review.

Based on this inspected code and public response, no cross-company tracking path requiring an ATT change has been demonstrated. Keep `NSPrivacyTracking=false` only while the final release continues to match that behavior and vendor practices. If a future website deployment enables a tracker in the native WebView, website cookie consent alone is not an ATT authorization. Apple's [tracking definition](https://developer.apple.com/app-store/user-privacy-and-data-use/) separates cross-company advertising/data-broker use from ordinary first-party service diagnostics.

## Processor and owner configuration facts

- Private BAAM images now live encrypted in PostgreSQL and are served through authenticated non-cacheable requests. They are still collected data. Adopted company photos use the separate configured product-image store; legacy public/CDN images retain the historical purge limitation documented in `IOS_PRIVACY_ACCOUNT_DELETION.md`.
- OpenAI and DeepSeek are named in the explicit AI notice; selected processors/models, regions, retention and contractual controls must match the release configuration. A `store:false` request flag is not proof of zero provider retention.
- iOS notifications use APNs. Android FCM server code does not establish that the iOS binary embeds Firebase. Device registration/notification payload handling still needs a signed physical-device check and actual APNs configuration.
- Hosting/database/storage/logging/email providers and merchant integrations must be reviewed from final production settings. The isolated preview has separate empty/synthetic infrastructure and disabled real providers; its configuration is not evidence of production behavior.
- Review the binary barcode dependency's vendor privacy practices alongside the final signed SDK/archive inventory. Absence of a bundled vendor manifest is not proof of collection or proof of no collection.
- Retention/legal-basis questions, backups, processor contracts, actual support/marketing behavior and published seller details remain owner configuration decisions. No new retention duration, trader address, payment account number or App Store answer was inferred from the owner's private documents.

## Remaining verification

The simulator rebuild packages the factual collection baseline. Archive the distribution build in the serialized verification queue and inspect its actual packaged manifests again. The owner should reconcile that report, the table above, final enabled web features and processor agreements with App Store Connect's questionnaire. This audit does not submit or certify that questionnaire and does not claim App Review acceptance.
