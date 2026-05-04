# Currency Deep Audit

## Source Of Truth

- Store currency is the display/catalog source of truth: `Store.currencyCode` and `Store.currencyRateKgsPerUnit`.
- Historical transaction currency is now snapshotted on financial records: `CustomerOrder`, `RegisterShift`, `SalePayment`, `CashDrawerMovement`, `SaleReturn`, `FiscalReceipt`, `RefundRequest`, and `PurchaseOrder`.
- Supported display currencies are centralized in `src/lib/currency.ts`: `KGS`, `USD`, and `GBP`.
- `KGS` remains the base accounting/storage fallback because legacy financial columns are named and persisted as `*Kgs`.
- Display conversion is centralized in `src/lib/currencyDisplay.ts`:
  - `formatKgsMoney` converts persisted KGS values to the selected store currency.
  - `displayMoneyToKgs` converts selected-currency cashier inputs back to KGS for storage.
  - `formatStoreMoney` formats values that are already store-denominated, such as purchase-order `unitCost`.
  - `currencySourceWithFallback` prefers a saved transaction snapshot and falls back to current store currency only for older/incomplete rows.
  - `baseAccountingCurrency` is the explicit KGS base for platform/admin and integration surfaces without one store context.

## Audited Areas

- Prisma schema: store-level currency exists on `Store`; product prices, POS totals, receipts, and stock/cost accounting still use KGS-backed fields.
- Organization/store settings: `/settings/profile` edits store currency and exchange rate; KGS rate is fixed at `1`.
- Products: list/detail/new flows already convert product sale prices and costs through the selected store currency; quick search snippets now receive currency context.
- POS: entry, sell, history, receipt registry, shifts, receipt PDFs, and cash movement inputs now use selected register/store currency for display and convert cashier-entered cash/payment amounts back to KGS.
- Sales/orders: list/detail/new/metrics now use row or selected store currency when available.
- Purchase orders: UI and PDF now format purchase-order cost values with the order store currency. `PurchaseOrderLine.unitCost` is treated as store-denominated because the schema does not mark it as `*Kgs`; the add/edit line hint now states that unit cost follows the selected/order store currency.
- Reports: analytics charts now use selected store currency; all-store views remain base KGS because they intentionally aggregate multiple stores, and report pages now show that base-currency notice in the UI.
- Dashboard: already converted KGS metrics through selected store currency.
- Barcode/price labels: already use store currency through the previous print-flow pass.
- Public catalog: already uses the catalog store currency through `bazaarCatalog`.
- Billing/platform/admin metrics: remain base KGS because plan pricing and platform revenue analytics are KGS-denominated.
- Marketplace integrations:
  - M-Market export price surcharge is explicitly KGS-based.
  - Bakai/M-Market integration pages now call the centralized base accounting formatter for those provider/export prices.

## Important Fixes In This Slice

- Removed remaining app usage of `formatCurrencyKGS` from user-facing app pages and components.
- Replaced hardcoded receipt PDF `currency: "KGS"` formatting with selected store currency conversion.
- Replaced purchase-order PDF hardcoded KGS formatting with store-currency formatting.
- POS payment and cash inputs now convert selected-currency amounts to KGS before mutations.
- POS payment autofill now displays selected-currency totals while preserving the KGS total used by the backend.
- Receipt registry export rows now output formatted values in each receipt store currency.
- Platform estimated MRR and admin metrics now use explicit base-accounting formatting instead of plain number or implicit KGS formatting.
- Receipt print payloads now tolerate missing currency fields and fall back through the centralized currency display helpers.
- All-store analytics and sales-order metrics now tell users that mixed-store totals are shown in base accounting currency.
- Purchase-order unit-cost hints now state that the value is entered in the selected/order store currency rather than implying supplier-currency support.
- Store-scoped product search snippets in purchase orders, sales order detail, POS, product detail, and sales order creation now pass store currency context to the shared search-result row.
- Added nullable transaction currency snapshots and a safe backfill migration for historical sales, receipts, payments, returns, shifts, cash movements, refund requests, and purchase orders.
- New POS, sales order, public catalog/API order, cash movement, return, fiscal receipt, and purchase-order writes now persist the transaction currency at creation/completion time.
- POS history, receipt print payload/PDF, receipt registry, shifts, sales orders, purchase orders, and related exports now prefer saved transaction snapshots over current store settings.
- README and the older currency/localization audit now document `en`, `ru`, and `kg` plus the current store-currency display model.

## Multi-Store Rule

When a view has one selected store, the selected store currency is used.

When a view aggregates multiple stores and does not have a single selected store, the UI uses `baseAccountingCurrency` rather than guessing. This applies to platform/admin metrics and all-store analytics views. A future enhancement can add per-row currency columns or force store selection for mixed-currency reports.

## Regression Search Classification

The review searched for `KGS`, `сом`, `formatCurrencyKGS`, `currency: "KGS"`, and hardcoded `Intl.NumberFormat` currency usage.

- Allowed base default/storage:
  - `prisma/schema.prisma` and `prisma/migrations/**` default store currency to `KGS` for existing data.
  - `src/lib/currency.ts` defines supported currencies, conversion rules, and the base fallback.
  - `src/lib/i18nFormat.ts` still exports `formatCurrencyKGS` for explicit base-accounting use; app-facing currency display should prefer `src/lib/currencyDisplay.ts`.
  - Store profile/settings code compares against `KGS` because KGS rate is fixed at `1`.
  - Import templates and field names that include `*Kgs` describe persisted base-accounting fields.
- Allowed billing/platform:
  - README billing notes, `docs/subscriptions-v2.md`, billing tests, billing page number formatting, admin metrics, and platform metrics are KGS-denominated because plan pricing/platform accounting is not store-currency-aware.
- Allowed integration rules:
  - M-Market surcharge tests/docs mention `100 KGS`; that surcharge is an explicit provider/export rule.
- Allowed test fixtures:
  - Receipt, label, printing-adapter, and currency unit tests use `KGS` fixtures to verify fallback and non-KGS conversion behavior.
- Bug fixed now:
  - Receipt and purchase-order PDFs no longer hardcode `currency: "KGS"`.
  - POS payment/cash input conversion no longer treats selected-currency user input as raw KGS.
  - Receipt print payload now tolerates missing currency fields and falls back centrally.
  - All-store report pages now explicitly label base-currency totals.
  - Purchase-order line copy now states that unit cost follows the selected/order store currency.
- Deferred with reason:
  - All-store mixed-currency reports remain base KGS. Per-row currencies, grouping by currency, or forced store selection should be decided in a reporting product pass.
  - Purchase-order `unitCost` remains store-denominated by convention; the purchase order now carries a currency snapshot, but the line amount column is not renamed until a broader schema cleanup.
  - Generic product search rows in the command palette, reusable scan input, product form bundle editor, and product image studio have no single store context; they fall back through the centralized base currency until those flows get explicit store selection.
  - Manually imported or hand-created legacy rows with null snapshots fall back to related store currency. This can be imperfect if they bypass the backfill and the store currency later changes.

## Intentional KGS Uses

- Prisma defaults and migrations use `KGS` as the safe base fallback for existing production data.
- `src/lib/currency.ts` defines KGS as the default/base accounting currency.
- Billing plan environment variables remain named `PLAN_PRICE_*_KGS`.
- M-Market surcharge constant remains KGS because the integration business rule is KGS-denominated.
- Existing docs for subscription billing may still describe billing as RU/KGS because billing is not store-currency-aware.

## Remaining Risks

- Purchase-order `unitCost` is store-denominated by convention, not enforced by column naming. Purchase orders now snapshot the order currency, but a future schema migration should rename or document the line field more strongly.
- Legacy rows without snapshots fall back to current store settings. The backfill migration covers existing normal production rows, but imported/manual rows can still be imperfect.
- All-store reports remain base KGS; mixed-currency reporting needs a product decision before conversion.
