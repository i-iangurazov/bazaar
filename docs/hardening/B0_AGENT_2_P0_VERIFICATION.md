# Phase B0 Agent 2 P0 Verification Plan

Baseline integration commit: `f308b2b793c2b43d7e46814c3c2007a0927fede7`
Branch: `hardening/b0-agent-2-inventory`
Prepared: 2026-07-22
Scope: the eleven P0 hypotheses from `AGENT_2_INVENTORY_AUDIT.md`

## Runtime result and safety record

The hardening lead approved the database guard and isolated environment. Runtime verification used only database `bazaar_hardening_agent2_inventory`, all 87 committed migrations, and reserved Redis DB 12. Integrations were mocked; no provider, production, Preview, real account, or external network was contacted.

Final guarded command:

```bash
set -a; source .env.hardening; set +a; pnpm exec vitest run tests/integration/hardening-agent2-p0-reproductions.test.ts tests/integration/hardening-agent2-p0-http-reproductions.test.ts tests/unit/hardening-agent2-receiving-draft-reproduction.test.tsx --maxWorkers=1
```

Observed result: 3 test files passed, 11 tests passed, 0 failed. Focused ESLint and `pnpm typecheck` also passed. Static evidence was not used to assign the final classifications.

Allowed classification taxonomy:

| Classification | Meaning |
|---|---|
| `CONFIRMED` | The unsafe runtime outcome was reproduced with durable or machine-readable evidence |
| `DUPLICATE` | The runtime result is fully represented by a named primary issue/root-cause group |
| `DOWNGRADED` | A defect reproduced but runtime impact does not meet P0 |
| `FALSE_POSITIVE` | The proposed unsafe outcome did not reproduce and controls behaved correctly |
| `BLOCKED_BY_ENVIRONMENT` | Required safe local evidence could not be executed |

No issue was classified as a duplicate: shared root-cause groups identify implementation coordination, while each P0 has a distinct affected contract or business effect.

## Provisional root-cause groups

These groups are based only on source inspection and remain provisional.

| Group | Provisional cause | P0s |
|---|---|---|
| `RC-A1` | Same-organization checks are used where assigned-store authorization is required | `HARD-A2-001`, `HARD-A2-009` |
| `RC-A2` | Product-root reads/mutations are not scoped through accessible active `StoreProduct` assignments | `HARD-A2-002`, `HARD-A2-003` |
| `RC-A3` | A store-scoped command invokes an organization-wide destructive service | `HARD-A2-008` |
| `RC-B1` | Logical operations lack a client idempotency key and durable replay record | `HARD-A2-005`, `HARD-A2-006` |
| `RC-C1` | One logical bulk operation commits multiple independent chunk transactions | `HARD-A2-007` |
| `RC-D1` | Authorization checks only the top-level stock field and misses nested variant stock | `HARD-A2-004` |
| `RC-E1` | A download capability token is not bound to creator or organization | `HARD-A2-010` |
| `RC-F1` | Browser draft storage has no user/org namespace, ownership envelope, expiry, or consume cleanup | `HARD-A2-017` |

## Canonical fixture topology

Use test factories, Prisma setup code, or committed integration helpers rather than hand-written production-like inserts. IDs below are named bindings in the execution queries, not literal values.

| Binding | Fixture |
|---|---|
| `:run_key` | Unique marker such as `a2-p0-<UTC timestamp>-<random>` |
| `:org_alpha` | Dedicated organization with all required plan features enabled |
| `:org_beta` | Second dedicated organization for cross-org artifact testing |
| `:store_a` | Alpha store assigned to restricted Alpha users |
| `:store_b` | Alpha store not assigned to those users |
| `:admin_alpha` | Alpha ADMIN |
| `:manager_a` | Alpha MANAGER with only `store_a` access |
| `:cashier_a` | Alpha CASHIER with only `store_a` access |
| `:viewer_a` | Alpha limited/viewer role, if the schema supports one, with only `store_a` access |
| `:user_beta` | Authenticated user in `org_beta` |
| `:product_a` | Active product assigned only to `store_a` |
| `:product_b` | Active product assigned only to `store_b`, with unique barcode, base price and average cost |
| `:variant_b` | Active variant of `product_b` |
| `:snapshot_a_*` | At least eleven valid snapshots in `store_a` for bulk atomicity testing |
| `:snapshot_b` | Snapshot for `product_b` in `store_b` |
| `:count_b`, `:count_line_b`, `:lot_b` | Draft count, line and expiry lot in `store_b` |

Required identity preflight, to run only after approval:

```sql
SELECT
  current_database() AS database_name,
  current_user AS database_user,
  inet_server_addr()::text AS server_address,
  inet_server_port() AS server_port;

SELECT id, name
FROM "Organization"
WHERE id IN (:org_alpha, :org_beta)
ORDER BY id;
```

The test run must stop if the guard's expected database fingerprint and the first query do not match exactly.

## Verification matrix

| ID | Root group | Primary runtime proof | Classification |
|---|---|---|---|
| `HARD-A2-001` | `RC-A1` | Store-A-only Manager read Store B data and applied Store B count | `CONFIRMED` |
| `HARD-A2-002` | `RC-A2` | Store-A-only Manager changed Store-B-only product and price | `CONFIRMED` |
| `HARD-A2-003` | `RC-A2` | Store-A-only Staff received Store-B-only base price and average cost | `CONFIRMED` |
| `HARD-A2-004` | `RC-D1` | Manager created nested variant stock despite admin-only invariant | `CONFIRMED` |
| `HARD-A2-005` | `RC-B1` | Replayed create and percentage-price requests produced second effects | `CONFIRMED` |
| `HARD-A2-006` | `RC-B1` | Replayed scan incremented the same durable count line twice | `CONFIRMED` |
| `HARD-A2-007` | `RC-C1` | Invalid second chunk errored after first ten snapshots committed | `CONFIRMED` |
| `HARD-A2-008` | `RC-A3` | Store-A removal deleted Store-B preference and global category | `CONFIRMED` |
| `HARD-A2-009` | `RC-A1` | Restricted Manager obtained PDF and reached mocked Store B connector | `CONFIRMED` |
| `HARD-A2-010` | `RC-E1` | Authenticated Beta user consumed Alpha user's ZIP token | `CONFIRMED` |
| `HARD-A2-017` | `RC-F1` | User B's rendered form hydrated User A's unowned session draft | `CONFIRMED` |

## HARD-A2-001 — stock count, lot and snapshot store authorization

Classification: `CONFIRMED`

Primary/duplicates: primary `HARD-A2-001`; no duplicate. Root group `RC-A1` is shared with the separate HTTP-boundary issue `HARD-A2-009`.

Focused evidence: `tests/integration/hardening-agent2-p0-reproductions.test.ts`, test `HARD-A2-001 exposes and mutates Store B count, lot, and snapshot data for a Store-A-only manager`.

Observed result: the Manager's DB access rows contained Store A only. The authenticated caller nevertheless returned the Store B count, count line, expiry lot and snapshot product ID. The mutation changed the Store B line from counted quantity 7 to 8, changed the count from `IN_PROGRESS` to `APPLIED`, changed the Store B snapshot from 5 to 8, and persisted one `STOCK_COUNT` movement with `qtyDelta = 3`.

Use separate fixtures for read, line mutation, apply and cancel probes. Exercise `manager_a`, `cashier_a`, and `viewer_a` wherever the declared role allows the procedure.

API evidence to collect through an authenticated `appRouter.createCaller` context:

```ts
await caller.stockCounts.list({ storeId: storeB });
await caller.stockCounts.get({ stockCountId: countB });
await caller.stockCounts.create({ storeId: storeB, notes: runKey });
await caller.stockCounts.addOrUpdateLineByScan({
  stockCountId: countB,
  storeId: storeB,
  barcodeOrQuery: barcodeB,
  mode: "increment",
  countedDelta: 1,
});
await caller.stockCounts.setLineCountedQty({ lineId: countLineB, countedQty: 7 });
await caller.stockCounts.removeLine({ lineId: countLineB });
await caller.stockCounts.applyCount({ stockCountId: countB, idempotencyKey: `${runKey}-apply` });
await caller.stockCounts.cancel({ stockCountId: countB });
await caller.stockLots.byProduct({ storeId: storeB, productId: productB });
await caller.stockLots.expiringSoon({ storeId: storeB, days: 30 });
await caller.inventory.productIdsBySnapshotIds({ snapshotIds: [snapshotB] });
```

For every call record role, request ID, status/code/message and sanitized response. The safe result is `FORBIDDEN` with `storeAccessDenied` and no Store B identifier or data. A `null` or empty response is not sufficient for mutation probes; DB invariance is required.

DB before/after evidence:

```sql
SELECT "userId", "storeId"
FROM "UserStoreAccess"
WHERE "userId" IN (:manager_a, :cashier_a, :viewer_a)
ORDER BY "userId", "storeId";

SELECT id, "organizationId", "storeId", status, "updatedAt"
FROM "StockCount"
WHERE id = :count_b;

SELECT id, "stockCountId", "storeId", "productId", "countedQty", "deltaQty", "updatedAt"
FROM "StockCountLine"
WHERE "stockCountId" = :count_b
ORDER BY id;

SELECT id, "organizationId", "storeId", "productId", "onHandQty", "updatedAt"
FROM "StockLot"
WHERE id = :lot_b;

SELECT id, "storeId", "productId", "onHand", "updatedAt"
FROM "InventorySnapshot"
WHERE id = :snapshot_b;

SELECT id, "storeId", "productId", type, "qtyDelta", "createdById", "createdAt"
FROM "StockMovement"
WHERE "storeId" = :store_b AND "createdAt" >= :probe_started_at
ORDER BY "createdAt", id;
```

Browser evidence:

- In a fresh restricted-user context, deep-link to `/inventory/counts/:count_b`; capture the rendered denial/absence, response bodies, console log and trace.
- Use the same browser context's authenticated request channel for each forged Store B call so cookie/session behavior is covered, not only a synthetic caller.
- Verify Store B count names, product names, quantities and expiry lots never appear in DOM, streamed payloads, console output, or toast text.

Decision rule: `CONFIRMED` if any restricted role receives Store B data or any before/after DB row changes. Split by procedure/role if results differ.

## HARD-A2-002 — manager mutation scope for products and store prices

Classification: `CONFIRMED`

Primary/duplicates: primary `HARD-A2-002`; no duplicate. Root group `RC-A2` is shared with the separate pricing-read disclosure `HARD-A2-003`.

Focused evidence: `tests/integration/hardening-agent2-p0-reproductions.test.ts`, test `HARD-A2-002 lets a Store-A-only manager mutate a Store-B-only product and price`.

Observed result: the Manager had only Store A access while Product B had only an active Store B assignment. `products.inlineUpdate` changed Product B's persisted name to `Unauthorized Store B rename`; `storePrices.upsert` then created a Store B price of 3210 with the restricted Manager as `updatedById`.

Create one fresh Store-B-only product per destructive subcase. The manager must have exactly one active `UserStoreAccess` row for Store A.

API subcases:

| Procedure | Crafted input characteristic | Prohibited effect |
|---|---|---|
| `products.update` | `productId: productB`; omit `storeId` | Product B fields/relations change |
| `products.inlineUpdate` | `productId: productB` | Product B name/category/price changes |
| `products.duplicate` | `productId: productB`; omit `storeId` | New copied product, cost, stock or images |
| `products.generateBarcode` | `productId: productB` | Barcode created/replaced |
| `products.bulkGenerateBarcodes` | explicit Store B product IDs/filter without an accessible store | Barcode created/replaced |
| `products.bulkUpdateCategory` | `productIds: [productB]` | Category changes |
| `products.arrangeClothingCategories` | `productIds: [productB]` | Categories change |
| `products.archive` / `products.restore` | `productId: productB` | `isDeleted` toggles |
| `storePrices.upsert` | `storeId: storeB, productId: productB` | Store B price or assignment changes |
| `storePrices.bulkUpdate` | `storeId: storeB` | Any Store B prices change |

Record full tRPC error metadata and request ID. The safe result is a store/product access error before service mutation. AI-description subcases stay with Agent 3 and are not silently included here.

DB before/after evidence:

```sql
SELECT p.id, p."organizationId", p.sku, p.name, p.category, p.categories, p."basePriceKgs", p."isDeleted",
       sp."storeId", sp."isActive"
FROM "Product" p
LEFT JOIN "StoreProduct" sp ON sp."productId" = p.id
WHERE p.id = :product_b
ORDER BY sp."storeId";

SELECT id, "productId", value, "createdAt"
FROM "ProductBarcode"
WHERE "productId" = :product_b
ORDER BY id;

SELECT id, "organizationId", "storeId", "productId", "variantKey", "priceKgs", "updatedById", "updatedAt"
FROM "StorePrice"
WHERE "productId" = :product_b
ORDER BY "storeId", "variantKey";

SELECT id, "organizationId", sku, name, "createdAt"
FROM "Product"
WHERE name LIKE :run_key_pattern OR sku LIKE :run_key_pattern
ORDER BY "createdAt", id;
```

Browser evidence:

- Confirm Product B is absent from Manager A's normal product list and search.
- From that same browser session, issue each crafted mutation through its authenticated network channel and retain HAR/response evidence.
- Reload `/products` and an Admin's Store B product page to capture any persisted unauthorized change.

Decision rule: `CONFIRMED` if any subcase succeeds or produces a prohibited row change. Mark `PARTIALLY_CONFIRMED` and split the issue if only some procedures are vulnerable.

## HARD-A2-003 — restricted product pricing confidentiality

Classification: `CONFIRMED`

Primary/duplicates: primary `HARD-A2-003`; no duplicate. It shares `RC-A2` with mutation-scope issue `HARD-A2-002`, but read confidentiality and write authorization require separate regression contracts.

Focused evidence: `tests/integration/hardening-agent2-p0-reproductions.test.ts`, test `HARD-A2-003 returns Store-B-only prices and costs to a Store-A-only staff user`.

Observed result: DB fixtures assigned Product B only to Store B with base price 9876 and average cost 5432. A Store-A-only Staff caller received both values from `products.pricing`; `products.storePricing` returned the same confidential values while returning `stores: []`. The probe is read-only, so no DB mutation was expected.

Product B must be assigned only to Store B and have distinctive nonzero `basePriceKgs`, `ProductCost.avgCostKgs`, and Store B price values that do not occur in Store A.

API evidence:

```ts
await caller.products.pricing({ productId: productB });
await caller.products.pricing({ productId: productB, storeId: storeA });
await caller.products.storePricing({ productId: productB });
```

Run as `cashier_a` and `viewer_a`. Save sanitized response JSON and prove that no price, cost, product name, SKU or Store B identifier is returned. The safe result is `productNotFound` or `storeAccessDenied`.

DB identity/evidence query:

```sql
SELECT p.id, p."organizationId", p."basePriceKgs", pc."avgCostKgs", sp."storeId", sp."isActive",
       price."priceKgs" AS store_price
FROM "Product" p
LEFT JOIN "ProductCost" pc ON pc."productId" = p.id AND pc."variantKey" = 'BASE'
LEFT JOIN "StoreProduct" sp ON sp."productId" = p.id
LEFT JOIN "StorePrice" price ON price."productId" = p.id AND price."storeId" = sp."storeId"
WHERE p.id = :product_b
ORDER BY sp."storeId";
```

Browser evidence:

- Verify Product B is absent from normal Store A product/search UI.
- Execute the three pricing calls from the authenticated browser context and retain HAR plus response JSON.
- Search the DOM, RSC payload, trace and console capture for the distinctive price/cost canary values.

Decision rule: `CONFIRMED` if any canary product, price or cost field is disclosed to a user without Store B access.

## HARD-A2-004 — manager nested initial stock bypass

Classification: `CONFIRMED`

Primary/duplicates: primary `HARD-A2-004`; no duplicate; root group `RC-D1`.

Focused evidence: `tests/integration/hardening-agent2-p0-reproductions.test.ts`, test `HARD-A2-004 lets a manager create admin-only stock through a nested variant`.

Observed result: no marker product existed before the request. A Manager submitted top-level `initialOnHand: 0` and nested variant `initialOnHand: 10`; the API succeeded and persisted a variant snapshot with on-hand 10 plus one `ADJUSTMENT` movement of +10 attributed to the Manager.

Use a Manager with Store A access and a valid base unit. Submit a normal product-create payload with top-level `initialOnHand` omitted or zero and this nested variant fragment:

```ts
{
  name: `${runKey} nested stock`,
  storeId: storeA,
  baseUnitId,
  initialOnHand: 0,
  variants: [
    {
      name: "S",
      sku: `${runKey}-S`,
      attributes: { size: "S" },
      initialOnHand: 10,
    },
  ],
}
```

API evidence must include the result/error, request ID and created product ID if returned. The safe result is `FORBIDDEN`/`inventoryAdminRequired`, with no product, variant, snapshot, movement, cost or audit row created for the marker.

DB before/after evidence:

```sql
SELECT p.id, p.sku, p.name, v.id AS variant_id, v.sku AS variant_sku,
       s.id AS snapshot_id, s."storeId", s."onHand"
FROM "Product" p
LEFT JOIN "ProductVariant" v ON v."productId" = p.id
LEFT JOIN "InventorySnapshot" s ON s."productId" = p.id AND s."variantId" = v.id
WHERE p.name = :marker_name OR v.sku = :variant_marker_sku;

SELECT m.id, m."storeId", m."productId", m."variantId", m.type, m."qtyDelta", m."createdById"
FROM "StockMovement" m
JOIN "Product" p ON p.id = m."productId"
WHERE p.name = :marker_name
ORDER BY m."createdAt", m.id;
```

Browser evidence:

- Confirm the Manager UI does not offer top-level or variant initial-stock controls.
- From the same authenticated browser context submit the crafted payload, capture the network result and reload Store A inventory.
- Capture a screenshot and DOM assertion showing no marker product/stock on safe behavior, or the unauthorized variant quantity on vulnerable behavior.

Decision rule: `CONFIRMED` if the request succeeds with a snapshot/movement of 10. Product creation without stock is still a defect if the API silently ignores prohibited stock; record separately because the expected contract is an explicit denial.

## HARD-A2-005 — replay safety for product/import/price operations

Runtime state: `BLOCKED_BY_ENVIRONMENT`

Each subcase uses a fresh marker and sends the identical logical request twice. To model a lost response, the harness must allow request one to commit, discard its response, then send request two. Do not infer a replay defect merely from two deliberate UI submissions with different generated operation identities.

| Subcase | Request pair | Safe invariant |
|---|---|---|
| Product create | Same payload, omit SKU, include initial stock as Admin | One product and one stock effect |
| Product duplicate | Same source/options with `copyInventory: true` | One duplicate and one copied-stock effect |
| CSV import | Same rows/store with `stockBehavior: "add"` | One import effect; stock added once |
| Bulk price percent | Same Store A filter, `mode: "increasePct", value: 10` | Price 100 becomes 110 once, never 121 |
| Bulk price absolute | Same Store A filter, `mode: "increaseAbs", value: 10` | Price 100 becomes 110 once, never 120 |

API evidence must record both request bodies, correlation IDs, transport-abort timing, second response and any idempotency row. At least one case must run through the real HTTP/tRPC transport rather than direct service calls.

DB evidence queries, parameterized per subcase:

```sql
SELECT id, sku, name, "createdAt"
FROM "Product"
WHERE name LIKE :run_key_pattern OR sku LIKE :run_key_pattern
ORDER BY "createdAt", id;

SELECT s."productId", s."variantKey", s."onHand",
       COALESCE(SUM(m."qtyDelta"), 0) AS movement_delta,
       COUNT(m.id) AS movement_count
FROM "InventorySnapshot" s
LEFT JOIN "StockMovement" m
  ON m."storeId" = s."storeId"
 AND m."productId" = s."productId"
 AND COALESCE(m."variantId", '') = COALESCE(s."variantId", '')
WHERE s."storeId" = :store_a AND s."productId" = :target_product
GROUP BY s."productId", s."variantKey", s."onHand";

SELECT id, "organizationId", type, "createdById", "createdAt", summary
FROM "ImportBatch"
WHERE "organizationId" = :org_alpha AND "createdAt" >= :probe_started_at
ORDER BY "createdAt", id;

SELECT "storeId", "productId", "variantKey", "priceKgs", "updatedAt"
FROM "StorePrice"
WHERE "storeId" = :store_a AND "productId" = :price_product;

SELECT key, route, "userId", "createdAt"
FROM "IdempotencyKey"
WHERE "userId" = :actor_id AND "createdAt" >= :probe_started_at
ORDER BY "createdAt", id;
```

Browser evidence:

- Use Playwright routing/proxy support to abort the first response only after the server-side commit signal is observable, then let the UI retry the same logical operation.
- Capture the user-facing error/retry path and the final product/import/price UI after a reload.
- Verify there are no raw database errors and no ambiguous success state.

Decision rule: evaluate and split all five subcases independently. `CONFIRMED` requires a second durable effect; an error on retry with exactly one durable effect is not confirmation but may still require UX/error handling follow-up.

## HARD-A2-006 — stock-count scanner replay safety

Runtime state: `BLOCKED_BY_ENVIRONMENT`

Create a draft count in Store A with a line whose `countedQty` is 0. Send the exact same `increment` request twice with the same logical scan identity; discard the first response after commit. Because the current contract has no idempotency key, preserve the two request IDs as evidence.

```ts
const scan = {
  stockCountId: countA,
  storeId: storeA,
  barcodeOrQuery: barcodeA,
  mode: "increment" as const,
  countedDelta: 1,
};
await caller.stockCounts.addOrUpdateLineByScan(scan);
await caller.stockCounts.addOrUpdateLineByScan(scan);
```

DB before/after evidence:

```sql
SELECT id, "stockCountId", "storeId", "productId", "countedQty", "expectedOnHand", "deltaQty",
       "lastScannedAt", "updatedAt"
FROM "StockCountLine"
WHERE "stockCountId" = :count_a AND "productId" = :product_a;

SELECT id, key, route, "userId", "createdAt"
FROM "IdempotencyKey"
WHERE "userId" = :scanner_user AND "createdAt" >= :probe_started_at
ORDER BY "createdAt", id;
```

If count application is tested, use a disposable count and then also query its snapshot and movements. Applying is not necessary to confirm that one physical scan was counted twice.

Browser evidence:

- On `/inventory/counts/:count_a`, focus the scanner input and make the first request commit while its response is dropped; allow the client/operator retry.
- Capture trace, request timing, visible counted quantity and the value after a full reload.
- Confirm the UI does not merely display an optimistic duplicate while DB remains correct.

Decision rule: `CONFIRMED` if the durable `countedQty` becomes 2 for one logical scan. A rate-limit rejection or `countedQty = 1` refutes this exact replay.

## HARD-A2-007 — atomicity of bulk set-on-hand

Runtime state: `BLOCKED_BY_ENVIRONMENT`

Create eleven valid Store A snapshots ordered explicitly in the request, then replace item 11 with a nonexistent, archived-product, or Store B snapshot ID. Keep items 1–10 at an initial quantity different from the target.

```ts
await caller.inventory.bulkSetOnHand({
  storeId: storeA,
  snapshotIds: [...firstTenValidSnapshotIds, invalidEleventhId],
  targetOnHand: 77,
  reason: `${runKey} atomicity probe`,
  idempotencyKey: `${runKey}-bulk-set`,
});
```

Run the nonexistent, archived-product and wrong-store variants on separate fixtures. Record the thrown error and elapsed time.

DB before/after evidence:

```sql
SELECT id, "storeId", "productId", "onHand", "updatedAt"
FROM "InventorySnapshot"
WHERE id IN (:snapshot_id_list)
ORDER BY id;

SELECT id, "storeId", "productId", type, "qtyDelta", note, "createdById", "createdAt"
FROM "StockMovement"
WHERE "storeId" = :store_a
  AND "createdAt" >= :probe_started_at
  AND note = :probe_reason
ORDER BY "createdAt", id;

SELECT key, route, "userId", response, "createdAt"
FROM "IdempotencyKey"
WHERE key LIKE :idempotency_key_prefix
ORDER BY key;

SELECT id, action, entity, "entityId", "requestId", "createdAt"
FROM "AuditLog"
WHERE "requestId" = :request_id
ORDER BY "createdAt", id;
```

Browser evidence:

- Select more than ten inventory rows, make the last selection stale after selection but before submit, and submit the bulk target.
- Capture the error toast/network response, then reload inventory and show all first-ten quantities.
- The safe contract is either no row changed or an explicit, successful partial-result protocol. The current UI promises neither, so an error plus changed first chunk confirms the P0.

Decision rule: `CONFIRMED` if the API errors while any first-chunk snapshot/movement/audit/idempotency row shows a committed stock change.

## HARD-A2-008 — store-scoped category removal deleting organization state

Runtime state: `BLOCKED_BY_ENVIRONMENT`

Create an unused category whose normalized name is unique to the run and create preferences for Store A and Store B. No product or template may use the category, otherwise blocker behavior masks the deletion path.

API probe:

```ts
await managerACaller.productCategories.remove({
  name: markerCategory,
  storeId: storeA,
});
```

DB before/after evidence:

```sql
SELECT id, "organizationId", name, "createdAt"
FROM "ProductCategory"
WHERE "organizationId" = :org_alpha AND name = :marker_category;

SELECT id, "organizationId", "storeId", name, "normalizedName", "isVisibleInForms", "isArchived"
FROM "StoreCategoryPreference"
WHERE "organizationId" = :org_alpha AND "normalizedName" = :normalized_marker
ORDER BY "storeId";

SELECT id, action, entity, "entityId", "requestId", "createdAt"
FROM "AuditLog"
WHERE "requestId" = :request_id
ORDER BY "createdAt", id;
```

Browser evidence:

- As Manager A, select Store A in the product category manager and remove the marker category; capture the exact scope language in the confirmation UI.
- In a separate Admin context, inspect Store B before and after and capture whether its preference/category disappeared.
- Retain the Manager mutation response and both contexts' screenshots/traces.

Decision rule: `CONFIRMED` if the Store B preference or organization `ProductCategory` row is deleted by the Store-A-scoped Manager command. If the intended product model is explicitly organization-wide, preserve the runtime evidence and reclassify as an authorization/design-contract decision rather than silently closing it.

## HARD-A2-009 — price-tag and connector store authorization

Runtime state: `BLOCKED_BY_ENVIRONMENT`

Manager/Cashier/limited users have Store A only. Product B belongs to the same organization and Store B. Configure Store B for PDF and connector modes in separate fixtures. Mock connector readiness/dispatch; no physical or remote printer call is permitted.

HTTP probes from each restricted authenticated session:

```http
POST /api/price-tags/pdf
Content-Type: application/json

{"template":"3x8","storeId":":store_b","items":[{"productId":":product_b","quantity":1}]}
```

```http
POST /api/printing/labels/connector
Content-Type: application/json

{"template":"3x8","storeId":":store_b","items":[{"productId":":product_b","quantity":1}]}
```

Replace placeholders before execution. The safe response is HTTP 403 `storeAccessDenied` before product, printer profile, connector readiness or dispatch work. Save status, headers, sanitized response body and mock invocation counts.

DB identity/invariance evidence:

```sql
SELECT u.id, u.role, u."organizationId", usa."storeId"
FROM "User" u
LEFT JOIN "UserStoreAccess" usa ON usa."userId" = u.id
WHERE u.id IN (:manager_a, :cashier_a, :viewer_a)
ORDER BY u.id, usa."storeId";

SELECT s.id, s."organizationId", s.name, p."labelPrintMode", p."updatedAt"
FROM "Store" s
LEFT JOIN "StorePrinterSettings" p ON p."storeId" = s.id
WHERE s.id = :store_b;

SELECT p.id, p."organizationId", sp."storeId", sp."isActive"
FROM "Product" p
LEFT JOIN "StoreProduct" sp ON sp."productId" = p.id
WHERE p.id = :product_b;
```

Browser evidence:

- Confirm Store B is absent from the user's normal print/store selector.
- Use the same authenticated browser context to issue both crafted POSTs; capture HAR and assert no PDF bytes are returned and connector mocks have zero calls.
- Check console/toasts for raw provider/database messages.

Decision rule: `CONFIRMED` if the PDF returns 200/binary data, the connector path reaches readiness/dispatch, or Store B profile data is reflected in the response for a user without Store B access.

## HARD-A2-010 — cross-user image-export token consumption

Runtime state: `BLOCKED_BY_ENVIRONMENT`

User Alpha creates an image export containing a run-specific product/image. All image fetches must be served by a deterministic local mock. Capture the ready token from the SSE response without logging it outside the restricted evidence directory. Before Alpha downloads it, authenticate User Beta and request the Alpha download URL.

API sequence:

1. Alpha calls `GET /api/products/export-images?...` and receives the one-time ready token.
2. Beta calls `GET /api/products/export-images/download?token=<alpha-token>`.
3. Alpha attempts the same token afterward to determine whether Beta consumed it.

The safe Beta result is 403 or indistinguishable 404, and Alpha must retain a valid artifact unless policy intentionally invalidates the token. Record auth principal, status, content type, byte length and ZIP entry manifest; never commit product-image contents if they contain real data.

DB identity evidence:

```sql
SELECT id, email, role, "organizationId"
FROM "User"
WHERE id IN (:alpha_export_user, :user_beta)
ORDER BY id;

SELECT pi.id, pi."organizationId", pi."productId", pi.url, p.name
FROM "ProductImage" pi
JOIN "Product" p ON p.id = pi."productId"
WHERE pi.id = :alpha_product_image;
```

There is no expected database artifact row in the current hypothesis; the query proves that the two principals and source image have different organization ownership. The API evidence must additionally record whether any durable export record exists after implementation changes.

Browser evidence:

- Use two independent Playwright contexts, one per organization.
- Start/export in Alpha UI, capture the token through network instrumentation, then navigate Beta to the download URL.
- Save Beta's response metadata and prove whether the ZIP contains Alpha's run-specific canary filename.

Decision rule: `CONFIRMED` if Beta receives ZIP bytes or consumes the token. A random-token entropy argument does not refute missing ownership binding.

## HARD-A2-017 — receiving draft isolation across account changes

Runtime state: `BLOCKED_BY_ENVIRONMENT`

This is primarily a browser-storage hypothesis. Use one browser context and the same origin/tab because `sessionStorage` is tab scoped. User A and User B must have different organizations if the auth flow supports a clean switch; otherwise use two Alpha users with disjoint store access and record that narrower scope.

Browser execution:

1. Sign in as User A and open `/inventory/receiving`.
2. Select A's store/supplier; enter a run-specific reference, note, search and product line with distinctive quantity/cost.
3. Use the real create/edit/duplicate-product round trip so the application writes `bazaar:inventory-receiving-draft:<key>` and adds `receivingDraftKey` to the return URL.
4. Record a redacted storage envelope containing keys, version and ownership metadata fields, but do not expose unrelated browser storage.
5. Sign out in the same tab, sign in as User B, and revisit the captured return URL.
6. Capture fields/lines immediately after hydration and after network settles; inspect whether the draft key remains after restore, successful submit, cancel and expiry simulation.

API control evidence:

- As User B, call the normal inventory product/store query for User A's store and retain the expected `storeAccessDenied`; this separates a client hydration leak from a server authorization failure.
- If the restored draft enables submit, attempt it only against disposable fixtures and verify the server rejects inaccessible Store A. A rejected submit does not erase the confidentiality leak if A's values were rendered to B.

DB identity evidence:

```sql
SELECT u.id, u.email, u.role, u."organizationId", usa."storeId"
FROM "User" u
LEFT JOIN "UserStoreAccess" usa ON usa."userId" = u.id
WHERE u.id IN (:draft_user_a, :draft_user_b)
ORDER BY u.id, usa."storeId";

SELECT id, "organizationId", name
FROM "Store"
WHERE id IN (:draft_store_a, :draft_store_b)
ORDER BY id;
```

No receiving draft DB row is expected under the current design. The browser evidence must show the exact session-storage owner/expiry fields present or absent.

Decision rule: `CONFIRMED` if User B can read any User A draft field/line or if the consumed draft remains indefinitely reusable. If sign-out explicitly clears the key today, record the mechanism and repeat with same-org account switching before considering `REFUTED`.

## Evidence review and handoff

For each issue, the eventual evidence index must contain:

- environment fingerprint and guard result;
- fixture manifest containing only test IDs and the `run_key`;
- pre/post SQL results with identical ordering;
- API request/response metadata and request IDs;
- browser trace, viewport, theme, screenshot and console/network assertions where applicable;
- mock invocation log proving no external side effect;
- result state and a short explanation tied to the decision rule;
- cleanup result showing only the fixture-owned IDs were removed.

Agent 2 may propose implementation only after runtime evidence changes an item from `BLOCKED_BY_ENVIRONMENT` to `CONFIRMED` or `PARTIALLY_CONFIRMED`. Agent 4 must independently reproduce the critical result or verify the committed evidence before the issue can be treated as confirmed for the hardening backlog.
