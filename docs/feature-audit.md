# Feature Audit

## Inventory correctness — OK
- Ledger + snapshot in one transaction; row-level lock in `src/server/services/inventory.ts`.
- Negative stock enforced per store policy.
- Idempotency enforced for adjust/receive/transfer via `src/server/services/idempotency.ts`.

QA checklist:
- Adjust stock with negative delta; verify blocked when `allowNegativeStock=false`.
- Receive stock; verify StockMovement + InventorySnapshot update together.
- Transfer stock between stores; verify out/in movements created once.
- Run recompute snapshots; verify onHand equals ledger sum.

## Purchase orders workflow — FIXED
- Explicit state machine in `src/server/services/purchaseOrders.ts`.
- Idempotent receive with `receivedEventId` and idempotency key.
- UI role gating for approve/receive in `src/app/[locale]/(app)/purchase-orders/[id]/page.tsx`.
- PDF export localized in `src/app/api/purchase-orders/[id]/pdf/route.ts`.

QA checklist:
- Create PO (draft), submit, approve, receive; ensure invalid transitions rejected.
- Call receive twice with same idempotency key; verify movements created once.
- Download PDF and confirm KGS totals + localized labels.

## Import/Export (CSV) — OK
- Preview → confirm flow in `src/app/[locale]/(app)/products/page.tsx`.
- Server import updates/creates products only (no stock changes) in `src/server/services/products.ts`.
- Errors surfaced with `translateError` in UI.

QA checklist:
- Import valid CSV; confirm preview count and import success.
- Re-import same SKU; confirm update instead of duplicate.
- Import with duplicate barcode; confirm localized error.

## Auth & RBAC — OK
- Protected routes in `middleware.ts` with locale-aware redirects.
- JWT-based RBAC enforced in `src/server/trpc/trpc.ts`.
- Role checks in procedures (manager/admin) and UI gating in PO detail.

QA checklist:
- Access protected route without session; redirected to locale login.
- Staff cannot approve/receive PO; admin can.

## Dashboard + lists — FIXED
- Empty/loading/error states added across list pages.
- Real-time refresh via SSE in dashboard/inventory/PO pages.
- Responsive tables use horizontal scroll wrappers.

QA checklist:
- Open dashboard with empty data; see empty state.
- Trigger SSE event; verify list refresh.
- Verify list pages render on mobile without layout break.
