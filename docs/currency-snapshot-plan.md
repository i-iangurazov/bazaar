# Currency Snapshot Plan

## Problem

Historical sales, receipts, refunds, cash shifts, cash drawer movements, and purchase documents previously rendered with the current store currency. If a store changed from USD to KGS after a sale, old receipt displays could change. That is financially unsafe because the transaction display context must be preserved at creation time.

## Existing Money Model

- `Store.currencyCode` and `Store.currencyRateKgsPerUnit` are the current display currency source of truth for one-store views.
- Product sale prices, POS totals, payments, returns, stock movement values, and reports are still persisted in KGS-backed columns such as `totalKgs`, `amountKgs`, and `unitPriceKgs`.
- `PurchaseOrderLine.unitCost` is store-denominated by convention, not a KGS-backed column.
- There is no exchange-rate ledger or base/foreign-currency accounting model yet.

## Schema Change

Added nullable snapshot fields:

- `CustomerOrder.currencyCode`, `CustomerOrder.currencyRateKgsPerUnit`
- `RegisterShift.currencyCode`, `RegisterShift.currencyRateKgsPerUnit`
- `SalePayment.currencyCode`, `SalePayment.currencyRateKgsPerUnit`
- `CashDrawerMovement.currencyCode`, `CashDrawerMovement.currencyRateKgsPerUnit`
- `SaleReturn.currencyCode`, `SaleReturn.currencyRateKgsPerUnit`
- `FiscalReceipt.currencyCode`, `FiscalReceipt.currencyRateKgsPerUnit`
- `RefundRequest.currencyCode`, `RefundRequest.currencyRateKgsPerUnit`
- `PurchaseOrder.currencyCode`, `PurchaseOrder.currencyRateKgsPerUnit`

All rate fields use `Decimal(18,6)` to match store exchange-rate precision and avoid floating point storage for persisted rates.

The migration is non-destructive:

- fields are nullable;
- no existing money columns are renamed or recalculated;
- a follow-up backfill migration copies the current store currency/rate into historical rows where possible;
- old/imported rows still fall back to related store currency if a snapshot is missing.

Production safety review:

- `20260504194525_currency_snapshots` only adds nullable columns, so it does not rewrite existing money data or require application-side backfill before deploy.
- `20260504194600_currency_snapshot_backfill` uses scoped `UPDATE ... FROM` statements. It will take normal row locks on rows it updates and scan the touched tables, so it should run during a normal migration window for very large tenants, but it has no destructive operation.
- Rows with missing relations are left null rather than guessed. Runtime display then falls back to the related store when available.
- The backfill never recalculates historical KGS amounts and never changes existing totals, payment amounts, line prices, or statuses.

## Snapshot Field Matrix

| Model | Fields | Written When | Fallback | Display |
| --- | --- | --- | --- | --- |
| `CustomerOrder` | `currencyCode`, `currencyRateKgsPerUnit` | POS sale draft/complete, manual sales order draft, API order, public catalog order | Shift snapshot, then store for POS; store for sales orders | POS sell/history, receipt payload/PDF, sales order list/detail, receipt registry |
| `RegisterShift` | `currencyCode`, `currencyRateKgsPerUnit` | Shift open | Register store | POS entry, shift history, cash shift close/open views, shift exports |
| `SalePayment` | `currencyCode`, `currencyRateKgsPerUnit` | POS sale payment creation and completed refund payments | Sale/return snapshot, then shift/store | Payment breakdowns inherit row/sale snapshot; export rows include snapshot fields |
| `CashDrawerMovement` | `currencyCode`, `currencyRateKgsPerUnit` | Cash pay-in/pay-out creation | Shift snapshot, then store | Shift page and cash drawer movement export |
| `SaleReturn` | `currencyCode`, `currencyRateKgsPerUnit` | Return draft creation and completion | Original sale snapshot, then shift/store | POS history returns and refund dialog totals |
| `FiscalReceipt` | `currencyCode`, `currencyRateKgsPerUnit` | Fiscal receipt queue creation | Sale snapshot, then store | Receipt payload/PDF falls back to fiscal receipt snapshot if sale snapshot is missing |
| `RefundRequest` | `currencyCode`, `currencyRateKgsPerUnit` | Manual refund request create/upsert | Sale return snapshot, then original sale/store | Stored for support/admin review and future refund views |
| `PurchaseOrder` | `currencyCode`, `currencyRateKgsPerUnit` | Purchase order creation and reorder draft creation | Store | Purchase order list/detail/PDF |

## Write Behavior

New records snapshot currency at creation/completion:

- opening POS shift snapshots the register store currency;
- POS sale draft snapshots the open shift currency, falling back to the register store;
- POS sale completion writes the sale snapshot onto payments and fiscal receipt queue records;
- sale return drafts use the original sale snapshot, falling back to shift/store;
- refund payments and manual refund requests use the sale return/original sale snapshot;
- cash drawer movements use the shift snapshot;
- manual, API, and public catalog customer orders snapshot the selected store currency;
- purchase orders snapshot the selected store currency.

## Display Behavior

Historical displays now prefer the row snapshot and only fall back to the related store:

- POS sell screen;
- POS history and return dialog;
- receipt registry table/mobile/export rows;
- receipt print payload/PDF, with sale snapshot preferred and fiscal receipt snapshot used before current store fallback for legacy rows;
- POS shifts page and shift history;
- sales order list/detail;
- purchase order list/detail/PDF;
- export rows for receipt registries, shift reports, and cash drawer movements.

The shared helper `currencySourceWithFallback(snapshot, fallback)` makes the rule explicit and keeps old rows safe.

## Aggregated Reports

Aggregated reports still use KGS-backed totals unless they are scoped to a selected store and already have a selected-currency display context.

Mixed-currency aggregation is not silently converted from snapshots because Bazaar does not yet have a conversion ledger. All-store analytics and metrics continue to disclose that mixed-store totals are shown in base accounting currency.

## Backward Compatibility

Older rows without snapshots:

- read from their row snapshot when backfilled;
- fall back to the current related store currency if imported manually without snapshot fields;
- remain financially usable, but a missing snapshot can still be imperfect if the store currency changed before backfill.

## Tests

Added/updated coverage for:

- snapshot helper preference and fallback behavior;
- POS sale/payment/shift/cash movement snapshots after store currency changes;
- receipt print payload using sale snapshot over current store currency;
- receipt print payload falling back to fiscal receipt snapshot before current store currency;
- public catalog checkout order snapshot persistence;
- refund return/request snapshot persistence;
- purchase-order PDF formatting through the order snapshot source;
- purchase-order UI source expectations for snapshot-aware detail currency.

## Remaining Risks

- This preserves transaction display currency and rate; it does not implement full multi-currency accounting, realized gains/losses, or conversion-rate history.
- Aggregated mixed-currency reporting remains base KGS unless a future reporting pass groups by currency or introduces a conversion ledger.
- Imported/hand-created legacy rows with null snapshots can only fall back to related store currency.
