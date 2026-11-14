# Direct temporary Apple upgrades — reviewable implementation, sales off

This is option C: one configured non-renewing Apple purchase funds a higher
configuration for the remainder of the current paid term. There is no wallet,
unused balance or invented gateway invoice. Existing GoPay/Apple base grants,
future prepayments and consumed usage remain separate.

The owner approved charging the actual configured minimum for a **positive**
current-term quote below that minimum on 13 November 2026. Zero remains blocked.
This decision does not invent registered band products, prices, valuation rates,
terms or sales configuration. Actual Sandbox purchases and App Review acceptance
remain unverified. There is no free grant, wallet or leftover credit path.

## Current verification checkpoint — 13 November 2026

The positive-quote minimum rule is implemented locally. Focused unit/UI tests
passed 82 cases in three files; real PostgreSQL groups passed 59 cases in four
files plus 87 broader base-payment/refund/consumption cases in three files
(146 PG cases across seven files). Typecheck, lint and RU/KG/EN validation passed.
Six locale × portrait/landscape actual-component fixture states passed with 12
screenshots and zero network requests/mutations; the browser closed. Root also
inspected three representative images. The preserved `2,99 $` display price was
synthetic and establishes no actual StoreKit price.

Migration 147, SHA256 `c928c60955d3f34b0a4c919bd40ffa59cc9fec60e3c685e6434ac8585c18b323`,
was first applied to the owned localhost CI. It preserved all 29 original table
snapshots, 54 existing functions, 1,581 existing triggers and the 146 historical
migration records; the read-only `POST_TEMPORARY_MINIMUM` audit passed all 98
checks with zero blockers, warnings or skips. Both PG groups completed; owned
PostgreSQL/Redis are stopped with their data retained. Independent review at
file-set digest `d6e1f581…cc76c2` found no blockers. Later documentation edits
change that combined digest; all 21 reviewed application/SQL/test files still
match their recorded hashes. Private check evidence is consolidated in
`.local/ios-release-20261111/C-minimum-final-quality.json`.

The reviewed second remote run also applied the frozen migration to the pinned
isolated Preview, preserving all 29 original table snapshots, the 146 historical
migration records and existing definitions. Its `POST_TEMPORARY_MINIMUM` audit
passed all 98 checks without blockers, warnings or skips; the initial failed
inspection evidence remains retained. The C-minimum/147 production-mode cloud
build now passes at source `fbb9ae6c`, READY deployment
`dpl_24gtc81ajWaCYad5vgewkdktVxvm`, actually bound to the dedicated TestFlight
Preview alias. This later documentation update is not a new deployed source.
The one-organization/one-Starter Sandbox configuration was preserved and verified
through normal HTTP login/catalog reads; that is not a purchase of a C band.
No actual C-band products, prices, storefront configuration or remaining commercial terms are approved or
enabled. Real Sandbox/device purchases and App Review acceptance remain open.

## Commercial configuration

Both normal Apple foundation gates and these additional values are required:

- `APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED=true` after explicit review.
- `APPLE_BILLING_TEMPORARY_UPGRADES_JSON` containing a validated, versioned policy.

The policy must specify `version`, current `termsVersion`, `approved:true`,
`validUntil`, `rounding:"DOWN_WITH_OWNER_DISCOUNT"`, `zeroPolicy:"BLOCK"`,
`minimumPolicy:"BLOCK"|"CHARGE_MINIMUM_FOR_POSITIVE"`, `maxDiscountMinor`,
`maxDiscountBps`, and `bands`.
Each band has a unique `key`, an actual unique Apple `productId`, and `prices`.
Each price defines `storefrontId`, ISO `currency`, integer `priceMillis`, and an
explicit `serviceMinorPerUnitNumerator` / `serviceMinorPerUnitDenominator`.
No rate, price, discount or approval is supplied by default.

The rational value is an owner-approved commercial valuation in KGS minor units
per one currency unit, not a fetched market exchange rate or promised settlement
rate. All bands for one storefront/currency must use the same rational valuation.
The server uses integer arithmetic to convert each approved band conservatively,
chooses the highest band that does not exceed the frozen incremental service
value, and checks both absolute and percentage owner-discount limits. That normal
selection and its discount limits remain unchanged. With the explicit minimum
policy, a quote strictly above zero and below the cheapest configured market band
uses that band's actual price, with zero owner discount. The minimum comes from
the reviewed own-product configuration for that storefront/currency; there is no
hardcoded dollar floor or fallback to a full-period product. A missing minimum
product or market remains unavailable. `BLOCK` retains its previous behavior.

The immutable optional `minimumCharge.serviceAdjustmentMinor` records only the
positive difference between the selected band's service valuation and the
original prorated `amountMinor`. The amount is not a customer balance, debt or
extra entitlement. The quoted paid expiry, usage cycle and original service
quote stay unchanged. The normal relation is charged valuation plus owner
discount equals the quote; the minimum relation is charged valuation equals the
positive quote plus this adjustment, with no discount. A rounded zero is never
coerced to a positive charge. Historical contexts without the marker remain
readable and are not reinterpreted.

The actual Apple localized price remains distinct from that valuation. The native
bridge checks exact storefront, currency and price again before the sheet; a
changed price requires a new quote/consent. The verified receipt must match the
frozen band price/currency/storefront ID before a grant is created. Unexpected
paid evidence is retained in REVIEW for recovery/refund, never silently discarded.

Apple defines non-renewing purchases as limited-time access and makes the app
responsible for the interval and restoration. Applying that to this upgrade model
is an inference; clear product descriptions, full pricing/term disclosure and
review remain necessary. See [Apple's subscription handling guidance](https://developer.apple.com/documentation/StoreKit/handling-subscriptions-billing)
and [review guidelines](https://developer.apple.com/app-store/review/guidelines/).

## API and native contract

- `billing.apple.temporaryUpgradeCatalog` returns readiness/reason, policy version,
  original organization, current selection, `products[{productId,productType}]`,
  supported `markets[{storefrontId,currency}]`, and explicit current-term/future
  preservation flags. Protected or unsupported base access is unavailable.
- `billing.apple.previewTemporaryUpgrade` accepts `expectedOrganizationId`,
  `selection`, native `storefrontId` and `currency`. The server normalizes months
  to the current source's original term; this does not buy a new 1/6/12-month
  duration. It returns `offerKey`, `action:"CHANGE"`, selected band SKU,
  `quoteToken`, organization, source configuration/provider/interval, target
  configuration/limits, exact timing and `priceConstraint`.
- The preview also returns `minimumChargeApplied` and the separate service-value
  adjustment. Main details and consent show a minimum-charge explanation using
  the actual localized StoreKit `displayPrice`. No KGS valuation replaces the
  payment price, and missing or changed metadata still blocks checkout.
- `priceConstraint` is `{storefrontId:string,currency:string,priceMillis:string}`.
  Native Storefront.current ID is compared with signed `storefrontId`; the old
  transaction `storefront` field remains a separate three-letter country code.
- Existing `intent` receives the returned offerKey, `action:"CHANGE"`, signed
  quote, expected organization, idempotency UUID and accepted terms. Reusing an
  idempotency UUID for another band quote/target fails. Organization/source/future
  fingerprints, active payer, policy and rights are checked again under locks.
- Prepare/final native authorization return the immutable constraint. Final
  authorization still consumes a unique local native attempt exactly once.
  Only a caught pre-SDK failure or definite OS cancellation can release it with
  that winning attempt. Timeouts, process death and missing history do not.
- Confirm/restore/refund/notification protocols are reused. The existing main
  catalog/status has `temporaryUpgrades` with ACTIVE, SUSPENDED, EXPIRED, REVOKED
  or SCHEDULED status, source period, dates and target, plus separate review reason.
  A GRANTED money record is not a claim of unconditional currently active rights.

The preview's service-value amounts are KGS valuations, never an Apple display
price. UI must show actual StoreKit localized payment separately, describe the
current remaining interval and dependency, and must not substitute the full-term
renewal product when a band is unavailable.

## Funding, entitlement and recovery rules

Only current GoPay or non-renewing Apple bases are supported here. Existing
same-group automatic changes keep their own StoreKit behavior. Current-term
proration, frozen legacy/negotiated terms and future compatibility use the same
calculation as web CHANGE. Existing `assertScheduledSubscriptionCompatibility`
still rejects a higher current target that a paid lower future configuration
cannot maintain. Future invoices/periods are not rewritten, extended or upgraded.

Each C intent receives a new immutable `purchaseAppAccountToken` mapped to its
original organization and exact quote. Old purchases and automatic chains keep
their stable organization token. A reused price-band SKU cannot bind an old
receipt to the newest different quote: the signed per-intent token selects the
original intent. Unknown products with a known token remain durable review.

The new period contains full target entitlements, like an existing web
replacement period, but has an immutable same-organization `parentPeriodId`.
It ends with that parent and preserves the original cycle start/end/anchor.
For a historical paid period without a purchase snapshot, quota origin can be
the organization's creation time with no paid-window cap. C freezes that exact
effective quota context separately inside its immutable quote, including a null
cap, and carries it through later increments/refunds/restores. Financial
proration still uses the paid period; no old quota bucket or financial row is
rewritten merely to reconcile those different time origins.
The original base remains unchanged; temporary target does not replace stored
base `Organization.plan`. A second C upgrade depends on the prior active C grant.

The additive migration validates source token, price, exact authorized interval,
usage anchor and parent chain on insertion. Immutable parent edges plus existing
parents prevent cycles. Database triggers derive `dependencyRevokedAt` for all
descendants atomically when any ancestor is revoked/restored, including raw
database updates. TS access and all three database capacity/feature/marketplace
guards exclude invalid dependencies and expired temporary fallback targets.

An increment refund removes only its own target; original paid base/future
coverage remains. Revocation of its base cannot leave an unfunded higher plan.
Still-unserved blocked increment money becomes REVIEW with a specific dependency
reason. Reversal restores only that reason while the term and parent remain
valid; own refunds, sticky superseding and unrelated review are preserved. A
fully served expired purchase remains history. A suspended purchase does not
become resolved merely because time passes.

Existing manual GoPay bank-refund attestations intentionally do not revoke access
and are not reinterpreted as base revocation. Late approval after quote/source
invalidation or after the term ends remains paid REVIEW with a refund path;
there is no fictional past access, automatic extra debt or retained credit.

The original migration is `20261111150000_apple_temporary_upgrades`. The additive
`20261113130000_apple_temporary_minimum_charge` adds a positive-quote accounting
guard for the new marker on intent insertion/update, without changing historical
rows, database columns, or any existing parent/price/expiry/usage guard. Applied
migrations through 146 are unchanged. Read-only aggregate preflight distinguishes
`POST_TEMPORARY_MINIMUM` from the retained `POST_CONSUMPTION` stage and checks the
new function bodies, trigger and marker values. Meaningful
isolated regression cases cover dependency/refund/restore, same-SKU old receipt
binding, current/future preservation, quota anchors, authorization races and raw
database guards; actual Apple/device validation remains a separate release gate.

The expired-history regression uses the official verifier with a synthetic
current-signed JWS containing an older purchase date, then inserts coherent
already-served history under the database guards. It is not a successful live
late grant, an actual Apple-issued receipt or a Sandbox purchase.
