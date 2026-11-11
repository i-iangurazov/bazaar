# Apple catalog proposal — owner review required

Status: draft; prices/products are not registered or approved and sales stay off.
This does not replace the complete release goal or claim all plan-change paths
are ready.

The generated `apple-catalog.draft.json` enumerates 126 current subscription
configurations, 9 immutable legacy configurations, and 10 WhatsApp quantities.
Every entry records its frozen contract identity, duration, additions, exact
server entitlements and KGS service valuation. Its `approved:false` marker and
missing price points intentionally fail the production mapping contract.
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
  All proposed Apple price points and storefront availability remain unverified.

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

Immediate prorated upgrades/additions to an already prepaid GoPay or
non-renewing Apple term remain a commercial/design gate. An arbitrary prorated
KGS quote cannot be charged as a fixed Apple SKU. Do not call a renewal-only
path complete, drop existing additions, invent a credit currency, erase paid
remainder, or charge a full overlapping subscription. Prepare and approve a
specific transfer/upgrade model before enabling that transition. Existing paid
access and website functionality continue to work while this is resolved.

Before sales, confirm the exact registered IDs, prices in Kyrgyzstan and other
approved storefronts, applicable commission/Small Business eligibility, tax and
net payout treatment, legal offer version, refunds and the whole allowed upgrade
matrix. App Store Connect access and Sandbox verification are still needed.
Product IDs in the artifact obey Apple's 100-character limit; see [Apple's IAP
reference](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information/).

## Commercial decision appendix: customers with prepaid access

**Owner decision prepared on 2026-11-11; neither alternative is approved or
enabled.** Recommend **A** if next-period paid changes and separately approved
early access are acceptable. If immediate paid changes must match the web at
launch, choose **B** and keep that requirement open until implemented and tested.

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

**Reviewable choice:** A's commercial change/goodwill policy, or B's new products,
economics and implementation. Both need actual prices/terms, transition tests
and owner access gates. Renewal-only support does not complete the full goal.
This appendix changes no code, draft products, paid access or release status.
