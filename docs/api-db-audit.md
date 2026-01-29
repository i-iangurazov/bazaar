# API + DB Audit Report

## Scope
- Server/service layer, tRPC routers, Prisma schema/migrations/seed, and DB-backed logic.
- Focus on inventory ledger correctness, PO workflow, and data integrity.

## Findings and Fixes
1) Duplicate PO line items could bypass validation and surface as raw Prisma P2002 errors.
   - Impact: inconsistent API errors, failed PO creation when duplicate product/variant lines are submitted.
   - Fix: add explicit duplicate line validation before insert.
   - Files: `src/server/services/purchaseOrders.ts`.

2) Inventory transfers allowed same-store moves and non-positive quantities.
   - Impact: redundant ledger entries and confusing audit trail.
   - Fix: guard against same-store transfers and invalid qty.
   - Files: `src/server/services/inventory.ts`.

3) Prisma constraint errors surfaced as generic 500s in tRPC.
   - Impact: incorrect error codes for conflicts/validation issues.
   - Fix: map Prisma errors to proper TRPCError codes (CONFLICT, NOT_FOUND, BAD_REQUEST).
   - Files: `src/server/trpc/errors.ts`.

4) Integration test DB reset omitted barcode/variant tables.
   - Impact: test flakiness when product barcodes/variants exist.
   - Fix: include all dependent tables in reset helper.
   - Files: `tests/helpers/db.ts`.

## Test Coverage Added
- Inventory ledger correctness, negative stock policy, transfer integrity, recompute validation.
- PO idempotent receive, invalid transition enforcement, RBAC for approve/receive.
- Barcode uniqueness (same org conflict, cross-org allowed).
- tRPC contract smoke for major mutations.

## Remaining Risks / Gaps
- Store name uniqueness is not enforced at the DB level (duplicates possible).
- SKU/name whitespace normalization is not enforced; duplicates could arise with casing/spacing differences.
- PO cancellation/partial receipts are not implemented (MVP scope).
