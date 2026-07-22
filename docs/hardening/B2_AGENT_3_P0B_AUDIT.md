# B2 Agent 3 P0-B audit and reproduction

## Outcome and stop condition

- Audit baseline: `d9b2229eb117bab9507717752364db3a202fa228` on `hardening/b2-agent-3-commerce`.
- Worktree: `/private/tmp/bazaar-b2-agent-3-commerce`.
- Scope: `HARD-A3-001`, `HARD-A3-003`, `HARD-A3-004`, `HARD-A3-005`, `HARD-A3-010`, `HARD-A3-012`, `HARD-A3-021`, and `HARD-A3-022`.
- Result: all eight P0-B issues reproduced at the B2 baseline. The two `HARD-A3-004` surfaces give nine passing focused cases in total.
- Classification: B2-A stock/status transition ownership, B2-B durable/reconcilable command identity, and B2-C commerce cache/quote coherence.
- No application, shared, schema, migration, package, or provider configuration file was changed during this audit.
- **Implementation stop:** the existing schema cannot represent the durable, payload-bound operation identity required by B2-B for user, API-key, and anonymous catalogue principals, and it cannot store an exact constrained Bazaar external order identity. Per the B2 instruction, no workaround or migration has been implemented. An additive migration is proposed below for approval and serialized authorship.

This document records pre-fix evidence and an implementation handoff. It does not mark any issue fixed.

## Isolation and focused reproduction

| Control            | B2 evidence                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database           | Local PostgreSQL database `bazaar_hardening_agent3_commerce`; all 87 checked-in migrations applied; no pending migration.                                                                                  |
| Reset guard        | `NODE_ENV=test`, `RUN_DB_TESTS=1`, `ALLOW_TEST_DB_RESET=1`, and `EXPECTED_TEST_DB_NAME=bazaar_hardening_agent3_commerce` were explicit. `DATABASE_TEST_URL` exactly named that local allowlisted database. |
| Redis              | Dedicated local database 13 and prefix `bazaar:hardening:agent3:b2`; no flush or shared-key deletion.                                                                                                      |
| Email              | Confirmation-email function mocked and call-counted in catalogue cases.                                                                                                                                    |
| External providers | No live email, marketplace, or AI provider was invoked.                                                                                                                                                    |
| Schema safety      | No `db push`; no schema or migration write.                                                                                                                                                                |

Focused command, using the ignored hardening environment symlink:

```bash
set -a; source .env.hardening; set +a; pnpm exec vitest run \
  tests/integration/b0-agent-3-orders-p0.test.ts \
  tests/integration/b0-agent-3-access-cache-p0.test.ts \
  tests/integration/b0-agent-3-catalog-p0.test.ts \
  -t 'HARD-A3-(001|003|004|005|010|012|021|022)' \
  --reporter=verbose
```

Result: 3 test files passed, 9 focused tests passed, 7 unrelated cases skipped, 0 failed, in approximately 6.5 seconds.

## Defect reproduction and B2 root classification

| ID            | Severity | B2 root | Reproduced database/API/provider-mock evidence                                                                                                                                                                                  | Confirmed root                                                                                                                                                                                              |
| ------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HARD-A3-001` | P0       | B2-A    | API create changed stock `10 -> 9`; ordinary completion changed it `9 -> 8`; the same order had two `SALE -1` movements.                                                                                                        | API creation and generic completion independently own the decrement for one order.                                                                                                                          |
| `HARD-A3-003` | P0       | B2-B    | Four equivalent API creates without `externalId`—two sequential and two concurrent—returned four distinct order IDs and changed stock `10 -> 6`.                                                                                | The route accepts neither a required external identity nor a durable request identity. Each request is an independent transaction.                                                                          |
| `HARD-A3-004` | P0       | B2-B    | Two equivalent internal sales creates returned two `DRAFT` IDs. Two equivalent submitted PO creates returned two PO IDs and changed `onOrder` to 10 for one intended quantity of 5.                                             | Standard sales and PO create contracts have no operation key or replay result. Per-call transactions prevent partial documents but do not prevent duplicate documents/effects.                              |
| `HARD-A3-005` | P0       | B2-B    | After creating `EXT-10`, create/get/list for exact input `EXT-1` resolved the `EXT-10` order; only one order row existed.                                                                                                       | External identity is embedded in `notes` and queried with substring `contains`; the exact advisory lock does not repair the inexact database predicate.                                                     |
| `HARD-A3-010` | P0       | B2-C    | A warmed API response still returned price 100 and stock 10 after committed values became 200 and 7. Both process memory and dedicated Redis participated.                                                                      | The hashed product-list cache key contains query inputs but no mutation version, and product/price/stock writes do not invalidate its entries. Default TTL is 30 minutes.                                   |
| `HARD-A3-012` | P0       | B2-B    | Two cancellation promises settled `[fulfilled, rejected]`; statuses changed `[SUBMITTED, APPROVED] -> [CANCELLED, APPROVED]`; aggregate `onOrder` changed `10 -> 5`.                                                            | Each cancel is atomic, but the destructive batch is client-side `Promise.all` over separate commits with a stale precheck and no server batch transaction, operation identity, or per-item recovery record. |
| `HARD-A3-021` | P0       | B2-B    | Reusing the same ignored `Idempotency-Key` returned 200 twice with two confirmed order IDs, two rows, customer `orderCount=2`, two created-event calls, and two mocked confirmation-email calls. Live-provider calls were zero. | The public route ignores the header and the checkout transaction has no operation identity. Events and email dispatch occur once after each duplicate commit.                                               |
| `HARD-A3-022` | P0       | B2-C    | The warmed catalogue displayed 100 after the committed price became 120; checkout persisted 120. One mocked email call and zero live-provider calls occurred.                                                                   | The public catalogue is cached for 60 seconds without price-write invalidation, while checkout correctly re-reads current prices but receives no displayed quote/version to validate or reconfirm.          |

### B2 root batches

| Batch                                            | Invariant                                                                                                                                                                                                                   | Issues                                    | Implementation dependency                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2-A — stock/status transition ownership         | One logical order line causes at most one sale stock effect, and cancellation reverses exactly the applied effect.                                                                                                          | `HARD-A3-001`                             | Agent 3 author; Agent 2 reviews the inventory invariant. No shared inventory helper edit is currently required.                                                      |
| B2-B — durable and reconcilable command identity | Every destructive create/batch command has a scoped principal, durable key, request fingerprint, atomic outcome, replay response, and no duplicate post-commit side effect. External identities are exact constrained data. | `HARD-A3-003`, `004`, `005`, `012`, `021` | **Blocked pending approval of the additive migration proposed below.** Prisma authorship must be serialized by Agent 4.                                              |
| B2-C — commerce cache and quote coherence        | A committed product/price/stock/visibility change cannot be followed by a successful stale commerce read; checkout either honors the displayed quote or explicitly rejects/reconfirms it.                                   | `HARD-A3-010`, `022`                      | Agent 3 owns commerce read/cache behavior; Agent 2 must author or review mutation-side invalidation hooks. Agent 4 coordinates shared cache/runtime files if needed. |

## Actual order status and stock-impact state machine

### Customer/Bazaar orders

The persisted internal state enum is `DRAFT`, `CONFIRMED`, `READY`, `COMPLETED`, `CANCELED`. Bazaar API responses expose the following complete mapping:

| Internal status | Bazaar API status  | Allowed next internal states | Current stock effect                                                                                                                                                                        |
| --------------- | ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRAFT`         | `NEW`              | `CONFIRMED`, `CANCELED`      | None. Manual internal creation begins here.                                                                                                                                                 |
| `CONFIRMED`     | `CONFIRMED`        | `READY`, `CANCELED`          | Source-dependent: API creation has already applied `SALE -qty`; catalogue confirmation and manually confirmed orders have not.                                                              |
| `READY`         | `READY_FOR_PICKUP` | `COMPLETED`, `CANCELED`      | No transition-local effect. It inherits the source-dependent effect from `CONFIRMED`.                                                                                                       |
| `COMPLETED`     | `COMPLETED`        | Terminal                     | Generic completion applies `SALE -qty` for every line, even when API creation already applied it. This is the `HARD-A3-001` double decrement.                                               |
| `CANCELED`      | `CANCELLED`        | Terminal                     | Cancellation finds all negative `SALE` movements for the order and mirrors them as positive `RETURN` movements, unless any prior `RETURN` exists. Completed orders cannot enter this state. |

Current source/effect sequence:

| Source    | Create state/effect          | Ready effect | Completion effect    | Cancellation before completion                                            |
| --------- | ---------------------------- | ------------ | -------------------- | ------------------------------------------------------------------------- |
| `MANUAL`  | `DRAFT`, no stock effect     | None         | `SALE -qty`          | No stock effect unless a sale movement already exists.                    |
| `CATALOG` | `CONFIRMED`, no stock effect | None         | `SALE -qty`          | No stock effect before completion.                                        |
| `API`     | `CONFIRMED`, `SALE -qty`     | None         | A second `SALE -qty` | From `CONFIRMED` or `READY`, mirrors the recorded API sale movement once. |

The minimal compatibility-safe B2-A design should declare a source-aware owner rather than changing history implicitly: API confirmation keeps ownership of its already-established decrement, while generic completion must recognize that applied effect and not apply it again; manual/catalogue completion remains the owner for those sources. Acceptance must cover every source through create, ready, complete, cancel, replay, and concurrent completion, with exact movement cardinality. If the product decision instead moves all stock effects to `COMPLETED`, existing confirmed API orders require an explicit data transition plan before code rollout.

### Purchase orders

The persisted PO state machine is:

| Status               | Allowed next states              | Current stock/on-order effect                                                                       |
| -------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DRAFT`              | `SUBMITTED`, `CANCELLED`         | Standard draft create has no `onOrder` effect; draft cancellation has none.                         |
| `SUBMITTED`          | `APPROVED`, `CANCELLED`          | Submission increases `onOrder` by ordered quantity; cancellation decreases it by the same quantity. |
| `APPROVED`           | `PARTIALLY_RECEIVED`, `RECEIVED` | Cancellation is invalid. Receiving owns the later on-order/on-hand transition.                      |
| `PARTIALLY_RECEIVED` | `RECEIVED`                       | Cancellation is invalid.                                                                            |
| `RECEIVED`           | Terminal                         | Receipt transition completed.                                                                       |
| `CANCELLED`          | Terminal                         | Submitted-order `onOrder` has been reversed.                                                        |

`cancelPurchaseOrder` is transactionally sound for one PO. `/purchase-orders` first fetches IDs currently in `DRAFT`/`SUBMITTED`, pauses for confirmation, and then calls the single-item cancel mutation under `Promise.all`. A state change, conflict, network failure, or any later item error after one earlier commit leaves an irreversible partial batch. The proposed server batch must lock and validate the complete selected set before applying any effect, or expose a durable explicitly reconcilable per-item outcome; for this destructive P0 the preferred initial contract is all-or-nothing.

## Transaction and idempotency boundaries

| Issue/path                           | Current atomic boundary                                                                                                  | Current identity/replay boundary                                                                                                                                           | Post-commit side effects                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| API order create (`A3-001/003/005`)  | One Prisma transaction contains order, lines, API stock deduction, and customer upsert.                                  | Only an optional external ID: exact advisory lock, but notes-substring lookup. No identity when absent.                                                                    | Created event and asynchronous confirmation email only when service says not replayed. |
| Internal sales create (`A3-004`)     | One Prisma transaction contains number, order/lines, customer upsert, and audit.                                         | None.                                                                                                                                                                      | Created event after commit.                                                            |
| Standard PO create (`A3-004`)        | One Prisma transaction contains PO/lines, submitted `onOrder` adjustment, and audit.                                     | None. `createFromReorder` has separate idempotency, but standard create does not.                                                                                          | First-event record, PO event, inventory events, and logging after commit.              |
| Ordinary sales completion (`A3-001`) | One Prisma transaction row-locks the order, applies stock, updates status/event ID, and audits.                          | `withIdempotency(key, "salesOrders.complete", actorUserId)` plus unique `completedEventId`; this protects the completion call, not creation or an API-create stock effect. | Inventory events and logging after commit.                                             |
| PO bulk cancel (`A3-012`)            | One independent transaction per PO.                                                                                      | None for either the item call or the client-composed batch.                                                                                                                | PO/inventory events after each successful item commit.                                 |
| Public checkout (`A3-021/022`)       | One Prisma transaction re-reads product/variant/current price/cost, creates confirmed order/lines, and upserts customer. | None; route ignores `Idempotency-Key`.                                                                                                                                     | Created event and asynchronous mocked confirmation email after each commit.            |
| Bazaar product list (`A3-010`)       | Cache read precedes independent database reads; completed result is cached.                                              | Hashed key is only org/store/search/page/pageSize; no data version.                                                                                                        | Memory and Redis entry live for up to 30 minutes by default.                           |
| Public catalogue (`A3-022`)          | Cache read precedes independent database reads; completed payload is cached.                                             | Redis key is slug only; no product/price version.                                                                                                                          | Entry lives for 60 seconds. Checkout does not consume a quote/version from it.         |

## Why the existing schema is insufficient

1. `CustomerOrder` has no external-order field and no exact scoped external-identity unique constraint. `notes` cannot safely serve as identity. `completedEventId` is unique but represents a completion transition, not a create command.
2. `PurchaseOrder.receivedEventId` represents receipt, not standard creation. There is no create-operation identity.
3. `IdempotencyKey` requires a real `User` through `userId`, so it cannot represent an API-key principal or anonymous public-catalogue principal without misattribution.
4. Its only uniqueness is `(key, route, userId)`. It has no organization, store/catalogue, principal type, request fingerprint, lifecycle status, resource identity, or expiry field.
5. `responseHash` is a hash of the stored response, not the request. Reusing one key with a different payload cannot be rejected safely.
6. Although the existing table can replay some logged-in user transitions, extending that partial contract only for internal sales/PO creation would leave API and public P0 paths unsolved and would not meet the same-key/different-payload invariant.

Therefore a schema-free implementation is not acceptable for B2-B.

## Proposed additive migration — approval required, not authored

### Exact proposed Prisma contract

Final naming remains subject to Agent 4's serialized schema review, but this audit proposes the following concrete additive contract rather than overloading `IdempotencyKey`:

```prisma
enum OperationRequestStatus {
  PROCESSING
  COMPLETED
  FAILED
}

model OperationRequest {
  id             String                 @id @default(cuid())
  organizationId String
  storeId        String?
  scope          String                 @db.VarChar(120)
  principalKey   String                 @db.VarChar(220)
  key            String                 @db.VarChar(256)
  requestHash    String                 @db.Char(64)
  status         OperationRequestStatus @default(PROCESSING)
  response       Json?
  resourceType   String?                @db.VarChar(80)
  resourceId     String?                @db.VarChar(191)
  errorCode      String?                @db.VarChar(120)
  expiresAt      DateTime?
  createdAt      DateTime               @default(now())
  updatedAt      DateTime               @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  store        Store?       @relation(fields: [storeId], references: [id])

  @@unique([organizationId, scope, principalKey, key], map: "OperationRequest_scope_principal_key_uq")
  @@index([organizationId, status, createdAt], map: "OperationRequest_org_status_created_idx")
  @@index([expiresAt], map: "OperationRequest_expires_idx")
  @@index([resourceType, resourceId], map: "OperationRequest_resource_idx")
}
```

Add the inverse relation fields to `Organization` and `Store`. Keep the existing `IdempotencyKey` model unchanged initially so Agent 1 POS, Agent 2 inventory, bundle assembly, sales completion, and PO receipt consumers retain their current contract until deliberately migrated and regression-tested.

Add this exact field to `CustomerOrder`:

```prisma
externalOrderId String? @db.VarChar(160)

@@unique(
  [organizationId, storeId, source, externalOrderId],
  map: "CustomerOrder_org_store_source_external_uq"
)
```

PostgreSQL permits multiple rows with null `externalOrderId` under this composite unique constraint. Bazaar API values retain the current normalization contract—trim leading/trailing whitespace and collapse internal whitespace, but remain case-sensitive—unless a separately reviewed API contract intentionally changes it.

Principal keys are non-null and type-prefixed so nullable composite uniqueness cannot weaken isolation:

- authenticated internal caller: `user:<User.id>`;
- Bazaar API caller: `api-key:<BazaarApiKey.id>`;
- anonymous catalogue checkout: `catalog:<BazaarCatalog.id>`.

Scopes are stable command names such as `bazaarApi.orders.create`, `salesOrders.createDraft`, `purchaseOrders.create`, `purchaseOrders.bulkCancel`, and `bazaarCatalog.checkout`. The request hash is lowercase SHA-256 hex over a versioned canonical payload after server normalization; it must include every field that changes the domain result and must not include transport-only values. A repeated scoped key with a different hash returns conflict before any domain, audit, customer, stock, event, or provider effect.

The operation row, document/effects, audit write, and stored replay outcome commit in one database transaction. `COMPLETED` is the only replayable successful outcome. `PROCESSING` supports deterministic conflict/recovery behavior if the implementation later needs a committed lease; a synchronous transaction rollback must not leave a processing row. `FAILED` stores only a stable application error code, never raw database/provider details. Retention should default to at least 30 days and must not remove exact `externalOrderId`, which is permanent order identity.

### Staged backfill and collision policy

Use two serialized additive migrations/deploy steps to avoid a mixed-version write gap:

1. **Foundation migration:** add `OperationRequest`, enum, relations/indexes, and nullable `CustomerOrder.externalOrderId` with a non-unique lookup index. Do not add the external unique constraint yet.
2. Deploy compatibility code that dual-writes the exact field and the legacy notes marker, reads the exact field first, and falls back only to an **exact parsed marker line** in notes. Substring `contains` is removed. The advisory lock remains during the transition.
3. Run a checked-in backfill against `source=API` orders. Accept only a full trimmed line matching `Bazaar API externalId: <non-empty value>`; apply the same trim/collapse-whitespace normalization as the API. Zero markers means null. Multiple distinct marker values on one order is an ambiguity.
4. Generate a durable collision report grouped by `(organizationId, storeId, source, normalizedExternalOrderId)`. Any group with more than one order, any over-160-character normalized value, or any per-order ambiguity aborts the constraint migration. Do not choose oldest/newest, merge orders, or rewrite identity automatically.
5. Resolve every reported collision through an explicitly approved data-repair plan with before/after order IDs and audit evidence. Re-run backfill in an idempotent manner to capture orders created during the mixed-version window.
6. **Constraint migration:** verify zero duplicate/ambiguous candidates inside the migration, set the composite unique constraint shown above, and retain a supporting exact lookup index if the unique index does not match all query plans.
7. Deploy exact-field-only identity lookup after Preview/production verification. Preserve the legacy notes text for history; stop using it as identity. Dual-write may be removed in a later cleanup release.

This policy makes `EXT-1` and `EXT-10` distinct, while an actual duplicate `EXT-1` in the same org/store/source is a blocking collision. Cross-store reuse remains allowed by the proposed constraint; changing that business contract requires a separate decision before migration approval.

### Compatibility and rollback

- Migration order is expand -> dual-read/write -> backfill/collision gate -> constrain -> exact-read-only. New code must not be deployed before the foundation migration, and the constraint must not precede the second gap-closing backfill.
- API response fields remain compatible: `externalOrderId` is populated from the new field and public/internal status strings do not change.
- Existing `IdempotencyKey` rows and consumers remain untouched. The new helper should live beside the old helper, not reinterpret old keys or hashes.
- A code rollback during the compatibility window returns to notes-capable behavior because dual-write preserves the marker. Do not drop the new columns/table or delete operation rows during an incident rollback.
- After exact-only writes begin, rollback to code that writes notes only is safe for data preservation but reopens the P0; therefore roll back the application and disable affected create endpoints, or redeploy the last dual-write build, rather than silently accepting unsafe creates.
- Schema rollback, if ever required after the retention window, must first prove no deployed writer/reader depends on the fields, export operation records for audit, remove the unique constraint/indexes, and only then drop additive objects in a separately approved migration. It is not the production incident rollback path.

No migration directory, SQL, Prisma model, generated client, backfill script, or application compatibility code was created in this audit.

## Exact likely files and requested shared-file claims

### Domain files (Agent 3)

| Batch/issues           | Exact files                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2-A / `A3-001`        | `src/server/services/bazaarApi.ts`, `src/server/services/salesOrders.ts`, `tests/integration/b0-agent-3-orders-p0.test.ts`; add focused post-fix state-machine tests rather than replace the retained pre-fix evidence.             |
| B2-B / `A3-003/005`    | `src/app/api/bazaar/v1/orders/route.ts`, `src/app/api/bazaar/v1/orders/[id]/route.ts`, `src/server/services/bazaarApi.ts`, Bazaar API integration tests.                                                                            |
| B2-B / sales `A3-004`  | `src/server/trpc/routers/salesOrders.ts`, `src/server/services/salesOrders.ts`, `src/app/(app)/sales/orders/new/page.tsx`, focused integration/browser tests.                                                                       |
| B2-B / PO `A3-004/012` | `src/server/trpc/routers/purchaseOrders.ts`, `src/server/services/purchaseOrders.ts`, `src/app/(app)/purchase-orders/new/page.tsx`, `src/app/(app)/purchase-orders/page.tsx`, focused integration/browser tests.                    |
| B2-B / `A3-021`        | `src/app/api/public/catalog/[slug]/checkout/route.ts`, `src/server/services/bazaarCatalog.ts`, `src/app/c/[slug]/page.tsx`, `tests/integration/b0-agent-3-catalog-p0.test.ts`, focused browser tests.                               |
| B2-C / `A3-010/022`    | `src/server/services/bazaarApi.ts`, `src/server/services/bazaarCatalog.ts`, `tests/integration/b0-agent-3-access-cache-p0.test.ts`, `tests/integration/b0-agent-3-catalog-p0.test.ts`; add multi-process cache acceptance coverage. |

### Shared/other-owner claims requested before implementation

| Requested claim                                                                             | Proposed author/coordinator                                                                | Reason and boundary                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma` and the staged checked-in migrations under `prisma/migrations/**`    | Agent 4 serializes; Agent 3 authors domain semantics; Agents 1/2 plus Agent 4 review       | Required operation identity and exact external identity. No implementation may start on B2-B until approved and claimed.                                                                                                |
| New `src/server/services/operationRequests.ts`                                              | Agent 3 authors, coordinated by Agent 4; Agents 1 and 2 mandatory reviewers                | Add a payload-bound operation API without changing `src/server/services/idempotency.ts` or its POS/inventory consumers. This becomes shared infrastructure and requires cross-domain concurrency/replay review.         |
| `src/server/jobs/index.ts`                                                                  | Agent 4 authors/coordinates; Agent 3 reviews operation-retention semantics                 | Extend the existing idempotency cleanup job, or register a separately observable cleanup, for expired operation records only after the retention policy is approved. Exact external order identity is never cleaned up. |
| `src/server/services/inventory.ts`                                                          | Agent 2 if mutation-side cache hook is required; Agent 3 supplies cache contract and tests | Agent 3 should not edit inventory transitions. B2-A is expected to be solved in order services. B2-C needs post-commit stock invalidation/versioning from all inventory mutations.                                      |
| `src/server/services/storePrices.ts` and `src/server/services/products.ts`                  | Agent 2 authors; Agent 3 reviews commerce invalidation coverage                            | Price, archive, visibility, variant, and store-assignment writes must invalidate/version Bazaar API/public catalogue reads after commit.                                                                                |
| `src/server/services/stores.ts`                                                             | Agent 2/4 coordinator if store clone/currency mutations participate                        | Store cloning can write snapshots/prices/assignments; store currency changes also affect exposed prices. Include only after route-impact review.                                                                        |
| `src/server/services/storeAccess.ts`                                                        | Agent 4 only if a shared assignment helper must expose a post-commit invalidation seam     | It is a shared RBAC/store helper. Do not import commerce caches into transaction helpers without coordinated design.                                                                                                    |
| `src/server/redis.ts`, `src/server/events/eventBus.ts`, or shared cache/query configuration | Agent 4; Agent 3 defines acceptance; Agent 2 reviews mutation fan-out                      | Claim only if route-local store-version/invalidation cannot be implemented without shared runtime changes. B1 Preview Redis isolation must remain intact.                                                               |
| Translation catalogs                                                                        | Agent 4 serializes; Agent 3 supplies copy                                                  | Needed for idempotency conflict, quote-changed, and atomic bulk-cancel errors; claim later with `pnpm i18n:check`.                                                                                                      |

`docs/hardening/SHARED_FILE_OWNERSHIP.md` was read but not edited in this audit step. These are requested claims, not active claims.

## Proposed implementation sequence after migration approval

1. **B2-A:** codify the source/status stock-effect table, prevent API completion from applying a second sale effect, and add create/ready/complete/cancel/replay/concurrency integration tests. Obtain Agent 2 invariant review before integration.
2. **B2-B schema foundation:** Agent 4 serializes the approved additive migration; run backfill collision audit and migration rollback rehearsal on an isolated database.
3. **B2-B exact API identity:** replace notes-substring lookup/list/get with the exact constrained field; require an external ID or scoped operation key; verify sequential/concurrent replay and same-key/different-payload conflict.
4. **B2-B internal create identity:** add client-generated keys and request hashes to sales and standard PO create; persist replay outcome in the same transaction; verify document, audit, customer, `onOrder`, and event cardinality.
5. **B2-B public checkout identity:** honor a client-persisted `Idempotency-Key`, bind it to the canonical checkout payload/catalogue principal, and suppress duplicate event/email dispatch on replay.
6. **B2-B PO bulk cancel:** replace client `Promise.all` with one server command that locks and validates the full set before an all-or-nothing cancel; return a stable replay response and preserve selection/filter state on conflict.
7. **B2-C:** establish mutation-to-cache invalidation/version coverage with Agent 2, make memory/Redis behavior cross-process safe, and add displayed quote/version validation so checkout cannot silently accept a different price.
8. Run focused DB tests, browser double-submit/retry scenarios, mobile/desktop and light/dark states where UI changes, then independent Agent 4 Preview verification.

Do not combine all steps into one uncontrolled commit. Migration, stock invariant, operation foundation, each caller family, batch cancel, and cache/quote changes should remain reviewable commits.

## Test gaps and required post-fix acceptance

1. Sequential and concurrent same-key replay for API, internal sales, standard PO, public checkout, and PO bulk cancel, including exact document/stock/on-order/customer/audit/event/email cardinality.
2. Same key with a different canonical payload must return a deterministic conflict and make zero domain/provider side effects.
3. Exact external-ID cases: `EXT-1` versus `EXT-10`, whitespace normalization, case contract, Unicode/special characters, cross-store reuse policy, concurrent create, legacy backfill collision, list, and get.
4. Full source/status stock matrix for manual, catalogue, and API orders, including cancellation before completion, completion replay, concurrent completion, negative-stock policy, and historical API orders created before rollout.
5. PO bulk cancellation with a state change during confirmation, invalid ID, cross-store denial, database error, retry after response loss, large selection, and browser filter/selection reconciliation.
6. Cross-process cache proof: process A warms memory/Redis, process B commits each product/price/stock/archive/assignment mutation, and process A's next successful read is current. Also verify Redis-unavailable behavior cannot serve unbounded stale memory.
7. Public price contract: cache warmed at one price, mutation commits, quantity/variant changes, checkout retry, explicit quote-changed response, and browser reconfirmation. No raw database error should reach the customer.
8. Mocked provider proof after fixes: one logical order yields at most one confirmation email and one created event; replay yields the same response and zero additional provider calls.
9. Agent 4 browser and Preview verification, plus full release commands, remain mandatory. The focused audit run is not a release gate.
