# B0 Agent 1 P0 verification results — POS & Cash Operations

## Status and evidence rule

This document records executable database/API verification for the nine Agent 1 P0 findings and retains the remaining browser work needed before remediation can be called done. No verdict below relies on source inspection alone.

- Baseline: accepted `hardening/integration` at `f308b2b793c2b43d7e46814c3c2007a0927fede7`
- Branch: `hardening/b0-agent-1-pos`
- Domain owner: Agent 1 — POS & Cash Operations
- Runtime verdict for every issue: `CONFIRMED`
- DB-backed tests executed in B0: 9 passed, 0 failed
- Authenticated API verification executed in B0: direct tRPC callers for Admin, Manager, Staff, and Cashier roles
- Browser verification executed in B0: none; this remains required before issue remediation is complete
- External fiscal provider calls: prohibited; KKM verification must use a deterministic mock adapter

The focused suite at `tests/integration/pos-p0-verification.test.ts` reproduced every finding through real tRPC/service calls and persisted before/after assertions. Browser evidence is additionally required for the user-visible workflow. A non-reproduction must retain its raw requests, responses, and state snapshots and be reviewed before an issue is closed or reclassified.

## Environment release and execution boundary

The coordinator released the hold point with the database-identity guard at commits `26b261f` and `815e80a`. The focused suite ran only through the required guarded command, against PostgreSQL database `bazaar_hardening_agent1_pos`, with Redis logical database 11 and external KKM/provider calls mocked.

Before the first DB-backed command, record the guard output and these read-only identity results in `docs/hardening/evidence/b0/agent-1/environment/`:

```sql
SELECT current_database() AS database_name,
       current_user AS database_user,
       current_schema() AS schema_name,
       inet_server_addr() AS server_address,
       inet_server_port() AS server_port;
```

The run must stop if the resolved database/schema matches another agent, the shared development database, Preview, or Production. Tests must create uniquely prefixed fixtures and must never truncate a shared schema. Cleanup, if needed, may target only recorded fixture IDs inside the confirmed isolated database.

## Provisional root-cause groups

| Group | Provisional boundary | Issues | Shared-file coordination |
| --- | --- | --- | --- |
| `A1-RC-AUTHZ-STORE` | Actor/store authorization is not mandatory at every POS service and HTTP/stream boundary | HARD-A1-001, HARD-A1-002 | Agent 4 owns shared store-access/RBAC helpers and SSE; Agent 1 owns POS service semantics |
| `A1-RC-AUTHZ-ROLE` | Coarse role procedures do not express operation-level register/close/refund policy | HARD-A1-003 | Agent 4 coordinates global RBAC; Agent 1 supplies the POS policy and domain tests |
| `A1-RC-LIFECYCLE` | Draft, cashier, shift, and register lifecycle invariants are enforced independently rather than as one operational state machine | HARD-A1-004, HARD-A1-006, HARD-A1-007 | Agent 1 domain logic; Agent 4 review if shared auth/audit helpers change |
| `A1-RC-STOCK-TXN` | Stock/refund policy is checked before, or overridden outside, the transaction that establishes the final invariant | HARD-A1-005, HARD-A1-008 | Agent 1 owns POS/return semantics; Agent 2 must review stock movement and negative-stock policy behavior |
| `A1-RC-EXTERNAL-CLAIM` | Manual and worker KKM retries do not share one atomic claim/provider-idempotency boundary | HARD-A1-009 | Agent 1 owns POS fiscal semantics; Agent 4 coordinates the job framework; Agent 3 reviews integration lifecycle conventions |

These groups are provisional. Runtime evidence may split or merge them; no implementation should begin merely because two source paths look similar.

## Required isolated fixture topology

All fixture names should start with `B0-A1-<issue>-<run-id>` so evidence and cleanup remain attributable.

| Fixture | Purpose |
| --- | --- |
| Organization A | Primary tenant containing two stores |
| Store A1 | Accessible store for limited users |
| Store A2 | Same-organization inaccessible store used to test assigned-store boundaries |
| Organization B / Store B1 | Cross-organization control proving tenant isolation still works |
| Admin A | Organization Admin control identity |
| Manager A1 | Manager assigned only to Store A1 |
| Cashier A1-1 / A1-2 | Two cashiers assigned to Store A1 for ownership/concurrency tests |
| Staff A1 | Limited POS role assigned only to Store A1 |
| Registers A1-R1/A1-R2 and A2-R1 | Active registers with independently controlled shift/draft state |
| Product P1 | Store-assigned product with deterministic price/cost and snapshot |
| Mock KKM adapter | Counts calls by receipt/idempotency key, can block/release calls, and never contacts a provider |

Each test must capture fixture IDs, actor role/store assignments, request IDs, idempotency keys, timestamps, response status/body, and the exact before/after database snapshots. Secrets, session cookies, connector tokens, and customer PII must be redacted from committed evidence.

SQL snippets use named placeholders such as `:sale_id`; the approved evidence harness must bind them to recorded fixture IDs. They are read-only evidence queries, not fixture mutation or cleanup commands.

## Evidence directory contract

For each issue, retain sanitized artifacts under `docs/hardening/evidence/b0/agent-1/<issue-id>/`:

- `fixture.json` — IDs, roles, store assignments, and initial state;
- `api.json` — ordered calls, request IDs/idempotency keys, status/error codes, and response hashes;
- `db-before.json` and `db-after.json` — results of the listed read queries;
- `browser.json` — browser, role, viewport, theme, console/network result, and assertion summary;
- screenshots or traces where the issue is user-visible;
- `verdict.md` — `CONFIRMED`, `DUPLICATE`, `DOWNGRADED`, `FALSE_POSITIVE`, or `BLOCKED_BY_ENVIRONMENT`, reviewer, and evidence links.

## P0 execution matrix

| Issue | Provisional group | Static support | Runtime verdict | Decisive evidence obtained |
| --- | --- | --- | --- | --- |
| HARD-A1-001 | `A1-RC-AUTHZ-STORE` | Yes | CONFIRMED | A Store-A1-only Manager read Store A2 shift, X-report, return, debt, POS receipt, and fiscal receipt records |
| HARD-A1-002 | `A1-RC-AUTHZ-STORE` | Yes | CONFIRMED | A Store-A1-only Cashier wrote Store A2 marking, cash, return, and debt-settlement state |
| HARD-A1-003 | `A1-RC-AUTHZ-ROLE` | Yes | CONFIRMED | Manager register creation, Cashier shift close, and Staff return completion all persisted |
| HARD-A1-004 | `A1-RC-LIFECYCLE` | Yes | CONFIRMED | Cashier B completed Cashier A's active and held drafts and replaced mutable attribution |
| HARD-A1-005 | `A1-RC-STOCK-TXN` | Yes | CONFIRMED | Two stale full-quantity returns both completed, returning/refunding twice and over-restoring stock |
| HARD-A1-006 | `A1-RC-LIFECYCLE` | Yes | CONFIRMED | Shift close succeeded with an active draft; later checkout failed with `posShiftClosed` |
| HARD-A1-007 | `A1-RC-LIFECYCLE` | Yes | CONFIRMED | An active register with an open shift/draft was deactivated and disappeared from POS entry/selectors |
| HARD-A1-008 | `A1-RC-STOCK-TXN` | Yes | CONFIRMED | Restricted store completed below zero and persisted a permissive negative snapshot |
| HARD-A1-009 | `A1-RC-EXTERNAL-CLAIM` | Yes | CONFIRMED | Concurrent manual/worker retries called the mocked adapter twice for one receipt |

## Executed runtime evidence

Command:

```bash
set -a; source .env.hardening; set +a; pnpm exec vitest run tests/integration/pos-p0-verification.test.ts
```

Result: 1 file passed; 9 tests passed; 0 failed; 87 migrations present with none pending. The initial sandboxed attempt could not reach localhost and collected no tests; the same guarded command was then authorized for the local isolated services. The final successful run took 5.12 seconds, including 3.38 seconds of test execution.

Evidence:

- Executable reproductions and before/after assertions: `tests/integration/pos-p0-verification.test.ts`
- Machine-readable run record: `docs/hardening/evidence/b0/agent-1/runtime-summary.json`
- KKM boundary: hoisted deterministic adapter mock; initial failure plus gated concurrent manual/worker success; zero live provider calls
- Isolation boundary: guarded reset of only `bazaar_hardening_agent1_pos`; Redis DB 11 reserved for this agent
- Classification count: 9 `CONFIRMED`; 0 `DUPLICATE`; 0 `DOWNGRADED`; 0 `FALSE_POSITIVE`; 0 `BLOCKED_BY_ENVIRONMENT`

### Static source anchors (provisional only)

| Issue | Source anchors to correlate with runtime evidence |
| --- | --- |
| HARD-A1-001 | `src/server/trpc/routers/pos.ts` read procedures; `listRegisterShifts`, `getShiftXReport`, `listSaleReturns`, `getSaleReturn`, `listPosDebts`, `listPosReceipts`; `src/server/services/kkmConnector.ts`; receipt PDF/print routes; `src/app/api/sse/route.ts` |
| HARD-A1-002 | POS router/service paths for `upsertSaleLineMarkingCodes`, return draft/line/completion, `settlePosDebt`, `recordCashDrawerMovement`, `retryPosSaleKkm`, and `retryFiscalReceipt` |
| HARD-A1-003 | `docs/pos.md`; `src/server/trpc/trpc.ts`; register, shift-close, and return-complete procedures in `src/server/trpc/routers/pos.ts` |
| HARD-A1-004 | `lockPosSaleDraftForEdit`, draft mutators, `resumeHeldPosSaleDraft`, and `completePosSale` in `src/server/services/pos.ts` |
| HARD-A1-005 | `assertReturnLineAvailable` and `completeSaleReturn` in `src/server/services/pos.ts` |
| HARD-A1-006 | `closeRegisterShift` and stale-draft handling in `createPosSaleDraft` in `src/server/services/pos.ts` |
| HARD-A1-007 | `updatePosRegister`; `src/lib/posRegisterContext.ts`; `src/lib/usePosRegisterSelection.ts`; shifts/history/debts pages |
| HARD-A1-008 | sale completion/completed-edit stock calls in `src/server/services/pos.ts`; effective inventory movement policy; the current negative-POS-stock integration assertion |
| HARD-A1-009 | `retryFiscalReceipt` and retry job in `src/server/services/kkmConnector.ts`; `retryPosSaleKkm` in `src/server/services/pos.ts`; KKM adapter contract |

## HARD-A1-001 — assigned-store read, artifact, and event isolation

- Provisional root-cause group: `A1-RC-AUTHZ-STORE`
- Static evidence: POS shift list/X-report, return list/get, debt list, receipt list, and fiscal receipt list pass organization plus caller-controlled identifiers without the actor; receipt PDF/connector and SSE enforce organization but not assigned stores.
- Verdict: `CONFIRMED`

### API execution

Using Manager A1 for manager-only receipt/KKM calls and Cashier A1-1 for protected POS calls, request Store A2 data by known fixture ID:

1. `pos.shifts.list({ storeId: A2, page: 1, pageSize: 20 })`
2. `pos.shifts.xReport({ shiftId: A2_SHIFT })`
3. `pos.returns.list({ registerId: A2_R1, page: 1, pageSize: 25 })`
4. `pos.returns.get({ saleReturnId: A2_RETURN })`
5. `pos.debts.list({ storeId: A2, page: 1, pageSize: 20 })`
6. `pos.receipts({ storeId: A2, page: 1, pageSize: 25 })`
7. `pos.kkm.receipts({ storeId: A2, page: 1, pageSize: 25 })`
8. `GET /api/pos/receipts/A2_SALE/pdf`
9. `POST /api/printing/receipt/connector` for `A2_SALE`
10. Open `GET /api/sse` as Manager A1/Cashier A1-1, perform a harmless fixture event in Store A2 through its authorized control actor, and inspect received event store/entity IDs.

Expected secure result: each direct target is denied or indistinguishably not found; unfiltered list results contain no A2 rows; PDF/print returns no artifact; SSE emits no A2 event. Organization B controls must also be denied.

### Database evidence query

```sql
SELECT u.id AS user_id, u.role, usa."storeId" AS accessible_store_id
FROM "User" u
LEFT JOIN "UserStoreAccess" usa ON usa."userId" = u.id
WHERE u.id IN (:manager_a1, :cashier_a1_1);

SELECT s.id AS shift_id, s."storeId", s."registerId",
       o.id AS sale_id, r.id AS return_id, f.id AS fiscal_receipt_id
FROM "RegisterShift" s
LEFT JOIN "CustomerOrder" o ON o."shiftId" = s.id AND o."isPosSale" = true
LEFT JOIN "SaleReturn" r ON r."shiftId" = s.id
LEFT JOIN "FiscalReceipt" f ON f."customerOrderId" = o.id
WHERE s.id = :a2_shift;
```

The response/event IDs must be joined back to this snapshot to prove that any exposed object belongs to inaccessible Store A2 rather than merely sharing Organization A.

### Browser execution

At 390x844 and 1440 in light and dark themes, sign in as the limited actor and open `/pos/shifts`, `/pos/history`, `/pos/debts`, `/pos/receipts`, and `/pos/kkm`. Verify Store A2 is absent from selectors/results and inject known A2 identifiers through route/query state or an authenticated browser request. Record network bodies, downloads, SSE messages, console output, and absence of A2 labels/receipt numbers.

### Confirmation oracle

`CONFIRMED` requires at least one authorized same-organization limited actor receiving an A2 record, artifact, or SSE payload. A UI dropdown hiding A2 is not a secure pass if the direct API still exposes it.

## HARD-A1-002 — assigned-store mutation isolation

- Provisional root-cause group: `A1-RC-AUTHZ-STORE`
- Static evidence: marking, return, debt, cash, and KKM mutation contracts omit actor store access in their service boundary.
- Verdict: `CONFIRMED`

### API execution

Use a Store A1-only actor with known Store A2 IDs. Test each family independently so one successful mutation cannot contaminate the next fixture:

1. `pos.sales.upsertMarkingCodes({ saleId: A2_DRAFT, lineId: A2_LINE, codes: [...] })`
2. `pos.returns.createDraft({ shiftId: A2_SHIFT, originalSaleId: A2_SALE })`, followed on separate fixtures by `addLine`, `updateLine`, `removeLine`, and `complete`
3. `pos.debts.settle({ saleId: A2_DEBT_SALE, registerId: A2_R1, method: "CASH", idempotencyKey })`
4. `pos.cash.record({ shiftId: A2_SHIFT, type: "CASH_IN", amountKgs: 10, reason, idempotencyKey })`
5. `pos.sales.retryKkm({ saleId: A2_SALE })` and `pos.kkm.retryReceipt({ receiptId: A2_RECEIPT })` as Manager A1

Expected secure result: a forbidden/not-found response before any write or provider mock call. Repeat each request with the same key to verify denial is stable and has no delayed side effect.

### Database evidence query

```sql
SELECT id, "storeId", status, "debtSettledAt", "debtSettledById", "kkmStatus", "updatedAt"
FROM "CustomerOrder"
WHERE id IN (:a2_draft, :a2_debt_sale, :a2_fiscal_sale);

SELECT 'marking' AS entity, count(*)::bigint AS row_count
FROM "MarkingCodeCapture" WHERE "saleId" = :a2_draft
UNION ALL
SELECT 'returns', count(*) FROM "SaleReturn" WHERE "originalSaleId" = :a2_sale
UNION ALL
SELECT 'payments', count(*) FROM "SalePayment" WHERE "customerOrderId" = :a2_debt_sale
UNION ALL
SELECT 'cash', count(*) FROM "CashDrawerMovement" WHERE "shiftId" = :a2_shift;

SELECT id, "storeId", status, "attemptCount", "providerReceiptId", "updatedAt"
FROM "FiscalReceipt"
WHERE id = :a2_receipt;
```

Capture all selected values before and after each isolated mutation. Any changed row, new payment/cash/return/marking row, inventory movement, audit entry representing success, or provider mock call is decisive evidence.

### Browser execution

Use an authenticated Playwright context for the Store A1-only actor. Verify inaccessible entities are not selectable, then execute the same crafted requests with that context's session and confirm the UI shows a safe localized denial without invalidating Store A1 into a false-empty state. Capture console/network errors at phone and desktop sizes.

### Confirmation oracle

`CONFIRMED` requires one inaccessible Store A2 mutation to succeed or produce a durable side effect. Merely receiving a raw validation error for a malformed request does not test store authorization.

## HARD-A1-003 — operation-level POS RBAC

- Provisional root-cause group: `A1-RC-AUTHZ-ROLE`
- Static evidence: documented policy assigns register management to Admin and shift close/refund confirmation to Manager/Admin, while register CRUD uses `managerProcedure` and shift close/return completion use `cashierProcedure`.
- Verdict: `CONFIRMED`

### API execution

Run a role table against valid Store A1 fixtures, keeping store scope valid so role denial is the only variable:

| Operation | Admin | Manager | Staff | Cashier |
| --- | --- | --- | --- | --- |
| `pos.registers.create/update/delete` | Allow | Deny | Deny | Deny |
| `pos.shifts.close` | Allow | Allow | Deny | Deny |
| `pos.returns.complete` | Allow | Allow | Deny | Deny |

For disallowed rows, expect a stable authorization error before the mutation. Use fresh fixtures and idempotency keys for each role. Execute allowed controls to show the fixture itself is valid.

### Database evidence query

```sql
SELECT id, "storeId", name, code, "isActive", "updatedAt"
FROM "PosRegister" WHERE id = :register_id;

SELECT id, status, "closedAt", "closedById", "closingCashCountedKgs", "updatedAt"
FROM "RegisterShift" WHERE id = :shift_id;

SELECT id, status, "completedAt", "completedById", "totalKgs", "updatedAt"
FROM "SaleReturn" WHERE id = :sale_return_id;
```

Disallowed calls must leave every value unchanged and create no payment, stock movement, or successful audit side effect.

### Browser execution

For each role at 390x844 and 1440, record direct-route behavior, action visibility, keyboard access, and the mutation response if a stale/open tab still renders an action. Manager must not receive register create/edit/deactivate/delete controls. Staff/Cashier must not receive close-shift or complete-refund controls. Server denial remains mandatory even if controls are hidden.

### Confirmation oracle

`CONFIRMED` requires a documented-disallowed role to complete the operation and persist the corresponding register, shift, or return change.

## HARD-A1-004 — active/held draft ownership and attribution

- Provisional root-cause group: `A1-RC-LIFECYCLE`
- Static evidence: the shared draft lock checks organization/store/status but not creator ownership or held state; completion attributes the sale to the completing actor; explicit resume is a separate transfer operation.
- Verdict: `CONFIRMED`

### API execution

1. Cashier A1-1 opens the shift and creates `DRAFT_A`, adds a priced line, and leaves it active.
2. Cashier A1-2 calls `sales.updateCustomer`, `updateNotes`, `addLine`, `updateLine`, `removeLine`, `updateDiscount`, `holdDraft`, `cancelDraft`, and `complete` against fresh A1-1-owned draft fixtures.
3. On a held fixture, Cashier A1-2 calls a direct edit and `complete` without `resumeHeldDraft`.
4. Control: Cashier A1-2 calls `resumeHeldDraft({ saleId, registerId })`, then performs the explicitly permitted transferred workflow.

Expected secure result: active/held direct access by Cashier A1-2 is denied; explicit resume is the only transfer and records the intended actor/state change. Completion never silently overwrites cashier attribution.

### Database evidence query

```sql
SELECT id, "storeId", "registerId", "shiftId", status, "isHeld", "heldAt", "heldById",
       "createdById", "updatedById", "completedAt", "updatedAt"
FROM "CustomerOrder"
WHERE id = :draft_a;

SELECT id, "customerOrderId", "productId", "variantKey", qty, "unitPriceKgs", "lineTotalKgs"
FROM "CustomerOrderLine"
WHERE "customerOrderId" = :draft_a
ORDER BY id;

SELECT id, "customerOrderId", "createdById", method, "amountKgs", "createdAt"
FROM "SalePayment"
WHERE "customerOrderId" = :draft_a
ORDER BY "createdAt";
```

Capture each mutation separately. A changed line/customer/discount/state, cancellation/completion, payment, stock movement, or incorrect `createdById`/`updatedById` is decisive.

### Browser execution

Use two simultaneous browser contexts at 390x844 and 1440. Keep Cashier A's cart visible while Cashier B attempts direct API actions and held-receipt navigation. Confirm A's cart remains stable after B's denial; then exercise explicit resume and verify both sessions receive coherent invalidation, warnings, and attribution. Capture console/network and receipt cashier/register labels.

### Confirmation oracle

`CONFIRMED` requires Cashier B to alter/cancel/complete Cashier A's draft without explicit resume, or a resulting receipt/payment/stock record to identify the wrong cashier.

## HARD-A1-005 — cumulative return quantity and refund serialization

- Provisional root-cause group: `A1-RC-STOCK-TXN`
- Static evidence: return-line availability is checked during draft editing; completion locks the return itself but does not revalidate/serialize cumulative completed quantity against the original order line.
- Verdict: `CONFIRMED`

### API execution

1. Complete one original POS sale with quantity 5 and a deterministic cash payment.
2. Create two return drafts, each containing quantity 5 for the same `CustomerOrderLine` while both are initially eligible.
3. Pause both completion requests at a test barrier immediately before the critical transaction and release them together with different idempotency keys using `Promise.allSettled`.
4. Repeat sequentially (complete draft 1, then stale draft 2) to cover both race and stale-draft paths.

Expected secure result: exactly one full return succeeds; the other receives a domain conflict. Completed return quantity is at most 5, refund total is at most original paid total, and stock is restored exactly once.

### Database evidence query

```sql
SELECT ol.id AS original_line_id, ol.qty AS sold_qty,
       COALESCE(SUM(CASE WHEN r.status = 'COMPLETED' THEN rl.qty ELSE 0 END), 0) AS returned_qty,
       COALESCE(SUM(CASE WHEN r.status = 'COMPLETED' THEN rl."lineTotalKgs" ELSE 0 END), 0) AS returned_kgs
FROM "CustomerOrderLine" ol
LEFT JOIN "SaleReturnLine" rl ON rl."customerOrderLineId" = ol.id
LEFT JOIN "SaleReturn" r ON r.id = rl."saleReturnId"
WHERE ol.id = :original_line_id
GROUP BY ol.id, ol.qty;

SELECT id, status, "completedAt", "completedById", "totalKgs", "completedEventId"
FROM "SaleReturn"
WHERE id IN (:return_1, :return_2)
ORDER BY id;

SELECT COALESCE(SUM("amountKgs"), 0) AS refunded_kgs
FROM "SalePayment"
WHERE "customerOrderId" = :original_sale_id AND "isRefund" = true;

SELECT "storeId", "productId", "variantKey", "onHand", "allowNegativeStock"
FROM "InventorySnapshot"
WHERE "storeId" = :store_a1 AND "productId" = :product_p1 AND "variantKey" = :variant_key;

SELECT id, type, "qtyDelta", "referenceType", "referenceId", "createdAt"
FROM "StockMovement"
WHERE "referenceId" IN (:return_1, :return_2)
ORDER BY "createdAt", id;
```

### Browser execution

Use two Manager/Admin contexts to open the same original receipt and prepare independent return drafts. Synchronize final confirmation, capture both responses/toasts, refresh both histories, and verify the UI shows only the allowed returned quantity/refund. Run at desktop and phone where return completion is supported; validate light/dark receipt state.

### Confirmation oracle

`CONFIRMED` if `returned_qty > sold_qty`, refund exceeds the original paid amount, stock restoration exceeds sold quantity, or both full return requests succeed.

## HARD-A1-006 — shift close with active unheld draft

- Provisional root-cause group: `A1-RC-LIFECYCLE`
- Static evidence: shift close checks held drafts but omits active `DRAFT` rows where `isHeld=false`; later draft creation can cancel stale drafts on a closed shift.
- Verdict: `CONFIRMED`

### API execution

1. Cashier A1-1 opens a shift, creates a sale draft, and adds a line without holding it.
2. In a second authorized Manager context, call `pos.shifts.close` with a valid count/note/idempotency key.
3. Attempt to update and complete the original draft, then attempt to create another draft on the register.

Expected secure result: close returns a clear conflict and leaves the shift open and draft active. It must not silently cancel/orphan the cart.

### Database evidence query

```sql
SELECT s.id AS shift_id, s.status AS shift_status, s."closedAt", s."closedById",
       o.id AS draft_id, o.status AS draft_status, o."isHeld", o."canceledAt", o."updatedAt"
FROM "RegisterShift" s
JOIN "CustomerOrder" o ON o."shiftId" = s.id
WHERE s.id = :shift_id AND o.id = :active_draft_id;

SELECT id, route, "userId", "createdAt", response
FROM "IdempotencyKey"
WHERE key = :close_idempotency_key;
```

Record state immediately before close, after close, after the draft completion attempt, and after any new-draft attempt.

### Browser execution

Use two contexts: Cashier A keeps `/pos/sell` open with an unsaved active cart; Manager B opens `/pos/shifts` and attempts close. Verify the blocking message identifies an active receipt, the Cashier cart remains operable, no forced navigation/data loss occurs, and both sessions update coherently. Capture 390x844 and 1440, light/dark, console/network.

### Confirmation oracle

`CONFIRMED` requires close to succeed while the active draft remains, or the subsequent workflow to cancel/orphan/block that draft without an explicit user decision.

## HARD-A1-007 — live-register deactivation lifecycle

- Provisional root-cause group: `A1-RC-LIFECYCLE`
- Static evidence: register update accepts `isActive=false` without operational dependency checks, while shared selection rejects inactive registers and debt selection uses active registers.
- Verdict: `CONFIRMED`

### API execution

Build separate register fixtures with: an open shift; an active draft; a held draft; and an unsettled debt. Call `pos.registers.update({ registerId, isActive: false })` as an otherwise authorized Admin. Also exercise delete if the UI/API exposes it for the same dependency states.

Expected secure result: deactivation/delete is rejected until operational dependencies are resolved, or the API returns an explicit recovery contract that keeps close/resume/history/debt settlement available while blocking only new sales.

### Database evidence query

```sql
SELECT r.id, r."storeId", r."isActive", r."updatedAt",
       count(DISTINCT s.id) FILTER (WHERE s.status = 'OPEN') AS open_shifts,
       count(DISTINCT o.id) FILTER (WHERE o.status = 'DRAFT' AND o."isHeld" = false) AS active_drafts,
       count(DISTINCT o.id) FILTER (WHERE o.status = 'DRAFT' AND o."isHeld" = true) AS held_drafts,
       count(DISTINCT d.id) FILTER (WHERE d."isDebt" = true AND d."debtSettledAt" IS NULL) AS open_debts
FROM "PosRegister" r
LEFT JOIN "RegisterShift" s ON s."registerId" = r.id
LEFT JOIN "CustomerOrder" o ON o."registerId" = r.id
LEFT JOIN "CustomerOrder" d ON d."registerId" = r.id
WHERE r.id = :register_id
GROUP BY r.id;
```

Capture the same query after deactivation and after trying current-shift close, active sale continuation, held resume, history, and debt settlement.

### Browser execution

Use an Admin register-management context and a Cashier operational context simultaneously. Attempt deactivate, then test `/pos`, `/pos/sell`, `/pos/shifts`, `/pos/history`, and `/pos/debts` with the target register. Verify either a safe block or complete recovery access. Record register selection persistence and direct URL behavior at phone/desktop and both themes.

### Confirmation oracle

`CONFIRMED` requires deactivation/delete to succeed while a live dependency exists and at least one required close/resume/complete/history/settlement path to become unavailable or misleading.

## HARD-A1-008 — effective negative-stock policy

- Provisional root-cause group: `A1-RC-STOCK-TXN`
- Static evidence: POS sale completion and completed-sale editing pass `allowNegativeStock: true`; the existing integration test codifies negative POS stock even when the store setting is false.
- Verdict: `CONFIRMED`
- Policy prerequisite: the current repository documentation treats `Store.allowNegativeStock=false` as an effective restriction. If product ownership declares an intentional POS exception, record that decision and update the contract before changing code or severity.

### API execution

1. Set Store A1 `allowNegativeStock=false`, snapshot P1 on-hand to 1, and create a POS draft for quantity 2.
2. Call `pos.sales.complete` with a valid payment/client state and unique idempotency key.
3. On a separate completed sale that consumed available stock, call `pos.sales.editCompleted` to raise quantity beyond stock.
4. Run controls with sufficient stock and, separately, a store explicitly configured to allow negative stock.

Expected result under the documented policy: restricted-store requests fail atomically with a localized stock error; order remains uncompleted/unedited; no payment, stock movement, or permissive snapshot mutation occurs. The explicitly permissive control may complete.

### Database evidence query

```sql
SELECT s.id AS store_id, s."allowNegativeStock" AS store_policy,
       i."productId", i."variantKey", i."onHand", i."allowNegativeStock" AS snapshot_policy,
       i."updatedAt"
FROM "Store" s
JOIN "InventorySnapshot" i ON i."storeId" = s.id
WHERE s.id = :store_a1 AND i."productId" = :product_p1 AND i."variantKey" = :variant_key;

SELECT id, status, "totalKgs", "completedAt", "completedEventId", "updatedAt"
FROM "CustomerOrder" WHERE id = :sale_id;

SELECT id, type, "qtyDelta", "referenceType", "referenceId", "createdAt"
FROM "StockMovement" WHERE "referenceId" = :sale_id ORDER BY "createdAt", id;

SELECT id, method, "amountKgs", "isRefund", "createdAt"
FROM "SalePayment" WHERE "customerOrderId" = :sale_id ORDER BY "createdAt", id;
```

### Browser execution

At phone and desktop, add more units than available and complete checkout. Verify a clear blocking message, retained cart, no completion receipt, and no unnecessary product-list refetch. Repeat the completed-sale edit from history. Validate both themes and capture console/network. Then execute the allowed-negative control to distinguish a policy block from a broken checkout fixture.

### Confirmation oracle

Under the documented restrictive policy, `CONFIRMED` requires sale completion/edit to succeed with `onHand < 0`, or the snapshot's `allowNegativeStock` flag to become true as an operation side effect. If policy intent changes, this oracle must be reviewed before verdict.

## HARD-A1-009 — duplicate KKM fiscalization under retry races

- Provisional root-cause group: `A1-RC-EXTERNAL-CLAIM`
- Static evidence: sale retry, receipt retry, and the background retry job each read failed state and can call the adapter without a shared compare-and-set claim around the external effect.
- Verdict: `CONFIRMED`

### API/job execution

Use only the mock adapter. Seed one failed adapter-mode fiscal receipt and configure the mock to block after incrementing an invocation counter but before returning.

1. Start `pos.sales.retryKkm({ saleId })` and `pos.kkm.retryReceipt({ receiptId })` concurrently from two Manager contexts.
2. At the same barrier, invoke the registered `kkm-retry-receipts` job for the same due failed receipt.
3. Release all calls, then repeat each request to test terminal/replay behavior.
4. Run permutations where the first provider response succeeds, fails retryably, times out, or succeeds but the caller loses the response.

Expected secure result: one owner claims the receipt, the mock records one fiscalization call for the receipt/provider idempotency key, other attempts return in-progress/original terminal state, and the database converges on one provider receipt.

### Database and mock evidence query

```sql
SELECT id, "customerOrderId", "storeId", status, mode, "idempotencyKey",
       "attemptCount", "providerReceiptId", "fiscalNumber", "lastError",
       "nextAttemptAt", "sentAt", "fiscalizedAt", "updatedAt"
FROM "FiscalReceipt"
WHERE id = :receipt_id;

SELECT id, "kkmStatus", "kkmReceiptId", "completedAt", "updatedAt"
FROM "CustomerOrder"
WHERE id = :sale_id;
```

Persist the mock call log beside DB snapshots with `receiptId`, provider idempotency key, caller (`sale-retry`, `receipt-retry`, or `worker`), start/end timestamps, outcome, and call count. The mock log is required because one final DB row cannot prove the provider was called only once.

### Browser execution

Open `/pos/history` and `/pos/kkm` in separate Manager browser contexts while the worker test barrier is active. Trigger both retry controls, capture disabled/loading states, responses, toasts, list refresh, duplicate receipt numbers, and console/network errors at desktop and phone sizes. The browser must use the mock-backed environment.

### Confirmation oracle

`CONFIRMED` requires the mock adapter to record more than one fiscalization invocation for the same logical receipt/provider idempotency key, even if the final DB row appears correct. No live KKM/provider call is permitted.

## Remaining browser execution order

1. Run HARD-A1-001 and HARD-A1-002 first because store-boundary failures affect the safety of every later browser fixture.
2. Run HARD-A1-003 before relying on role-specific browser fixtures.
3. Run lifecycle issues HARD-A1-004, HARD-A1-006, and HARD-A1-007 with independent fixtures.
4. Run transactional/concurrency issues HARD-A1-005 and HARD-A1-008 with deterministic fixtures.
5. Run HARD-A1-009 last with the mock KKM adapter and job runner; never enable a live provider.
6. Attach sanitized browser traces/contact-sheet references, then obtain Agent 4 independent review before remediation is marked done.

## Exit criteria for B0 verification

For each issue, B0 verification is complete only when:

- environment identity and fixture ownership are recorded;
- API reproduction includes a valid authorized control and invalid target/role/concurrency case;
- before/after DB evidence proves whether a durable side effect occurred;
- relevant browser flows are checked at 390x844 and 1440 in light and dark, with console/network capture;
- provider behavior is mocked and call-counted where applicable;
- evidence is committed outside ignored temporary directories;
- the verdict is independently reviewed by Agent 4;
- the ledger remains `OPEN` unless the evidence and reviewer explicitly support a state change.

All nine findings are `CONFIRMED` by isolated API/database evidence. They remain open defects: no fixes were made, browser coverage is still pending, and Agent 4 independent verification is still required.
