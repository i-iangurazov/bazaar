# Direct temporary Apple upgrades — reviewable implementation, sales off

This is option C: one configured non-renewing Apple purchase funds a higher
configuration for the remainder of the current paid term. There is no wallet,
unused balance or invented gateway invoice. Existing GoPay/Apple base grants,
future prepayments and consumed usage remain separate.

No commercial approval, registered band prices, actual Sandbox purchase or
App Review acceptance is claimed. Below-minimum/zero handling currently supports
an explicit proposed **BLOCK** policy. That restriction is not owner approval or
proof that every existing immediate-change case is commercially covered. A free
owner-funded waiver would require a separately reviewed nonfinancial grant path;
there is no enabling stub for it.

## Commercial configuration

Both normal Apple foundation gates and these additional values are required:

- `APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED=true` after explicit review.
- `APPLE_BILLING_TEMPORARY_UPGRADES_JSON` containing a validated, versioned policy.

The policy must specify `version`, current `termsVersion`, `approved:true`,
`validUntil`, `rounding:"DOWN_WITH_OWNER_DISCOUNT"`, `zeroPolicy:"BLOCK"`,
`minimumPolicy:"BLOCK"`, `maxDiscountMinor`, `maxDiscountBps`, and `bands`.
Each band has a unique `key`, an actual unique Apple `productId`, and `prices`.
Each price defines `storefrontId`, ISO `currency`, integer `priceMillis`, and an
explicit `serviceMinorPerUnitNumerator` / `serviceMinorPerUnitDenominator`.
No rate, price, discount or approval is supplied by default.

The rational value is an owner-approved commercial valuation in KGS minor units
per one currency unit, not a fetched market exchange rate or promised settlement
rate. All bands for one storefront/currency must use the same rational valuation.
The server uses integer arithmetic to convert each approved band conservatively,
chooses the highest band that does not exceed the frozen incremental service
value, and checks both absolute and percentage owner-discount limits. If none
fits, the customer cannot pay through this path. No difference is put on account.

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

The migration is `20261111150000_apple_temporary_upgrades`. Applied earlier SQL
is unchanged. The new schema is required even while sales remain off. Meaningful
isolated regression cases cover dependency/refund/restore, same-SKU old receipt
binding, current/future preservation, quota anchors, authorization races and raw
database guards; actual Apple/device validation remains a separate release gate.

The expired-history regression uses the official verifier with a synthetic
current-signed JWS containing an older purchase date, then inserts coherent
already-served history under the database guards. It is not a successful live
late grant, an actual Apple-issued receipt or a Sandbox purchase.
