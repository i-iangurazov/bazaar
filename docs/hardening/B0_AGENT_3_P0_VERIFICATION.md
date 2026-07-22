# B0 Agent 3 P0 verification plan

## Boundary and current state

- Baseline commit: `f308b2b793c2b43d7e46814c3c2007a0927fede7` on `hardening/b0-agent-3-commerce`.
- Scope: runtime confirmation and post-fix acceptance design for all 15 Agent 3 P0 findings: `HARD-A3-001` through `HARD-A3-012`, plus `HARD-A3-021`, `HARD-A3-022`, and `HARD-A3-026`.
- This document is a verification plan, not runtime evidence. No database-backed test, application server, browser, Redis operation, HTTP provider request, marketplace request, or email-provider request was run while preparing it.
- Every finding below is `BLOCKED_BY_ENVIRONMENT`. Static evidence remains a hypothesis until the prescribed runtime reproduction executes against the isolated Agent 3 environment.
- No application code, test code, schema, migration, package, shared file, or provider configuration is changed in B0 by this document.

Status vocabulary:

- `BLOCKED_BY_ENVIRONMENT`: exact verification is designed, but execution is forbidden until the parent confirms the database guard and unique database identity are installed.
- `REPRODUCED`: the pre-fix runtime assertions and durable evidence pass.
- `FIX_VERIFIED`: the post-fix assertions, focused regression, browser check where required, and negative controls pass.
- `NOT_REPRODUCED`: runtime behavior contradicts the audit hypothesis; preserve the evidence and re-triage rather than silently closing the issue.

## Environment and destructive-test gate

The current harness is not safe for parallel hardening execution. `tests/global-setup.ts` can derive the same `${databaseName}_test` name for multiple worktrees, while `tests/helpers/db.ts::resetDatabase` truncates every table in the `public` schema except `_prisma_migrations`. Therefore none of the commands below may run until the parent explicitly confirms both the guard and the Agent 3 database identity.

Required gate before any DB or browser command:

1. `DATABASE_TEST_URL` resolves to the dedicated Agent 3 database, with an explicit identity such as `bazaar_hardening_b0_agent3_test`; it must not be a suffix automatically derived from a shared `DATABASE_URL`.
2. The installed guard proves the resolved host, port, database, and schema match the approved Agent 3 identity before migration, reset, or test setup.
3. The guard refuses production/staging/shared names and refuses a missing identity marker.
4. Agent 3 owns the only process allowed to truncate that database. Tests remain serial (`fileParallelism: false`; browser workers `1`).
5. Migrations use `prisma migrate deploy`; `db push` is prohibited.
6. If Redis-backed cache behavior is exercised, use a dedicated Redis database/instance for Agent 3. Never flush a shared Redis instance. Same-process memory-cache reproductions do not need Redis.
7. Email is forced to a local mock/log adapter, `RESEND_API_KEY` is absent, and all marketplace/AI fetches are mocked. A test fails if an unmocked external hostname is requested.
8. Browser identities and data belong to a dedicated B0 organization/store/register and are disposable; they are never production credentials.

Environment identity evidence to capture before execution:

```text
baseline SHA
resolved test DB host (redacted if necessary)
resolved test DB name and schema
guard output and exit code
migration status
Redis identity or "memory-only"
email/provider mode
test command and exit code
```

## Shared runtime fixtures

These fixtures should be added to focused test files only after the execution gate opens. They intentionally build on `tests/helpers/db.ts::seedBase`, `resetDatabase`, and `tests/helpers/context.ts::createTestCaller` rather than introducing another global reset path.

### Fixture F1 — two-store authorization graph

- Organization `orgA` on `BUSINESS` where plan checks could mask the behavior.
- Stores `storeA` and `storeB` in `orgA`.
- `adminA` is the organization owner; `managerA`, `staffA`, and `cashierA` have exactly one `UserStoreAccess`, to `storeA`.
- `productA` is active and assigned only to `storeA`; `productB` is active and assigned only to `storeB`; both have base prices.
- A supplier, a Store B purchase order, marketplace settings/jobs, an Image Studio job, and catalogue rows are created only as each test requires.
- A separate `orgB` with `storeC` is the negative tenant control.

### Fixture F2 — stock ledger

- Seed `productA` at exactly 10 base units in `storeA` through `adjustStock`, using a unique seed idempotency key.
- Record the starting `InventorySnapshot.onHand`, `StockMovement` count, movement type, `referenceType`, `referenceId`, `linePosition`, and idempotency key.
- Every assertion addresses the exact `storeId/productId/variantKey`; no organization-wide aggregate is accepted as stock evidence.

### Fixture F3 — Bazaar API key and requests

- Create a Store A key through `createBazaarApiKey`; retain the raw token only in test memory.
- Construct `Request` objects and call route handlers directly for deterministic API integration tests.
- Use unique external/order operation identifiers per test. Never log the raw token.
- Warm-cache tests call the exact same GET twice so the cache key is identical.

### Fixture F4 — public catalogue

- Publish a Store A catalogue with one product, a deterministic base/store price, and a unique slug.
- Use the public GET and checkout route handlers directly for API assertions.
- For browser coverage, seed one unique catalogue and customer identity per test run, then delete only through the isolated database reset.
- Stub `sendOrderConfirmationEmail` and `eventBus.publish` before importing the catalogue service when side-effect counts are asserted. The stub records calls and never performs network I/O.

### Fixture F5 — provider and network deny-by-default

- `EMAIL_PROVIDER=log`; no `RESEND_API_KEY`.
- Marketplace API clients are not invoked for RBAC tests. If a procedure would reach one, inject the existing mock mode or a `fetch` mock and fail on every unknown host.
- SSRF verification replaces global `fetch` with a spy returning a local synthetic `Response`; it must never open a socket.
- Restore environment variables and global mocks in `afterEach`.

## Planned test destinations and execution commands

No new test file is created in this audit-only step. The focused files proposed for the verification implementation are:

- `tests/integration/b0-agent-3-orders-p0.test.ts`: A3-001, 003, 004, 005, 009, 011, 012.
- `tests/integration/b0-agent-3-access-cache-p0.test.ts`: A3-002, 006, 007, 008, 010.
- `tests/integration/b0-agent-3-catalog-p0.test.ts`: A3-021, 022.
- `tests/unit/b0-agent-3-public-image-proxy.test.ts`: A3-026 with a mocked fetch.
- `tests/e2e/b0-agent-3-p0.playwright.mjs`: UI-only checks for A3-004, 011, and 012, plus the catalogue retry path for A3-021.

Commands are templates to run only after the parent opens the gate and the focused tests exist. Replace the placeholder with the approved Agent 3 URL; do not fall back to the repository's shared example database.

```bash
RUN_DB_TESTS=1 SKIP_DB_TESTS=0 DATABASE_TEST_URL='<approved-agent-3-database-url>' EMAIL_PROVIDER=log pnpm exec vitest run tests/integration/b0-agent-3-orders-p0.test.ts tests/integration/b0-agent-3-access-cache-p0.test.ts tests/integration/b0-agent-3-catalog-p0.test.ts --reporter=verbose

SKIP_DB_TESTS=1 EMAIL_PROVIDER=log pnpm exec vitest run tests/unit/b0-agent-3-public-image-proxy.test.ts --reporter=verbose

RUN_DB_TESTS=1 SKIP_DB_TESTS=0 DATABASE_TEST_URL='<approved-agent-3-database-url>' EMAIL_PROVIDER=log pnpm exec vitest run tests/integration/bazaar-api.test.ts tests/integration/sales-orders.test.ts tests/integration/purchase-orders.test.ts tests/integration/customers.test.ts tests/integration/bazaar-catalog.test.ts --reporter=verbose
```

Browser execution remains additionally blocked by the release-gate harness: the repository has a Playwright source file but no checked-in Playwright configuration or direct `@playwright/test` development dependency. Agent 4 must provide/approve the browser runner rather than Agent 3 editing shared package files. Once available, the intended command is:

```bash
PW_APP_URL='http://127.0.0.1:3003' PW_CATALOG_URL='http://127.0.0.1:3003/c/<agent-3-slug>' PW_ADMIN_EMAIL='<agent-3-admin>' PW_ADMIN_PASSWORD='<agent-3-password>' pnpm exec playwright test tests/e2e/b0-agent-3-p0.playwright.mjs --workers=1 --trace=on
```

## P0 verification index

| ID | Primary runtime layer | Required extra layer | Runtime state |
| --- | --- | --- | --- |
| HARD-A3-001 | DB integration | API lifecycle | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-002 | API integration with warmed cache | same-process cache; dedicated Redis follow-up | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-003 | HTTP route + DB | concurrent replay | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-004 | tRPC + DB | browser double-submit | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-005 | HTTP/service + DB | exact list/detail lookup | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-006 | tRPC/service + DB | Store A Manager browser check | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-007 | tRPC/HTTP + DB | direct-route browser denial | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-008 | tRPC/artifact HTTP + DB | direct-route browser denial | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-009 | tRPC/service + DB | order UI negative check | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-010 | service/API + DB | dedicated Redis/multi-instance follow-up | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-011 | browser + DB ledger | domain integration | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-012 | DB integration | browser partial-result/error state | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-021 | public HTTP + DB with mocked email/event | browser lost-response retry | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-022 | public HTTP + DB | browser price-change handling | BLOCKED_BY_ENVIRONMENT |
| HARD-A3-026 | unit HTTP route with mocked fetch | security negative matrix | BLOCKED_BY_ENVIRONMENT |

## Finding-by-finding verification

### HARD-A3-001 — API order stock is deducted again on completion

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G2, stock ownership/state transition.
- **Fixture:** F2 + F3. Start at `onHand=10`; create one API order for quantity 1 and capture its ID.
- **Pre-fix reproduction:** Call the API create route, assert status `CONFIRMED`, transition the same order through `salesOrders.markReady`, then call `salesOrders.complete` with one idempotency key. Query the exact snapshot and all `SALE` movements for `referenceType=CustomerOrder` and that order ID.
- **Before-fix assertions:** stock is `10 -> 9` at API creation and `9 -> 8` at completion; two negative movements/effects exist for one line or total ledger delta is `-2`.
- **After-fix assertions:** stock is `10 -> 9 -> 9`; exactly one stock-impact record exists per order line; completing twice with the same key remains `9`. In a separate cancellation branch, canceling the confirmed API order restores exactly the one deducted unit and a repeated cancellation adds nothing.
- **Evidence:** verbose test output plus JSON containing order ID, snapshots at all three points, and normalized movement rows.
- **Reusable coverage:** `tests/integration/bazaar-api.test.ts` already seeds stock and asserts API deduction/cancellation; `tests/integration/sales-orders.test.ts` already covers normal completion and completion idempotency. Neither joins those two lifecycles.
- **Duplicate disposition:** likely shared implementation with A3-009 and Agent 2's stock boundary, but not a duplicate acceptance case; retain independently.

### HARD-A3-002 — revoked Bazaar API credentials remain valid from cache

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G3, cache invalidation/security.
- **Fixture:** F3. Use a GET request because authentication caching is GET-only.
- **Pre-fix reproduction:** GET `/api/bazaar/v1/products` to warm the exact token-hash auth cache; revoke the key through `revokeBazaarApiKey`; immediately repeat the identical GET. First run same-process with no Redis, then repeat with the approved Agent 3 Redis identity to cover shared-cache behavior.
- **Before-fix assertions:** first and post-revoke GETs both return `200`; database `revokedAt` is non-null before the second request.
- **After-fix assertions:** post-revoke GET returns `401` with the stable public unauthorized code immediately; direct authentication also rejects; a second process/cleared memory layer cannot recover the cached credential.
- **Evidence:** response status/body sequence, redacted key ID/prefix, `revokedAt`, and cache mode; never record the token.
- **Reusable coverage:** `tests/integration/bazaar-api.test.ts` covers invalid keys and burst `lastUsedAt` throttling but has no warm-cache revoke test.
- **Duplicate disposition:** no duplicate Agent 3 issue; shares invalidation infrastructure with A3-010/A3-022 but has a security-specific cache key and acceptance test.

### HARD-A3-003 — API order retries are unsafe when `externalId` is omitted

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G1, durable operation identity.
- **Fixture:** F2 + F3; valid JSON order body deliberately omits `externalId`.
- **Pre-fix reproduction:** submit the identical POST twice sequentially and twice concurrently, modeling a committed response that the client did not receive.
- **Before-fix assertions:** sequential requests create two different order IDs/numbers and two stock deductions; concurrent requests do the same.
- **After-fix assertions:** missing `Idempotency-Key` is rejected with one documented 4xx code; with `Idempotency-Key: b0-a3-003-retry`, both sequential and concurrent calls return the same order identity/body, one order row, one customer increment, and one set of stock/email/event effects. Reusing the key with a different body returns a conflict.
- **Evidence:** status/body pairs, order count, stock delta, movement count, customer `orderCount`, and side-effect spy counts.
- **Reusable coverage:** Bazaar API integration tests exercise POST compatibility and external-ID replay but always supply `externalId`; the stock fixture is directly reusable.
- **Duplicate disposition:** likely one shared idempotency primitive/migration with A3-004 and A3-021; not duplicate because caller trust, abuse controls, and side effects differ.

### HARD-A3-004 — internal sales and standard purchase-order creation are not idempotent

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G1, durable operation identity.
- **Fixture:** F1; for PO assertions seed `onOrder=0` and one line of quantity 5.
- **Pre-fix reproduction:** invoke identical `salesOrders.createDraft` calls twice; separately invoke identical `purchaseOrders.create({submit:true})` calls twice. In the browser, delay the first tRPC response and double-activate the submit control by mouse and Enter.
- **Before-fix assertions:** two sales drafts exist; two submitted POs exist; product `onOrder` is 10 instead of 5; browser emits two mutation requests or displays two resulting documents.
- **After-fix assertions:** each create contract carries a durable operation key; same-key sequential/concurrent calls return one document; mismatched payload reuse conflicts; PO `onOrder` is exactly 5; the UI disables duplicate submission and preserves the key across a retry after an ambiguous response.
- **Evidence:** tRPC payloads, document IDs/counts, before/after `onOrder`, browser trace, and request count.
- **Reusable coverage:** sales-order tests cover draft creation; PO tests cover idempotent receiving and reorder creation. They provide patterns but do not cover ordinary create replay.
- **Duplicate disposition:** the sales and PO cases are likely one framework fix but should be split into two tests. Shared cause overlaps A3-003/A3-021 and Agent 2 replay defects.

### HARD-A3-005 — external order IDs can collide by substring

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G1, external order identity/storage.
- **Fixture:** F3 with valid stock and two bodies differing only by `externalId` (`EXT-10`, then `EXT-1`).
- **Pre-fix reproduction:** create `EXT-10`, then create `EXT-1`; query list filter and detail lookup using `EXT-1`.
- **Before-fix assertions:** the second create or lookup resolves to the `EXT-10` order, so only one row exists or the wrong order ID is returned.
- **After-fix assertions:** two exact identities create two distinct rows; replay of either exact ID returns only its own row; list/detail lookup for `EXT-1` never returns `EXT-10`; a database uniqueness constraint rejects true duplicates within the approved key/store scope.
- **Evidence:** external IDs, internal IDs/numbers, normalized API bodies, and constraint/replay result.
- **Reusable coverage:** Bazaar API integration tests already create `EXT-1`, pagination IDs, status IDs, and a same-ID replay; add the prefix-collision matrix to that suite or the focused B0 suite.
- **Duplicate disposition:** likely implemented with A3-003's order-identity migration, but exact matching/lookup remains a separate regression.

### HARD-A3-006 — customer records and order history cross store boundaries

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G4, store-scoped data ownership.
- **Fixture:** F1. Create Store B customer `same@example.com`, one completed Store B order, and no Store A customer with that email; manager has Store A only.
- **Pre-fix reproduction:** as `managerA`, list/search customers for Store A and request Store B customer detail by ID; then create a Store A manual/API/catalogue order using `same@example.com`.
- **Before-fix assertions:** list/detail exposes Store B data or recent orders; Store A order updates Store B customer/counter and no Store A customer is created.
- **After-fix assertions:** Store A list excludes Store B; Store B detail returns not-found/forbidden; recent orders contain only accessible-store rows; order upsert creates/updates exactly one Store A customer while Store B values/counters remain byte-for-byte unchanged. Repeat by normalized email and phone.
- **Evidence:** accessible-store rows, customer IDs/store IDs and counters before/after, detail response, recent-order store IDs.
- **Reusable coverage:** `tests/integration/customers.test.ts` already builds two stores and callers. Its `organization-wide dedupe and shared visibility` and auto-create expectations currently encode behavior that must be challenged rather than reused as acceptance.
- **Duplicate disposition:** one likely root fix covers manual import, manual order, Bazaar API, and catalogue upserts; retain all entry-point parameterized cases under A3-006.

### HARD-A3-007 — purchase-order and supplier authorization is only enforced in navigation

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G4, route/procedure/store policy parity.
- **Fixture:** F1 with a Store B draft/submitted/approved PO and supplier.
- **Pre-fix reproduction:** call `purchaseOrders.list/listIds/getById` and `suppliers.list` as Staff and Cashier; as `managerA`, read and then cancel/submit/approve/receive or line-edit the Store B PO. Call `GET /api/purchase-orders/[id]/pdf` with a mocked Store-A-only authenticated token.
- **Before-fix assertions:** protected reads return data to Staff/Cashier; manager reads or mutates Store B; PDF returns `200 application/pdf`; a mutation changes Store B status/stock/on-order.
- **After-fix assertions:** Staff/Cashier receive `FORBIDDEN`; Store-A-only manager gets not-found/forbidden for every Store B identifier; PDF is 403/404; every Store B PO, line, stock snapshot, movement, and on-order value is unchanged.
- **Evidence:** role/procedure matrix, error codes, PDF status/content type, and Store B row/ledger snapshots.
- **Reusable coverage:** PO integration covers approve/receive RBAC only; tenancy covers cross-organization PO access; PDF unit coverage checks successful rendering but not role/store denial. None covers same-org cross-store access.
- **Duplicate disposition:** shares G4 infrastructure with A3-008 and Agent 4 route-policy defects, but the PO stock mutation and document confidentiality cases are separate.

### HARD-A3-008 — integration APIs and artifacts bypass route permissions

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G4, route/procedure/store policy parity.
- **Fixture:** F1 with minimal local rows for each integration. No export/sync/provider action is started.
- **Pre-fix reproduction:** parameterize Staff and Cashier callers over Bazaar Catalogue `listStores/getSettings/products`; M-Market/Bakai/O! `overview/settings/products/listIds/preflight/jobs/getJob`; Product Image Studio `overview/jobs/job`. As `managerA`, pass `storeB` to representative mapping/selection mutations. Call known-job artifact endpoints for M-Market error report, Bakai workbook/error report, O! error report, and Image Studio image with Staff/Cashier tokens.
- **Before-fix assertions:** at least one read/artifact per surface succeeds despite `manageIntegrations` being Admin/Manager; Store B mutation succeeds or returns Store B data to a Store-A-only manager.
- **After-fix assertions:** every matrix cell is denied for Staff/Cashier before service/provider work; every Store B identifier is denied for `managerA`; artifact endpoints return 403/404; Admin/authorized Manager positive controls still work; fetch/provider spies have zero calls for denied requests.
- **Evidence:** machine-readable matrix `{role,surface,procedure/status,providerCalls}`, artifact response headers, and unchanged Store B rows.
- **Reusable coverage:** marketplace integration suites seed realistic settings/products/jobs; `tests/unit/m-market-error-report-route.test.ts` supplies an artifact-route mock pattern; `m-market-manager-permissions-source.test.ts` is source-only and cannot confirm RBAC.
- **Duplicate disposition:** procedure fixes will likely share one integration-policy middleware with A3-007/A4 RBAC work. Keep one parameterized A3-008 issue rather than duplicating per marketplace unless runtime shows different causes.

### HARD-A3-009 — manual sales orders accept products not assigned to the order store

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G2, product/store eligibility at mutation boundary.
- **Fixture:** F1 + F2; set Store A `allowNegativeStock=true` only for the pre-fix completion probe. `productB` remains unassigned or has an inactive Store A assignment.
- **Pre-fix reproduction:** create a Store A draft with `productB` in initial lines and repeat through `salesOrders.addLine`; progress and complete the accepted order.
- **Before-fix assertions:** create/add succeeds; line references `productB`; completion creates a Store A `SALE` movement/snapshot for a product unavailable there, potentially `onHand=-1`.
- **After-fix assertions:** both initial-line and add-line paths reject inactive/unassigned product/variant before line creation; draft line count, snapshot, and movement count remain unchanged; active Store A product is a positive control.
- **Evidence:** StoreProduct assignment, mutation result/error, line rows, exact snapshot, and movement rows.
- **Reusable coverage:** store-isolation tests prove POS/product lookup filtering, and sales-order tests prove line/completion behavior, but no test bypasses the picker with an unassigned product ID.
- **Duplicate disposition:** overlaps Agent 2 product-assignment policy and A3-001 stock effects; not duplicate because server-side order-line eligibility is the required boundary.

### HARD-A3-010 — Bazaar API product cache has no mutation invalidation

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G3, commerce cache coherence.
- **Fixture:** F2 + F3. Warm one exact products query and retain its price, stock, archived state, and assignment.
- **Pre-fix reproduction:** through supported mutations, change Store A price, adjust stock, archive the product, and deactivate/remove its Store A assignment; after each isolated setup, repeat the exact GET within the TTL. Start memory-only, then repeat the approved cross-instance scenario with dedicated Redis.
- **Before-fix assertions:** repeated GET returns the pre-mutation price/stock or still returns the archived/unassigned product while the database shows committed new state.
- **After-fix assertions:** every committed mutation invalidates/versions all affected pages/search keys; the next GET reflects the new price/stock or excludes the product; failed/rolled-back mutations do not evict into a false state; process B observes the same result.
- **Evidence:** mutation audit ID, database state, before/after API bodies and timestamps, cache mode/key namespace (not secrets), and process identity.
- **Reusable coverage:** Bazaar API integration already asserts rich price/stock payloads; inventory/product/store-price suites provide supported mutation fixtures. No test combines them with a warmed API cache.
- **Duplicate disposition:** likely shares one product-change invalidation event with A3-022 and Agent 2 mutation services, but API cache keys/TTL and public catalogue keys/TTL require separate acceptance tests.

### HARD-A3-011 — advertised return mode creates an ordinary sale

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G2, mismatched UI/domain state machine.
- **Fixture:** F2 plus a completed original sale for one unit and an authenticated operator. Starting stock 10 becomes 9 after the original sale. Browser starts at `/sales/orders/new?mode=return`.
- **Pre-fix reproduction:** create the displayed return document, capture the tRPC mutation/payload, then complete it through the ordinary sales-order detail flow.
- **Before-fix assertions:** browser calls `salesOrders.createDraft` with no return/original-sale identity; resulting row is an ordinary customer order; completion changes stock from 9 to 8, creates a second `SALE`, and creates no refund/return relation.
- **After-fix assertions:** the return-labelled entry can never call ordinary sale creation. If the approved product decision routes to Agent 1's return flow, it requires the original sale/line, caps returnable quantity, creates a return/refund record, and changes stock from 9 back to 10 exactly once. If the feature is withdrawn, the return entry is absent/disabled and direct URL cannot create a sale. In both cases no return-labelled path creates `SALE` stock impact.
- **Evidence:** browser trace/screenshot, intercepted mutation payload, document type/source, original-sale relation, stock and money movements.
- **Reusable coverage:** sales-order tests cover ordinary completion; POS integration has real returns/stock behavior. There is no browser test for this query mode.
- **Duplicate disposition:** ownership overlaps Agent 1 returns, especially HARD-A1-005, but the defects are not duplicates: A3-011 is a false entry/domain path; A1-005 is return-quantity concurrency.

### HARD-A3-012 — bulk PO cancellation can irreversibly partially succeed

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G5, multi-document transaction/reconciliation.
- **Fixture:** F1 with two submitted POs, each quantity 5 and corresponding on-order state. Make PO B non-cancelable after selection but before submission, or inject a deterministic failure for the second item.
- **Pre-fix reproduction:** start the same two cancellation promises used by the page and observe the page's `Promise.all` rejection; then await `Promise.allSettled` in the harness so the surviving mutation finishes before both documents are reloaded.
- **Before-fix assertions:** overall action rejects/generic error, PO A is permanently canceled with on-order reversed, and PO B remains submitted/approved; no durable batch result tells the client which item committed.
- **After-fix assertions:** adopt one explicit server contract before implementation. Preferred release assertion is atomic: one invalid member rejects the batch and both POs/on-order values remain unchanged; a valid batch cancels both once under one operation key. If product instead approves partial outcomes, the response must durably enumerate every success/failure and replay exactly without repeating reversals; the UI must display/reconcile that matrix.
- **Evidence:** operation ID, per-PO status and on-order before/after, response payload, audit entries, and browser error/result state.
- **Reusable coverage:** PO tests cover single receiving and state transitions; no bulk cancel service/test exists. Existing page implementation supplies the exact client orchestration to reproduce.
- **Duplicate disposition:** resembles Agent 2's chunked bulk stock partial-commit issue, but affects different documents/effects. Share a batch contract pattern, not an issue ID.

### HARD-A3-021 — public catalogue checkout can create duplicate confirmed orders

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G1, public operation identity and abuse control.
- **Fixture:** F4 + F5. Use one valid body and mocked confirmation-email/event publishers.
- **Pre-fix reproduction:** call the checkout route twice sequentially and with `Promise.all` concurrently, using the same customer/cart and modeling an ambiguous first response.
- **Before-fix assertions:** two distinct `CONFIRMED/CATALOG` orders and numbers exist; customer `orderCount` increments twice; email/event spies are called twice. Separately verify the absence of an application rate-limit response under a bounded rapid burst.
- **After-fix assertions:** client creates and persists an operation key before the first attempt; same-key retries return one order ID/number and one customer/email/event effect; changed-payload key reuse conflicts; bounded abusive new-key requests reach a documented 429 policy without provider calls. A browser test aborts the first response after commit, retries, and sees one success/order.
- **Evidence:** response pairs, order/customer counts, side-effect spy counts, rate-limit headers/status, and browser trace.
- **Reusable coverage:** catalogue integration covers one happy-path checkout; existing Playwright covers a visitor submission but is environment-skipped and omits the currently required email field, so it needs repair before reuse.
- **Duplicate disposition:** likely shares the operation-key primitive with A3-003/A3-004, but public rate limiting, client key persistence, and email/event effects remain distinct.

### HARD-A3-022 — public catalogue can show one price and order another

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G3, public cache coherence/price acceptance.
- **Fixture:** F4. Publish price 95, fetch and retain the displayed payload, then change price to 120 through `storePrices.upsert` or another supported manager mutation.
- **Pre-fix reproduction:** repeat the public GET inside 60 seconds, then submit checkout using the cart built from the retained payload.
- **Before-fix assertions:** repeated GET/cart still says 95 while the created order line and total use 120; analogous parameterized cases keep renamed/archived/unassigned/image-changed product state stale.
- **After-fix assertions:** supported mutations make the next public GET coherent across memory/Redis; checkout either uses the exact accepted price/version or returns a documented price-change conflict containing the replacement total and creates no order until reconfirmed. It must never silently create at a different price.
- **Evidence:** public payload before/after, mutation audit ID, checkout status/body, order line/total, cache mode, and browser screenshot of any reconfirmation state.
- **Reusable coverage:** catalogue tests cover payload and checkout separately; store-price tests cover mutation; no test warms then mutates then checks out.
- **Duplicate disposition:** likely one invalidation event implementation with A3-010, but the customer-visible price acceptance rule is unique and must remain a separate P0.

### HARD-A3-026 — public catalogue image proxy permits arbitrary server-side requests

- **Runtime state:** `BLOCKED_BY_ENVIRONMENT`; not confirmed.
- **Provisional root-cause group:** G6, SSRF/origin validation.
- **Fixture:** F5 only; no DB. Mock global `fetch` to record inputs and return `Response("internal-secret", {status:200, headers:{"content-type":"text/plain"}})`.
- **Pre-fix reproduction:** call the route with encoded `url=http://127.0.0.1/uploads/imported-products/probe&w=120`. Parameterize `localhost`, IPv6 loopback, RFC1918, link-local, an unapproved public origin with a managed-looking path, and a redirect to a blocked address.
- **Before-fix assertions:** for the primary loopback case the fetch spy is called with the attacker-controlled URL and the route returns the synthetic internal bytes/status 200.
- **After-fix assertions:** every unapproved/private/loopback/link-local/DNS-rebinding/blocked-redirect case is rejected before fetch (`fetch` call count zero for literal blocked origins); only exact configured application/storage origins and managed paths pass; response MIME and byte limits are enforced; redirects are revalidated hop by hop.
- **Evidence:** parameterized status/body/MIME table and sanitized fetch-spy calls. No real socket or DNS query is permitted in this test.
- **Reusable coverage:** `catalog-image-transform.test.ts` covers image transformation only; `productImageStorage.ts` has safe downloader helpers that inform the expected matrix, but the public proxy has no security runtime test.
- **Duplicate disposition:** no likely duplicate in the current Agent 3 ledger. Product image/storage ownership overlaps Agent 2, so shared-helper changes require coordination rather than issue merging.

## Provisional root-cause groups and likely duplicates

These groups are hypotheses to organize execution and implementation batches. They are not confirmed until the relevant runtime cases reproduce.

| Group | Provisional common cause | Findings | Duplicate/merge guidance |
| --- | --- | --- | --- |
| G1 | Missing durable operation/external identity | A3-003, A3-004, A3-005, A3-021 | Likely shared schema/idempotency primitive. Keep four acceptance IDs because API, internal documents, exact external lookup, and public abuse/side effects differ. |
| G2 | Stock impact or product eligibility not owned by one explicit state transition | A3-001, A3-009, A3-011 | Shared stock invariants and Agent 1/2 coordination; not duplicates. |
| G3 | TTL cache correctness depends on expiry instead of mutation invalidation/versioning | A3-002, A3-010, A3-022 | A3-010/A3-022 likely share product-change fan-out. A3-002 uses the same infrastructure but is a separate credential-security boundary. |
| G4 | Navigation role policy is not mirrored at tRPC/HTTP/service store boundaries | A3-006, A3-007, A3-008 | Likely shared policy helpers with Agent 4. Keep customer, PO/supplier, and integrations cases separate because data/effects differ. |
| G5 | Multi-item destructive operation lacks an atomic or reconcilable server contract | A3-012 | Similar pattern to Agent 2 bulk stock findings; not the same records or rollback behavior. |
| G6 | Path allowlisting is mistaken for origin/network allowlisting | A3-026 | Standalone security issue; reuse a reviewed storage fetch helper only after Agent 2 coordination. |

Cross-agent overlap requiring ownership coordination, not silent deduplication:

- A3-001, A3-009, A3-010, and A3-022 touch Agent 2 stock/product/price/assignment mutation boundaries.
- A3-011 must be resolved with Agent 1's real return/refund domain and independently verified by Agent 4.
- A3-004's idempotency framework resembles Agent 2 product replay issues and Agent 1 replay/event issues, but each mutation retains its own acceptance test.
- A3-007 and A3-008 should align with Agent 4's global RBAC release matrix; Agent 3 owns the domain procedures and artifacts.
- A3-026 may reuse `productImageStorage` safety logic, a shared image surface that must be reserved before implementation.

## Existing runtime coverage available for reuse

| Existing test | Useful fixture/assertion | Gap relative to the P0 plan |
| --- | --- | --- |
| `tests/helpers/db.ts` | Base org/store/users/product/supplier and stock-safe seed patterns | Current whole-schema truncate is unsafe until the B0 guard/identity is installed. |
| `tests/helpers/context.ts` | Direct authenticated tRPC callers by role | Caller does not itself create store-access permutations; F1 must do so explicitly. |
| `tests/integration/bazaar-api.test.ts` | Product payload, route Request construction, API key, stock deduction/cancel, external-ID replay, tenant isolation | No API-to-completion lifecycle, warm revoke, missing-key replay, substring collision, or warmed product mutation test. |
| `tests/unit/bazaar-api-stock-source.test.ts` | Identifies intended stock wiring | Source-string only; cannot confirm money/stock/idempotency. |
| `tests/integration/sales-orders.test.ts` | Draft lines, completion ledger, completion idempotency, role checks | No create idempotency, unassigned-product bypass, API-created completion, or return-mode browser behavior. |
| `tests/integration/purchase-orders.test.ts` | PO seed, receive idempotency, transition checks, approve/receive role check | No ordinary create replay, same-org cross-store matrix, PDF denial, or bulk cancel partial failure. |
| `tests/integration/customers.test.ts` | Two-store customer/caller fixtures, import, order-driven upsert | Several current expectations encode organization-wide matching/shared behavior and cannot be treated as desired acceptance. |
| `tests/integration/tenancy.test.ts` | Cross-organization negative controls | Same-organization Store A/Store B authorization remains untested. |
| `tests/integration/store-isolation.test.ts` | Store product assignment and limited-user patterns | Does not bypass sales-order picker or exercise commerce integration procedures. |
| `tests/integration/manager-permissions.test.ts` | Manager operational caller/setup | Positive coverage; does not prove denial for inaccessible Store B commerce records. |
| `tests/integration/bazaar-catalog.test.ts` | Publish, public payload, checkout, variants, hidden products, tenant isolation | No retry/concurrency/rate limit/email count or warm-cache price mutation. |
| `tests/e2e/bazaar-catalog.playwright.mjs` | Public checkout and admin order discovery flow shape | Runner is not fully checked in; test is env-skipped and omits required customer email. |
| `tests/unit/purchase-order-pdf-route.test.ts` | Mocked PDF route and content assertions | No role/store-access denial. |
| `tests/unit/m-market-error-report-route.test.ts` | Mocked artifact-route authentication/data pattern | Tests organization access, not `manageIntegrations` role or same-org store access. |
| `tests/unit/catalog-image-transform.test.ts` | Synthetic image buffers/transformation | No source-origin, DNS/IP/redirect, MIME, or size boundary. |
| Marketplace integration suites | Realistic local integration/product/job rows and mock modes | No parameterized Staff/Cashier denial or Store-A-manager/Store-B mutation matrix. |

## Evidence and exit criteria

Each runtime verification must preserve machine-readable evidence under `docs/hardening/evidence/agent-3/` or another tracked hardening path approved by Agent 4; ignored `tmp/` is not the only evidence location. Secrets, raw API keys, credentials, and provider payloads must be redacted.

Minimum evidence per issue:

1. Baseline and implementation commit SHA.
2. Exact command, approved database identity, cache/provider mode, and exit code.
3. Fixture IDs sufficient to query the isolated database, without secrets.
4. Before-fix assertion output or a `NOT_REPRODUCED` report.
5. After-fix focused test output.
6. Counts and before/after rows for stock, money, order, customer, audit, and side effects as applicable.
7. Browser trace/screenshot and console/network error report for UI-dependent cases.
8. Independent Agent 4 result.

No P0 may move directly from this document to closed. It must progress from `BLOCKED_BY_ENVIRONMENT` to `REPRODUCED`, then to `FIX_VERIFIED`, with Agent 4 independently validating the same acceptance invariant.
