# Apple catalog proposal — owner review required

Status: commercial draft; 145 base/pack products are registered. The owner-approved
102 available 15%-scenario prices are configured and read back as Apple drafts;
43 above-grid prices remain unconfigured/unapproved. Broader terms and catalog
approval remain open, and public/production sales stay off. A separate isolated
Preview allows only one synthetic organization's current Starter Sandbox offer;
it does not enable the complete catalog or establish a successful purchase.
This does not replace the complete release goal or claim all plan-change paths
are ready.

The generated `apple-catalog.draft.json` enumerates 126 current subscription
configurations, 9 immutable legacy configurations, and 10 WhatsApp quantities.
Every entry records its frozen contract identity, duration, additions, exact
server entitlements and KGS service valuation. Its local `approved:false` marker
and unset verified price/storefront mappings intentionally fail the production
mapping contract; configuring Apple draft prices does not change that artifact.
Reproduce with `node --import tsx scripts/mobile/apple-catalog-draft.ts`.
Negotiated contracts need their own reviewed mappings; a public price must never
replace their saved terms.

## Proposed starting model

- Non-renewing Apple subscriptions for the complete 1/6/12-month prepaid grid.
  This preserves explicit renewal and supports separate organization purchases
  using the same Apple Account. Previously paid GoPay coverage is retained and
  the next period starts after existing coverage. It does not silently enroll
  a web customer into auto-renewal.
- Consumable products for WhatsApp quantities 1–10, with durable server-owned
  organization balances. Apple-purchased credits do not expire; web lots retain
  their original expiry. This difference requires approved Apple-specific terms
  before enabling that offer, and existing connection/worker/privacy gates stay.
- Actual Apple localized prices are loaded from StoreKit. The KGS amounts in the
  artifact are service valuations, not a promised Apple charge or exchange rate.
  OWN points for the 102 approved draft prices are verified; the 43 above-grid
  offers and approved storefront availability remain open.

## Actual registration and commission checkpoint — 13 November 2026

All 145 base/pack product IDs and their draft versions are registered under
Bazaar POS, Apple ID `6833508529`, bundle `kg.bazaar.app`. The 290 RU/en-GB
localization bindings were read back during creation; the final two-GET inventory
check found all 145 products without missing, foreign or conflicting IDs. At that
registration checkpoint their parent states were `MISSING_METADATA`. Registration
itself did not configure prices, availability or review submission. The later
price-only application below does not establish sellable offers.

The actual KGZ control-product price lookup offers 800 positive USD levels from
USD 0.29 to USD 1000. An initial private worksheet proposed the nearest gross price to
each frozen KGS service valuation, using the dated 13 November NBKR reference
USD rate of 87.4489 KGS. This is a comparison, not an exchange-rate guarantee.
111 proposed configurations fit that initial comparison; 34 Enterprise
six-/twelve-month configurations exceeded it. This pre-commission comparison was
superseded for draft-price selection by the commission table below. No above-grid
price was clamped to USD 1000 or assigned another product's price-point ID.
The actual higher-price request displays a mandatory consumption-information
capability when No is selected. The consent-aware server and optional buyer UI
are implemented with isolated tests; outbound reporting stays off and no actual
consumption response has been sent. The higher-price form has been truthfully
prepared, and the owner explicitly confirmed its legal declarations and
authorized submission. The signed-in Apple UI has now **acknowledged receipt**;
Apple's review/approval remains pending. Private evidence is
`.local/ios-release-20261111/catalog-registration/pricing-proposal/higher-price-submission-received.{png,json}`.
Submission does not approve or configure the 43 blocked prices, open higher
points, establish country availability or enable sales/publication.

The owner subsequently requested a commission-covering markup table before any
price application. The separate private workbook/CSV/JSON preserves all 145
base/pack configurations and their contract identities, with parallel 30% and
conditional 15% scenarios. It chooses the first available USD level that covers
the frozen KGS service valuation after one commission at the dated reference
rate. Exact rational/Decimal checks cover all 290 scenarios; the workbook's
formulas/cached prices and desktop rendering were checked. At 30%, 93 candidates
fit the current grid and 52 exceed USD 1000; at 15%, 102 fit and 43 exceed it.
An initial eleven-product comparison matched 22 candidate points; control-product
identifiers were not copied into other products' settings. The table excludes
taxes, exchange spreads, GoPay/bank fees and the separate temporary-upgrade bands.

The owner then explicitly approved **the exact available 15% column prices for
draft configuration only**, accepting the temporary shortfall while the standard
30% commission may still apply. All 102 selected OWN SKU grids were read from
Apple, their points were matched to the frozen plan, and their exact prices up
to USD 1000 were written and read back with KGZ/USD as the base. Independent
local review verified all 102 points/current indefinite schedules, 102 POST201
events and 102 raw before/after availability404 pairs; final pending writes are
zero. Each SKU has its own verification timestamp, not a simultaneous fresh
readback of the entire catalog. A transient Apple 500 occurred on a GET before
the next write; 89 entries were already confirmed and the remaining 13 completed
after inspection. The 43 prices above USD 1000 remain unconfigured/unapproved.

Availability is still **404 / `UNCONFIGURED_UNSPECIFIED`**, with
`countryRestrictionVerified:false`. This does not prove a KGZ-only restriction.
No availability or automatic-new-territory settings, sales, review submissions
or publication were changed. The source artifact retains `approved:false` and
unset verified mappings, and its sales guards stay off. This approval does not
approve the whole commercial catalog, temporary-upgrade policy or a 15% effective
commission date. Website GoPay prices were not changed.

Private evidence is retained under
`.local/ios-release-20261111/catalog-registration/approved-pricing-15-20261113/`:
`owner-approval.json`, immutable `apply-plan.json`,
`native-independent-apply-review.json`, the durable per-SKU journal and
`final-verification.json`. This is draft configuration evidence, not a real
Sandbox purchase or final store availability acceptance.

Under the standard Paid Apps terms the commission is 30%. An approved eligible
Small Business Program participant receives the 15% program rate; Developer
membership alone does not enroll the account. Eligibility includes associated
developer accounts, and Apple's published effective date follows approval rather
than the act of applying. The owner submitted the prepared application on
13 November and the signed-in Apple page confirmed receipt. Approval and the
effective date are still pending; no 15% effective rate is established.
See the [Paid Apps agreement, Schedule 2 section 3.4](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)
and [Small Business Program](https://developer.apple.com/app-store/small-business-program/).

For a simple USD 100 tax-exclusive illustration, a 30% commission leaves USD 70
and a 15% commission leaves USD 85, before other applicable adjustments. Preserving
that same gross reference amount after commission alone would require dividing
by 0.70 or 0.85, not merely adding 30% or 15%. Actual net proceeds require each
offer's Apple schedule and tax treatment; the control-product proceeds are not
proof of this account's program enrollment or final payout. The earlier question
about commission was not approval; the later explicit 102-price authorization
above is the current, narrower approved action.

Current base service valuations (KGS, additions excluded):

| Plan | 1 month | 6 months | 12 months |
| --- | ---: | ---: | ---: |
| STARTER | 2,000 | 11,400 | 20,400 |
| BUSINESS | 3,500 | 19,950 | 35,700 |
| ENTERPRISE | 5,500 | 31,350 | 56,100 |

The current contract includes a 5% six-month or 15% annual discount. Additional
stores and the reserve pack remain included in the chosen configuration and
limits; there are no new charges for features already included in the plan.

## Auto-renewal and changes that still need resolution

Apple permits at most 100 products in a subscription group and one active
subscription per Apple Account/group. Splitting interchangeable plans between
groups would expose customers to concurrent charges. The full 126-entry current
grid therefore cannot simply become one auto-renewing group. The server rejects
such a configuration. See [Apple's subscription configuration guidance](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/).

The implementation also supports reviewed same-group auto-renewable mappings,
with Apple determining effective upgrade/downgrade timing and charges. That
alternative has different recurrence and multi-organization constraints and is
not automatically selected for the prepaid catalog.

Immediate prorated upgrades/additions to a current prepaid GoPay or non-renewing
Apple term now have a reviewable, isolated-tested implementation: option C,
[direct temporary upgrades](APPLE_TEMPORARY_UPGRADES.md). Configured non-renewing
price bands fund only the remaining-term increment, preserving the paid base,
future periods and consumed usage without a retained wallet. Actual band
products/prices and remaining valuation/discount rules and terms remain
unapproved and sales stay off. The
earlier below-minimum BLOCK proposal is superseded for tiny positive upgrades by
the owner's explicit choice: **charge the minimum supported Apple payment while
keeping the original expiry unchanged**. That rule is now implemented and
locally verified: 82 unit/UI cases and 146 real-PostgreSQL cases across seven PG
files passed, with typecheck/lint/RU/KG/EN validation and six localized portrait/
landscape fixture states. Migration 147 passed its owned-CI and subsequent
isolated-Preview preservation checks: all 29 existing table snapshots and old
146 migration records/definitions were retained, with 98 clean read-only audit
checks. The production-mode cloud build now passes at source `fbb9ae6c` /
schema147, READY deployment `dpl_24gtc81ajWaCYad5vgewkdktVxvm`, actually bound to
the dedicated TestFlight Preview alias. This later documentation update is not
a new deployed source. Normal C HTTP login proves exactly one ready Sandbox
Starter offer and zero transactions/intents, not an actual StoreKit purchase.
See the [verification boundaries](APPLE_TEMPORARY_UPGRADES.md). Actual C-band products,
prices and remaining upgrade terms are still unapproved; sales stay off. No
goodwill gift policy was selected. Existing paid access and website functionality
continue.
An arbitrary prorated KGS quote is still not a StoreKit charge argument.

Before sales, confirm the exact registered IDs, prices in Kyrgyzstan and other
approved storefronts, applicable commission/Small Business eligibility, tax and
net payout treatment, legal offer version, refunds and the whole allowed upgrade
matrix. App Store Connect access is restored; actual Sandbox purchase/lifecycle
verification remains open.
Product IDs in the artifact obey Apple's 100-character limit; see [Apple's IAP
reference](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information/).

## Commercial decision appendix: customers with prepaid access

**Full commercial policies remain unapproved and disabled.** A and B remain
design alternatives. C has implemented mechanics and isolated regression
coverage. On 13 November the owner selected its positive-quote minimum-payment
rule with unchanged expiry; zero remains blocked. Actual band products/prices,
remaining discount limits and terms still require review. This does not
establish full catalog coverage or actual Apple acceptance.

An identified IAP product has configured storefront prices; a time-sensitive
web KGS quote is not an amount argument Bazaar can pass to StoreKit for that
SKU. KGS service value, Apple customer price and net payout remain separate.
See
[Apple's price-setting instructions](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase/).

| Choice | What the customer buys | Effect on existing payment | Change to today's web behavior / implementation status |
| --- | --- | --- | --- |
| **A. Full next period; optional early-access goodwill** | Complete 1/6/12-month configuration at its reviewed StoreKit price, after **all** existing paid/trial coverage | Preserve original grants, additions, expiry and financial records; no overlapping base charge | Paid changes normally start next period. Immediate goodwill needs explicit approval and a new bounded grant/UI/audit/refund path; renewal support does **not** implement it. |
| **B. IAP-funded upgrade credits** | Reviewed consumable pack only if existing balance is insufficient; explicit redemption funds the remaining-term increment | Preserve original base grants; old GoPay remainder does **not** become an extra spendable balance | New products, credit/allocation ledger and redemption/refund UI. **Not implemented, registered or enabled; outside the 145-entry draft.** |

### Exact customer examples

Dates are illustrative; production intervals require frozen timestamp boundaries.
These are valid configurations, with no invented Apple money price.

| Customer's existing coverage and request | A: full next period and optional goodwill | B: incremental credit redemption |
| --- | --- | --- |
| GoPay **STARTER + reserve pack**, paid through **1 May 2027**; on **1 March** wants **BUSINESS + reserve pack + 1 additional store** | Buy BUSINESS for **1 May–1 November**. Retain STARTER/reserve through 1 May. An approved goodwill grant alone enables the higher configuration for **1 March–1 May**; otherwise show the 1 May start before payment. | Redeem only the BUSINESS/store increment for **1 March–1 May**. Keep the paid STARTER/reserve baseline. |
| Apple non-renewing **BUSINESS + 2 additional stores + reserve pack**, paid through **1 October 2027**; on **1 July** wants **ENTERPRISE + 3 additional stores + reserve pack** | Buy ENTERPRISE for **1 October 2027–1 April 2028**. Optional goodwill covers **1 July–1 October**. Preserve original additions and the reserve pack. | Redeem only the increment for **1 July–1 October**. Keep the paid BUSINESS baseline and additions. |

Already-booked future periods push A's start later too. Neither choice overwrites
them, rewrites legacy/negotiated terms, refunds another provider, resets usage or
deletes data when capacity later falls.

### A: concrete proposed goodwill policy

Approve at most one early-access grant per selected next-period purchase, with
original grants, target configuration, dates, approver, reason and funding
transaction recorded. Show approval and future paid dates before purchase;
activate only after verified payment. Preserve consumed usage and its monthly
anchor; a higher limit raises the ceiling without resetting consumption.

Refund of that future purchase revokes its period and unserved goodwill
prospectively, preserving the original base. Keep created stores/products and
financial history under safe over-limit rules, with no retroactive debt.
This owner-funded benefit changes the commercial flow; it is not existing
automatic web/iOS parity.

### B: credit economics and refund dependencies that must be approved

Organization-bound credits would be non-transferable, with no cash-out or store
checkout use. Purchased unused units do not expire; redeemed service intervals
can end. Apple's general IAP credit rule requires non-expiring purchased credits;
Bazaar's particular model has no assumed eligibility/approval. See
[Guideline 3.1.1](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase).

Arithmetic-only example: a **100-unit** pack minus a **63-unit** locked quote
leaves **37** indefinitely. For another 63-unit quote, those 37 plus a hypothetical
50-unit pack leave 24. These are proposed examples, **not** registered packs,
KGS conversion rates or Apple prices. Actual denominations and a versioned,
contract-specific service-to-unit valuation require owner approval.

Required funding/refund behavior:

- Verify Apple funding into immutable organization-bound lots. Allocate units
  atomically/idempotently to the frozen quote, base grants, incremental features
  and interval. Use existing balance first. A stale quote leaves new units
  available; it cannot silently redeem a changed offer.
- A funding-lot refund removes only that lot’s unspent units and unserved funded
  increment. Preserve other funding, original GoPay/Apple base grants and past
  usage. Do not invent negative-balance automatic collection or cancel unrelated
  rights. Refund reversal cannot restore value twice.
- If the **base grant** is refunded, its paid upgrade increment cannot create a
  full unfunded higher plan. Suspend the unserved dependent increment and return
  its unserved units to their original, non-refunded lots. Concurrent base/credit
  refunds must reverse each allocation once, without minting replacement value.
- Keep usage anchors/data/additions and block conflicting web/Apple upgrades.
  Reinstall recovery, owner handoff and account deletion preserve the organization
  ledger without restoring a deleted person.

New ledger/quote/refund tests and Sandbox/App Review evidence must include
partially spent and multiply funded upgrades. Do not repurpose existing
subscription or WhatsApp balances as this wallet.

**Reviewable choices:** A's commercial change/goodwill policy, B's new products
and credit economics, or C's implemented direct temporary-upgrade mechanics
below. All require actual prices/terms and owner access gates. C's isolated tests
do not replace Apple/device validation or complete the full catalog/release goal.
This appendix enables no products, payment collection or changed paid access.

### C: direct temporary upgrade, without a retained balance

**Mechanics implemented and isolated-tested; remaining commercial terms
unapproved, products/prices unregistered and sales off.** On 13 November the owner
selected the minimum supported Apple payment for tiny positive upgrades, keeping
the original expiry unchanged. That specific rule is implemented and locally
verified, with its production-mode build and actual Apple acceptance still open;
it does not approve actual C-band prices. C uses a configured non-renewing product
to fund a temporary upgrade fixed by an immutable organization, rights, interval
and source-grant quote, without a retained balance. No wallet or full C-band
commercial terms are approved. Applying Apple's app-managed
non-renewing model to this upgrade is an inference, not Apple acceptance. The
configured band SKUs are separate from the 145-entry draft; none are enabled by
that artifact. See
[Apple's non-renewing guidance](https://developer.apple.com/documentation/StoreKit/handling-subscriptions-billing).

The proposal uses reviewed fixed-price upgrade bands and owner-funded downward
rounding. Hypothetical same-currency example: an approved cap of 3.20 with a
registered price of 2.99 charges 2.99 for the agreed upgrade; the difference is
a discount, with no retained customer balance. No real price or exchange rate is
established by that example. KGS reference valuation, Apple localized price and
seller proceeds remain separate. Other storefront currencies require an
approved versioned valuation; fixed USD bands do not establish it. Native
price/storefront checks and server receipt matching are implemented; a changed
price requires a new quote and consent.

Implemented mechanics include server-signed current-term CHANGE quotes, exact
per-intent receipt binding, frozen source/future fingerprints, parent-dependent
grants in shared entitlement and SQL-capacity checks, preserved legacy/current
usage anchors, restore, stale-paid REVIEW and refund/reversal recovery. Future
prepayments remain unchanged; existing compatibility checks still apply. Refund
of an increment removes only its rights; a revoked base cannot leave an unfunded
full target. Existing manual GoPay bank-refund attestations remain non-revoking.
See [implementation and isolated-test boundaries](APPLE_TEMPORARY_UPGRADES.md);
synthetic verified receipts and database tests are not actual Apple purchases.

Before sales, complete the C-minimum production-mode build and real Sandbox/
device checks. Approve the remaining intervals, discount ceiling,
storefront/currency rule, base/increment refund consequences, meaningful product
descriptions and actual C-band prices. More bands reduce the discount gap but
increase product/price maintenance. Actual Sandbox and App Review evidence remain
required. No new products, balances, access or payment collection are enabled by
this proposal.
