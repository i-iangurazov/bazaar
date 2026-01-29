# QA Checklist

## Latest run (2026-01-19)
- Runner: Codex CLI (no browser access)
- Status: Pending manual execution
- Login flows: not run
- Header scan/search: not run
- Users management: not run
- Stores + legal details: not run
- Products + variants: not run
- Inventory operations: not run
- Purchase orders workflow: not run
- Import/Export: not run
- RU/KG localization + formatting: not run
- Responsive checks: not run

## Latest run (2026-01-18)
- Runner: Codex CLI (no browser access)
- Status: Pending manual execution
- Login flows: not run
- Inventory operations: not run
- Purchase orders workflow: not run
- Import/Export: not run
- RU/KG localization + formatting: not run
- Responsive checks: not run

## Latest run (2026-01-17)
- Runner: Codex CLI (no browser access)
- Status: Pending manual execution
- Login flows: not run
- Inventory operations: not run
- Purchase orders workflow: not run
- Import/Export: not run
- RU/KG localization + formatting: not run
- Responsive checks: not run

## Login flows
- Login with admin/manager/staff credentials.
- Invalid password shows localized error.
- Logout redirects to locale login.

## Header scan/search
- Scan barcode in header; product opens or CTA to create.
- Type partial SKU/name; quick results open product.

## Inventory operations
- Receive stock (positive qty) updates onHand and writes StockMovement.
- Adjust stock (positive/negative) respects negative stock policy.
- Transfer stock creates TRANSFER_OUT + TRANSFER_IN.
- Min stock updates show low-stock badge when threshold reached.
- Movements modal shows recent entries with type + qty.

## Purchase orders workflow
- Create PO draft, add/remove lines, submit, approve, receive in order.
- Cancel draft/submitted PO; status moves to cancelled.
- Reject invalid transitions (e.g., approve draft).
- Receiving twice with same idempotency key does not duplicate movements.
- PDF export opens and shows KGS totals.

## Users management
- Admin adds user; role/locale saved.
- Admin disables/enables user; status updates.
- Reset password updates credentials.

## Stores management
- Create/edit store; toggle negative stock policy.
- Edit legal entity fields; values show in PO PDF.

## Products
- Create product with barcode; list shows stores summary immediately.
- Add/remove barcode; duplicate blocked with message.
- Add/remove variant; removal blocked if stock/movements exist.

## Import/Export
- Product CSV import preview shows correct rows.
- Import updates existing SKUs instead of duplicates.
- Export downloads CSV with localized filename.

## RU/KG localization + formatting
- Toggle language; UI updates and persists on refresh.
- Dates and currency render in locale (KGS).
- Missing translations log in dev.

## Responsive checks
- 375px: navigation drawer works; tables scroll horizontally.
- 768px: forms use two columns where expected.
- 1280px: sidebar visible; content centered.
