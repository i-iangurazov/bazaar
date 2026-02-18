# KG Tax Pack (KG-ready / Export-ready / Integration-ready)

## Scope
- POS/KKM foundation: register, shifts, receipts registry, returns constraints, X/Z reporting.
- Marking module: configurable capture of marking codes at sale line level.
- ETTN (optional): reference tracking + exports.
- ESF (optional): reference tracking + exports.
- Accountant export pack: stable schemas for accounting workflows.

## Modules
- POS / KKM:
  - `OFF | EXPORT_ONLY | CONNECTOR | ADAPTER` KKM modes.
  - Shifts (`OPEN/CLOSED`) with opening/expected/counted cash and discrepancy.
  - Receipts registry (filters, fiscal status, payment breakdown).
- Marking:
  - Store-level `enableMarking` + `markingMode` (`OFF | OPTIONAL | REQUIRED_ON_SALE`).
  - Product-level `requiresMarking` + `markingType`.
  - Captures per receipt line in `MarkingCodeCapture`.
- ETTN:
  - Optional references in `EttnReference`.
  - No state integration with government APIs; reference/export only.
- ESF:
  - Optional references in `EsfReference`.
  - No direct ESF API integration; reference/export only.

## Permissions Matrix
- `CASHIER`:
  - POS sale draft/lines/complete
  - Marking code capture for receipt lines
- `MANAGER`:
  - Receipt registry
  - Export requests
  - Return completion, shift close, KKM retries
  - ETTN/ESF reference CRUD
- `ADMIN`:
  - All manager permissions
  - Compliance profile settings (KKM/Marking/ETTN/ESF modes)

## Exports (Accounting Pack)
- `RECEIPTS_REGISTRY`
- `SHIFT_X_REPORT`
- `SHIFT_Z_REPORT`
- `SALES_BY_DAY`
- `SALES_BY_ITEM`
- `RETURNS_BY_DAY`
- `RETURNS_BY_ITEM`
- `STOCK_MOVEMENTS_LEDGER` (`INVENTORY_MOVEMENTS_LEDGER`)
- `INVENTORY_BALANCES_AT_DATE`
- `PURCHASES_RECEIPTS`
- `CASH_DRAWER_MOVEMENTS`
- `MARKING_SALES_REGISTRY` (when marking used)
- `ETTN_REFERENCES` (when enabled)
- `ESF_REFERENCES` (when enabled)

Notes:
- CSV exports include UTF-8 BOM for Excel compatibility.
- Column order is stable and exported through centralized export builder.

## Data Retention and Auditability
- Stock ledger remains immutable (`StockMovement`); corrections use compensating entries.
- Compliance changes write `AuditLog`.
- Export requests/retries write `AuditLog`.
- Marking capture writes `AuditLog`.
- No secrets are included in exports.

## Manual QA Checklist
- Shift flow:
  - Open shift -> X summary visible.
  - Cash in/out -> reflected in expected cash.
  - Close shift -> Z data includes discrepancy.
- Receipt registry:
  - Filters by store/status/date.
  - Payment breakdown and fiscal status visible.
  - CSV/XLSX export works.
- Marking:
  - With `REQUIRED_ON_SALE` + marked product, sale completion is blocked without code.
  - After capture, sale completes successfully.
  - Marking export includes captured codes.
- ETTN/ESF:
  - References can be saved only when corresponding module enabled in store compliance.
  - ETTN/ESF exports contain expected columns and rows.

## Test Plan
- Integration:
  - marking required blocks sale completion without captured code.
  - CSV exports include BOM and stable headers.
  - receipt registry data is org-scoped.
  - ETTN/ESF write paths reject when module disabled.
