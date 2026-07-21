# Agent 2 Phase A Audit — Products & Inventory

Baseline: `4d7c9b33218b584334ca62f7a816f8997f144a10`
Branch: `hardening/agent-2-inventory`
Audit date: 2026-07-22
Mode: static/read-only audit; no application, test, configuration, schema, migration, or package changes

## Status and evidence limits

- Application code was inspected statically in the isolated Agent 2 worktree.
- Browser QA, screenshots, responsive rendering, light/dark rendering, console checks, warmed-route timings, API timings, print output, Preview deployment, and production behavior are `NOT_RUN`.
- DB-backed tests are `NOT_RUN`: no demonstrably isolated Agent 2 database was provisioned, so no DB-mutating command was executed.
- External product-image, AI, email, marketplace, and printer calls are `NOT_RUN`; no external request was sent.
- A focused unit run was attempted with `pnpm exec vitest run tests/unit/mobile-products-source.test.ts` but the isolated worktree has no installed `vitest`. A second attempt using the main worktree binary failed module resolution from the isolated worktree. Agent 4's baseline run independently reported the same test assertion failure described in `HARD-A2-016`.
- Status vocabulary in this document is limited to `PASS`, `FAIL`, `NA`, and `NOT_RUN`. `PASS` in a static column means no defect was identified by source inspection; it is not browser or runtime proof.

## 1. Owned route inventory

| Route | Page/component | Main surfaces and actions | Static | Browser |
|---|---|---|---|---|
| `/products` | `src/app/(app)/products/page.tsx` | server search; store/category/type/readiness/archive filters; server/client sorting; pagination; selection; inline edit; assign to store; duplicate; archive/restore; bulk category/price/barcode/AI actions; CSV/XLSX/image export; price-tag print; category manager; desktop table/mobile cards/modals | FAIL | NOT_RUN |
| `/products/new` | `src/app/(app)/products/new/page.tsx`, `src/components/product-form.tsx` | create/duplicate launch; store selection; core details; categories; attributes; variants/options; packs/barcodes/images; bundle components; initial stock/minimum stock/pricing; mobile section navigation | FAIL | NOT_RUN |
| `/products/[id]` | `src/app/(app)/products/[id]/page.tsx`, `src/components/product-form.tsx` | view/edit; archive; prices/cost; store stock; variant editing; images; movement context; print labels; return-to-list/receiving | FAIL | NOT_RUN |
| `/settings/categories` | `src/app/(app)/settings/categories/page.tsx` | store selector; category visibility/archive preferences; empty/loading/error states | FAIL | NOT_RUN |
| `/settings/attributes` | `src/app/(app)/settings/attributes/page.tsx` | definitions; type/options/required; create/edit/remove modals; category templates | FAIL | NOT_RUN |
| `/settings/units` | `src/app/(app)/settings/units/page.tsx` | base-unit list/create/edit/remove | PASS | NOT_RUN |
| `/settings/import` | `src/app/(app)/settings/import/page.tsx` | source upload/parse; field mapping; dry run; duplicate decisions; update/empty/stock behavior; validation; apply; history/detail/rollback | FAIL | NOT_RUN |
| `/inventory` | `src/app/(app)/inventory/page.tsx` | store-scoped snapshots; server search/filter/page; sorting; negative/low/out stock; planning/min stock; inline edit; manual adjust/receive; transfer/write-off links; bulk set; movements; expiry; print | FAIL | NOT_RUN |
| `/inventory/movements` | `src/app/(app)/inventory/movements/page.tsx` | server search/filter/page/sort; date/type/status/payment/order/store/author/sender/recipient/archive filters; detail/edit/archive/print; URL persistence | PASS | NOT_RUN |
| `/inventory/movements/[id]` | `src/app/(app)/inventory/movements/[id]/page.tsx` | effective document detail; source/destination; lines/totals; edit/archive/print; return-to-filtered journal | PASS | NOT_RUN |
| `/inventory/movements/[id]/print` | `src/app/inventory/movements/[id]/print/page.tsx` | server-authenticated A4 receiving/transfer/write-off document; print toolbar; auto-print | PASS | NOT_RUN |
| `/inventory/receiving` | `src/components/inventory/receiving-workflow.tsx` | store/date/supplier/reference/note; product search; product create/edit/duplicate round-trip draft; lines/cost/totals; post | FAIL | NOT_RUN |
| `/inventory/receiving/[id]/edit` | route wrapper plus receiving workflow | current/effective document load; additive compensating edit; idempotent save; back to journal | PASS | NOT_RUN |
| `/inventory/transfers` | `src/components/inventory/transfer-workflow.tsx` | source/destination; product search; source/destination stock; multi-line quantities/cost/totals; post | PASS | NOT_RUN |
| `/inventory/transfers/[id]/edit` | route wrapper plus transfer workflow | effective transfer state; product/store/quantity replacement; compensating movements; idempotent save | PASS | NOT_RUN |
| `/inventory/write-offs` | `src/components/inventory/write-off-workflow.tsx` | store/reason/comment; product search; quantity/cost/totals; post | PASS | NOT_RUN |
| `/inventory/write-offs/[id]/edit` | route wrapper plus write-off workflow | effective write-off state; line/quantity replacement; compensating movements; idempotent save | PASS | NOT_RUN |
| `/inventory/counts` | `src/app/(app)/inventory/counts/page.tsx` | store/status filters; list/client pagination; create modal; role-aware subtitle | FAIL | NOT_RUN |
| `/inventory/counts/new` | redirect page | redirects to `/inventory/counts` | PASS | NOT_RUN |
| `/inventory/counts/[id]` | `src/app/(app)/inventory/counts/[id]/page.tsx` | scan/increment; set/remove lines; expected/counted/delta; movement modal; apply/cancel; CSV/XLSX export | FAIL | NOT_RUN |

### Responsive/theme surface inventory

The owned pages contain separate responsive implementations or breakpoints for desktop tables and mobile cards/sheets. The required `390x844`, `414x896`, `768`, `1440`, and large-desktop viewports are all `NOT_RUN`. Light and dark themes are both `NOT_RUN`. Static inspection found responsive branches in `ResponsiveDataList`, product mobile toolbar/cards, product-form mobile sections, inventory mobile cards, stock-count mobile cards, document workflows, and modal/sheet primitives; it does not establish visual correctness.

## 2. Owned API and procedure inventory

### tRPC

| Router | Procedures | Declared access |
|---|---|---|
| `products` | `descriptionGenerationAvailability`, `suggestSku`, `lookupScan`, `findByBarcode`, `searchQuick`, `bootstrap`, `list`, `listIds`, `duplicateDiagnostics`, `byIds`, `getById`, `pricing`, `storePricing`, `create`, `update`, `inlineUpdate`, `duplicate`, `assignToStore`, `generateBarcode`, `generateDescription`, `bulkGenerateBarcodes`, `bulkGenerateDescriptions`, `startDescriptionGenerationJob`, `descriptionGenerationJob`, `retryDescriptionGenerationJobFailed`, `bulkUpdateCategory`, `arrangeClothingCategories`, `importCsv`, `previewImportCsv`, `exportCsv`, `archive`, `restore`, `deletePermanent` | protected reads; manager product mutations; admin import/permanent delete. AI description procedures are cross-owned by Agent 3. |
| `inventory` | `list`, `listIds`, `searchProducts`, `productIdsBySnapshotIds`, `movements`, `productMovements`, `productMovementDocument`, `editableProductMovementDocument`, `editProductMovementDocument`, `archiveProductMovementDocument`, `adjust`, `bulkSetOnHand`, `receive`, `postStockReceiving`, `postStockWriteOff`, `transfer`, `recompute`, `setMinStock`, `setDefaultMinStock` | protected reads; manager stock/document mutations; admin bulk set/recompute |
| `stockCounts` | `list`, `get`, `create`, `addOrUpdateLineByScan`, `setLineCountedQty`, `removeLine`, `applyCount`, `cancel` | all authenticated roles for list/get/create/line editing; manager/admin apply/cancel; plan-gated |
| `stockLots` | `byProduct`, `expiringSoon` | all authenticated roles; plan-gated |
| `storePrices` | `upsert`, `bulkUpdate` | manager/admin; plan-gated |
| `productCategories` | `list`, `listForStore`, `create`, `remove`, `setStoreVisibility` | protected list; manager create/remove; admin/org-owner visibility |
| `attributes` | `list`, `create`, `update`, `remove` | protected list; manager/admin mutations |
| `categoryTemplates` | `list`, `categories`, `set`, `remove` | manager/admin |
| `units` | `list`, `create`, `update`, `remove` | protected list; manager/admin mutations |
| `imports` | `list`, `get`, `rollback` | admin; plan-gated |
| `bundles` | `listComponents`, `addComponent`, `removeComponent`, `assemble` | protected list; manager component mutations; admin assembly; plan-gated |

### HTTP routes

| Route | Purpose | Static | Runtime |
|---|---|---|---|
| `POST /api/price-tags/pdf` | validate label request, load products/store price/profile, generate PDF | FAIL | NOT_RUN |
| `POST /api/printing/labels/connector` | dispatch label print through configured connector | FAIL | NOT_RUN |
| `GET /api/products/export-images` | scoped image discovery/fetch, ZIP creation, SSE progress/token | FAIL | NOT_RUN |
| `GET /api/products/export-images/download` | one-time ZIP download | FAIL | NOT_RUN |
| `GET /api/product-images/source` | authenticated manager proxy for managed image URLs | PASS | NOT_RUN |
| `POST /api/product-images/upload` | authenticated product image upload | PASS | NOT_RUN |
| `POST /api/product-images/upload-url` | managed upload URL flow | PASS | NOT_RUN |

`/api/bazaar/v1/products`, product description/spec generation, and product-image-studio jobs are cross-owned by Agent 3 and are not claimed as Agent 2 coverage.

## 3. Background jobs and lifecycle

- No Agent 2-owned asynchronous inventory, transfer, receiving, write-off, count, or import job state machine was found. Product CSV import is synchronous inside the request transaction.
- Product description generation jobs and product image studio jobs exist, but the ownership program assigns AI descriptions/specs and integration job lifecycle to Agent 3.
- Therefore pending/processing/completed/completed_with_errors/failed/timed_out/stale-recovery lifecycle coverage is `NA` for native Agent 2 stock documents and `NOT_RUN` for the cross-owned AI jobs.

## 4. Relevant database model inventory

Primary models: `Product`, `ProductCategory`, `StoreProduct`, `ProductImage`, `ProductBarcode`, `ProductPack`, `ProductVariant`, `ProductCost`, `StorePrice`, `ProductBundleComponent`, `AttributeDefinition`, `CategoryAttributeTemplate`, `VariantAttributeValue`, `Unit`, `InventorySnapshot`, `StockMovement`, `StockLot`, `ReorderPolicy`, `StockCount`, `StockCountLine`, `ImportBatch`, `ImportedEntity`, `ImportRollbackReport`, `AuditLog`, and `IdempotencyKey`.

Scoping/support models inspected: `Organization`, `Store`, `StoreCategoryPreference`, `UserStoreAccess`, `StorePrinterSettings`, and `KkmConnectorDevice`. Purchase-order/customer-order/return relations were inspected only where they block product deletion, feed cost, or appear in the product movement journal.

Notable structural facts:

- `InventorySnapshot` is unique by store/product/variant key; `StockMovement` is the inventory ledger and is scoped through `Store` rather than a direct organization column.
- Store access distinguishes org-wide ADMIN/org-owner/platform-owner access from explicit `UserStoreAccess` rows for other roles.
- Attribute keys are denormalized into `ProductVariant.attributes` JSON as well as normalized `VariantAttributeValue` rows.
- Image-export payloads are not persisted in a database or object store; they are held in a process-global JavaScript `Map`.

## 5. RBAC and store-scope matrix

| Capability | Admin | Manager | Cashier/Staff/viewer | Static finding |
|---|---|---|---|---|
| Product list/detail/export for accessible stores | PASS | PASS | PASS | reads generally use accessible store IDs |
| Product create/edit/duplicate/archive/category/barcode | PASS | FAIL | NA | manager source-product/store scope is missing on multiple mutations |
| Initial base stock on product create | PASS | PASS (denied) | NA | top-level guard exists |
| Initial variant stock on product create | PASS | FAIL | NA | manager can bypass the top-level-only guard |
| Store price update | PASS | FAIL | NA | manager store assignment is not checked |
| Inventory list/search/movements | PASS | PASS | PASS | principal routes call store access helper |
| Inventory adjust/receive/transfer/write-off/edit/archive | PASS | PASS | NA | role and store checks present; runtime behavior `NOT_RUN` |
| Bulk set/recompute | PASS | NA | NA | admin-only |
| Stock-count read/create/scan/line edit | PASS | FAIL | FAIL | org membership is used instead of assigned-store access |
| Stock-count apply/cancel | PASS | FAIL | NA | manager role is checked but assigned-store access is not |
| Expiry lots | PASS | FAIL | FAIL | org membership is used instead of assigned-store access |
| Category visibility preference | PASS | NA unless org owner | NA | explicit store access exists |
| Category remove | PASS | FAIL | NA | selected-store request deletes org-wide preference rows |
| Import/apply/rollback | PASS | NA | NA | admin-only; replay protection absent on apply |
| Price-tag/label-print HTTP routes | FAIL | FAIL | FAIL | authenticated token + org check, but no user-store access enforcement |

## 6. Defects

### HARD-A2-001

ID: HARD-A2-001
Route: `/inventory/counts`, `/inventory/counts/[id]`; tRPC `stockCounts.*`, `stockLots.*`, `inventory.productIdsBySnapshotIds`
Feature: Store-scoped inventory/count/lot authorization
Severity: P0
Role: Manager, Cashier, STAFF/limited user with access to Store A but not Store B
Viewport: API/all viewports
Reproduction: In one organization create Store A and Store B; grant the test user only Store A; obtain a Store B count, count line, lot, or snapshot ID; call `stockCounts.list({storeId: B})`, `stockCounts.get`, any count line mutation/apply/cancel, `stockLots.byProduct/expiringSoon`, or `inventory.productIdsBySnapshotIds` with Store B identifiers.
Expected: `storeAccessDenied`; no Store B data or mutation.
Actual: The procedures validate organization membership only; count services validate `count.organizationId`, stock-lot procedures validate `store.organizationId`, and snapshot-ID resolution validates the store's organization. They do not validate the user's `UserStoreAccess`, so Store B data can be read and counts can be mutated/applied.
Root cause hypothesis: These procedures bypass `assertUserCanAccessStore`, unlike `inventory.list/searchProducts/movements`; line-ID mutations do not resolve the count's store back through the access helper.
Files/components: `src/server/trpc/routers/stockCounts.ts`; `src/server/services/stockCounts.ts`; `src/server/trpc/routers/stockLots.ts`; `src/server/trpc/routers/inventory.ts`; `src/server/services/storeAccess.ts`
Evidence: `stockCounts.ts:43-59` checks only organization for list; `:65-75` scopes get only by organization; `:98-200` forwards mutations without store-access assertion. `stockCounts.ts` service lines `87-90`, `129-137`, and later line mutations/apply/cancel check organization/status but not user access. `stockLots.ts:27-68` checks only store organization. `inventory.ts:733-748` returns product IDs for arbitrary same-org snapshot IDs. The access model in `storeAccess.ts` explicitly requires `UserStoreAccess` for non-admin users.

### HARD-A2-002

ID: HARD-A2-002
Route: `/products`, `/products/[id]`; tRPC `products.update`, `inlineUpdate`, `duplicate`, `generateBarcode`, bulk mutations, `archive`, `restore`; `storePrices.upsert`, `storePrices.bulkUpdate`
Feature: Manager product and store-price mutation scope
Severity: P0
Role: Manager restricted to Store A
Viewport: API/all viewports
Reproduction: Create a product assigned only to Store B and a Manager assigned only to Store A. Call a product mutation with the Store B product ID while omitting optional `storeId`, or call a store-price mutation with `storeId: B`.
Expected: The mutation is forbidden because the manager cannot access Store B/the source product.
Actual: Product mutations validate organization ownership but not whether the product is assigned to an accessible store. `update` and `duplicate` check store access only when the optional `storeId` is present; inline/archive/restore/barcode/bulk procedures have no source-product store check. Store-price procedures perform only organization checks and can update Store B or even assign a product to Store B.
Root cause hypothesis: Read-side scoping was centralized in accessible-store helpers, but manager mutation contracts accept naked product/store IDs and the services have no `user` context.
Files/components: `src/server/trpc/routers/products.ts`; `src/server/services/products/mutations.ts`; `src/server/services/products.ts`; `src/server/trpc/routers/storePrices.ts`; `src/server/services/storePrices.ts`; `src/server/services/storeAccess.ts`
Evidence: `products.ts:229-267` treats `storeId` as optional and `inlineUpdate` has no access check; `:367-445` bulk/archive/restore forward org and IDs only. `storePrices.ts:18-73` never calls the store access helper. `storePrices` service lines `19-39` and `106-114` validate organization, not user access, and `upsertStorePrice` calls `assignProductToStore`.

### HARD-A2-003

ID: HARD-A2-003
Route: tRPC `products.pricing`, `products.storePricing`
Feature: Product cost/price confidentiality for store-limited users
Severity: P0
Role: Cashier, STAFF/limited user assigned only to Store A
Viewport: API/all viewports
Reproduction: Create a product assigned only to Store B, then call `products.pricing({productId})` without a store ID or `products.storePricing({productId})` as a Store-A-only user.
Expected: `productNotFound`/`storeAccessDenied` and no price or cost information.
Actual: Both procedures establish only that the product belongs to the organization. `pricing` returns base price and average cost without any accessible-store assignment check. `storePricing` filters the returned store rows but still returns base price and org-wide average cost even if the accessible store list is empty.
Root cause hypothesis: Pricing reads scope store rows but fail to scope the root product query through `productStoreAssignmentInWhere(accessibleStoreIds)`.
Files/components: `src/server/trpc/routers/products.ts`; `src/server/services/products/read.ts`
Evidence: `read.ts:1470-1476` checks only product organization; `:1497-1527` returns `ProductCost`. `:1542-1552` again checks only organization before `:1554-1587` filters stores and the later return includes the cost.

### HARD-A2-004

ID: HARD-A2-004
Route: `/products/new`; tRPC `products.create`
Feature: Admin-only initial inventory
Severity: P0
Role: Manager
Viewport: API/all viewports
Reproduction: As a Manager with access to a store, call `products.create` with top-level `initialOnHand` omitted/zero and `variants: [{name: "S", initialOnHand: 10}]`.
Expected: `inventoryAdminRequired`; no inventory snapshot increment or movement.
Actual: The request passes the admin guard, creates the product, increments variant on-hand by 10, and records an `ADJUSTMENT` movement.
Root cause hypothesis: The router guard checks only `input.initialOnHand`, while the shared variant schema independently accepts `initialOnHand` and the create service applies it.
Files/components: `src/server/trpc/routers/products.ts`; `src/server/trpc/routers/products.schemas.ts`; `src/server/services/products.ts`; `src/app/(app)/products/new/page.tsx`; `src/components/product-form.tsx`
Evidence: `products.ts:212-220` checks only top-level stock. `products.schemas.ts:92-100` permits variant stock. `products.ts` service `1539-1595` increments snapshots and creates movements, and `1949-1957` passes submitted variant stock into that function. UI hiding at `products/new/page.tsx:101` is not an API authorization control.

### HARD-A2-005

ID: HARD-A2-005
Route: `/products/new`, product duplicate dialog, `/settings/import`, `/products` bulk price; tRPC `products.create`, `products.duplicate`, `products.importCsv`, `storePrices.bulkUpdate`
Feature: Idempotency of stock- and money-changing product operations
Severity: P0
Role: Admin or Manager as allowed by each procedure
Viewport: API/all viewports
Reproduction: Submit a create with generated SKU and initial stock, a duplicate with copied inventory, an import with `stockBehavior: "add"`, or a percentage/absolute bulk price increase; let the transaction commit but drop the response; retry the same logical request.
Expected: The retry returns the first result and does not create another product, add stock twice, copy inventory twice, or apply the price increase twice.
Actual: These mutation inputs have no idempotency key and services do not use `withIdempotency`. Generated SKUs/import batch IDs make a replay a new operation; additive import and percentage/absolute price updates can be applied again. The import also performs `recordFirstEvent` after its committed transaction, creating an explicit commit-then-error retry window.
Root cause hypothesis: Idempotency was implemented for native inventory documents but not propagated to product creation/duplication/import and bulk price contracts.
Files/components: `src/server/trpc/routers/products.schemas.ts`; `src/server/trpc/routers/products.ts`; `src/server/services/products.ts`; `src/server/services/imports.ts`; `src/server/trpc/routers/storePrices.ts`; `src/server/services/storePrices.ts`
Evidence: Product create schema lines `178-202`, duplicate/import schemas, and store-price inputs contain no key. `imports.ts:132-189` commits a new batch/import and `:191-196` awaits a post-commit event; no idempotency wrapper exists. Store price bulk logic reads current price then increases it without replay protection.

### HARD-A2-006

ID: HARD-A2-006
Route: `/inventory/counts/[id]`; tRPC `stockCounts.addOrUpdateLineByScan`
Feature: Scanner retry safety
Severity: P0
Role: Any authenticated stock-count operator
Viewport: Scanner/API/all viewports
Reproduction: Send a scan in default `increment` mode, allow it to commit, lose the response, and retry the same scan request. Later apply the count.
Expected: One physical scan contributes one unit; a transport retry is a replay.
Actual: The procedure has no idempotency key. Each committed request reads the current counted value and adds `countedDelta ?? 1`, so a retry increments twice and can later apply incorrect stock.
Root cause hypothesis: Rate limiting was added to the scan mutation, but request identity/replay handling was not.
Files/components: `src/server/trpc/routers/stockCounts.ts`; `src/server/services/stockCounts.ts`; `src/app/(app)/inventory/counts/[id]/page.tsx`
Evidence: `stockCounts.ts:114-142` accepts count/store/barcode/mode/deltas but no idempotency key. Service lines `163-180` calculate `nextCounted = baseCounted + incrementBy` and upsert it. Existing integration coverage tests only `applyStockCount` idempotency.

### HARD-A2-007

ID: HARD-A2-007
Route: `/inventory`; tRPC `inventory.bulkSetOnHand`
Feature: Atomic bulk stock correction
Severity: P0
Role: Admin
Viewport: API/all viewports
Reproduction: Submit more than 10 snapshot IDs where an ID in a later chunk is stale, archived, or belongs to another store; keep valid IDs in the first chunk.
Expected: The whole operation fails with no stock change, or returns an explicit partial-result contract that can be safely reconciled.
Actual: Every 10-row chunk commits in its own transaction. Earlier chunks remain changed when a later chunk throws `inventorySelectionInvalid`; the client receives an error despite partial stock/audit movements already being permanent.
Root cause hypothesis: Transaction chunking was chosen for timeout control, but there is no pre-validation/saga/partial-result protocol across chunks.
Files/components: `src/server/services/inventory.ts`; `src/server/trpc/routers/inventory.ts`; `src/app/(app)/inventory/page.tsx`; `tests/unit/products-page-source.test.ts`
Evidence: `inventory.ts` service `304-318` creates chunks; `:324-427` opens and commits a separate transaction per chunk; validation occurs inside each chunk at `:344-358`. A later error cannot roll back earlier transactions.

### HARD-A2-008

ID: HARD-A2-008
Route: `/products` category manager; tRPC `productCategories.remove`
Feature: Store-scoped category deletion
Severity: P0
Role: Manager assigned to Store A
Viewport: API/all viewports
Reproduction: Create an unused category with preferences in Stores A and B; as a Store-A-only Manager call `productCategories.remove({name, storeId: A})`.
Expected: Only Store A's category preference is removed/archived, or an org-wide destructive operation is restricted to an org owner/admin with explicit confirmation.
Actual: The manager procedure accepts the request after checking Store A, then deletes every matching `StoreCategoryPreference` in the organization and deletes the org-wide `ProductCategory`.
Root cause hypothesis: `storeId` is used only for blocker counts and authorization at the router; the delete query is organization-wide.
Files/components: `src/server/trpc/routers/productCategories.ts`; `src/server/services/productCategories.ts`; `src/app/(app)/products/page.tsx`
Evidence: Router `remove` is `managerProcedure` and checks only the supplied store. Service lines `438-449` create a selected-store count, but `519-528` delete preferences by `organizationId + normalizedName` and then delete the shared category.

### HARD-A2-009

ID: HARD-A2-009
Route: `POST /api/price-tags/pdf`, `POST /api/printing/labels/connector`
Feature: Store-scoped print authorization
Severity: P0
Role: Cashier, STAFF/limited user assigned only to Store A
Viewport: API/all viewports
Reproduction: Authenticate as the limited user and post Store B's ID plus same-organization product IDs to either label endpoint.
Expected: 403 `storeAccessDenied`; no Store B printer/profile data and no print dispatch.
Actual: Both endpoints accept any authenticated token and check only that the store belongs to the token's organization. The PDF route also loads any same-org product IDs without requiring Store B assignment.
Root cause hypothesis: HTTP routes bypass the centralized store-access service and reconstruct authorization as an organization comparison only.
Files/components: `src/app/api/price-tags/pdf/route.ts`; `src/app/api/printing/labels/connector/route.ts`; `src/server/services/storeAccess.ts`; `src/server/printing/adapter.ts`
Evidence: Price-tag route `208-247` checks store/product organization only. Connector route `78-102` authenticates and checks store organization only; token user ID/role/store access is not consulted.

### HARD-A2-010

ID: HARD-A2-010
Route: `GET /api/products/export-images/download`
Feature: Export artifact ownership
Severity: P0
Role: Any authenticated user from another organization/session possessing a valid token
Viewport: API/all viewports
Reproduction: User A starts an image export and obtains its download UUID; while it is live, User B authenticates and calls the download route with User A's UUID.
Expected: 403/404 because the artifact is bound to User A and organization A.
Actual: The download route checks only that some user is authenticated, then consumes the global token and returns the ZIP; stored entries contain no organization or creator identity.
Root cause hypothesis: The bearer UUID is treated as sufficient authorization even though the route also exposes an authenticated boundary.
Files/components: `src/app/api/products/export-images/route.ts`; `src/app/api/products/export-images/download/route.ts`; `src/lib/imageExportStore.ts`
Evidence: Download route lines `7-23` never compare `token.sub`/`organizationId`. `imageExportStore.ts:1-17` stores only bytes, filename, expiry and indexes solely by the UUID.

### HARD-A2-011

ID: HARD-A2-011
Route: `GET /api/products/export-images`, `GET /api/products/export-images/download`
Feature: Production image ZIP export
Severity: P1
Role: Any user with product export access
Viewport: Production/serverless
Reproduction: Run an image export on a multi-instance/serverless deployment, receive the ready token, and let the download request land on a different instance or after the producing instance is recycled.
Expected: The ZIP remains available for its advertised TTL and downloads reliably.
Actual: The producing request writes bytes only to a process-local module `Map`; the next instance has no entry and returns 404.
Root cause hypothesis: A traditional single-process cache was used for a two-request workflow despite Vercel/serverless deployment behavior.
Files/components: `src/app/api/products/export-images/route.ts`; `src/app/api/products/export-images/download/route.ts`; `src/lib/imageExportStore.ts`
Evidence: `imageExportStore.ts:3-5` explicitly states the store works for traditional Node/Docker and not edge/serverless. Export route lines `137-145` stores to that map and returns a token for a later HTTP request.

### HARD-A2-012

ID: HARD-A2-012
Route: Product/inventory price-tag print via `POST /api/printing/labels/connector`
Feature: Connector label printing
Severity: P1
Role: Authorized product/inventory operator at a connector-configured store
Viewport: All
Reproduction: Configure `labelPrintMode = CONNECTOR`, pair an active connector device, and submit a label-print request.
Expected: A connector print job is queued/dispatched and the route returns success.
Actual: After confirming the connector is ready, `printLabels` unconditionally throws `printerConnectorNotImplemented`; label connector printing cannot succeed.
Root cause hypothesis: The adapter implements PDF generation and connector readiness checks, but not connector queue dispatch.
Files/components: `src/server/printing/adapter.ts`; `src/app/api/printing/labels/connector/route.ts`; product/inventory quick-print call sites
Evidence: `adapter.ts:150-156` calls `assertConnectorReady` and immediately throws. No connector success-path test for labels was found.

### HARD-A2-013

ID: HARD-A2-013
Route: `/settings/attributes`, `/products/new`, `/products/[id]`; tRPC `attributes.update`
Feature: Attribute key/type evolution and current variant state
Severity: P1
Role: Manager/Admin
Viewport: All
Reproduction: Create attribute `color`, save variants with `ProductVariant.attributes.color`, then edit the definition key to `colour` (or incompatibly change its type/options); reopen the product editor.
Expected: Existing variant values are transactionally migrated/validated, or an in-use key/type change is blocked with a clear message.
Actual: The definition is updated directly. SQL foreign keys cascade normalized `VariantAttributeValue`/template keys, but `ProductVariant.attributes` JSON remains keyed by `color`; the product form and import serializers can present missing/stale characteristics under the new definition. Mutation and audit writes also are not wrapped in one transaction.
Root cause hypothesis: Attribute data has normalized and JSON representations, but `attributes.update` updates only `AttributeDefinition`.
Files/components: `src/server/trpc/routers/attributes.ts`; `src/components/product-form.tsx`; `src/server/services/products.ts`; `prisma/schema.prisma`; attribute migrations
Evidence: `attributes.ts:119-146` updates the definition then independently writes audit with no variant JSON migration. Schema lines `2716-2764` show the definition/value relations while product variants also store JSON. Migrations use `ON UPDATE CASCADE` only for relational keys, not JSON.

### HARD-A2-014

ID: HARD-A2-014
Route: `/products`, `/inventory`, `/inventory/counts`, `/settings/import`
Feature: Large-list pagination and performance budgets
Severity: P2
Role: All allowed roles with many records
Viewport: All
Reproduction: Seed tens of thousands of products/snapshots/counts/import batches; search products or choose a computed product/inventory sort, then open counts/import history.
Expected: Bounded server pagination and predictable response size/time.
Actual: Product search and computed sorts load every matching product before slicing; inventory `minStock`/`lowStock`/`suggestedOrder` full sorts omit `take/skip`; stock-count and import-batch list procedures return all rows and paginate only after transfer (counts via `ResponsiveDataList`).
Root cause hypothesis: Relevance/computed sorting and simple history pages were implemented in memory instead of with bounded queries/materialized sort keys/cursors.
Files/components: `src/server/services/products/read.ts`; `src/server/trpc/routers/inventory.ts`; `src/server/trpc/routers/stockCounts.ts`; `src/server/services/imports.ts`; `src/components/responsive-data-list.tsx`
Evidence: Product read `965-998` makes every search non-database-paginated and runs an unbounded `findMany`. Inventory router `519-529` omits `skip/take` for full-sort keys; its low-stock branch also omits SQL pagination when full sorting. Stock counts `48-59` and imports service `201-213` have no pagination input/take.

### HARD-A2-015

ID: HARD-A2-015
Route: `/products`
Feature: Desktop readiness filters
Severity: P2
Role: All product-list roles
Viewport: 768/tablet, 1440 desktop, large desktop
Reproduction: Open the products page at desktop width and inspect the readiness dropdown; compare with the mobile readiness chips or submit the supported `missingImage`/`outOfStock` states programmatically.
Expected: Desktop users can select every supported readiness filter, including missing image and out of stock.
Actual: The desktop select offers all, missing barcode, missing price, low stock, and negative stock, but omits missing image and out of stock. Mobile exposes both.
Root cause hypothesis: The desktop dropdown was not updated when mobile readiness shortcuts/schema were extended.
Files/components: `src/app/(app)/products/page.tsx`; `src/server/trpc/routers/products.schemas.ts`
Evidence: Product page `3388-3396` lacks both options, while `3487-3512` renders mobile buttons and the readiness enum supports them.

### HARD-A2-016

ID: HARD-A2-016
Route: `/products` test gate
Feature: Mobile product regression harness
Severity: P2
Role: NA
Viewport: Mobile source assertion
Reproduction: Run `tests/unit/mobile-products-source.test.ts` at the baseline commit.
Expected: The test follows the extracted duplicate-dialog component or behavior-level rendering and passes when the dialog remains a mobile sheet.
Actual: The assertion searches only `products/page.tsx` for the literal `mobileSheet`; the dialog was extracted to `src/components/products/product-duplicate-dialog.tsx`, where `mobileSheet` is still present, so the source-string test fails despite preserved behavior.
Root cause hypothesis: Commit `1f0cc2f` extracted `ProductDuplicateDialog` but did not update this older source-string assertion; the baseline full run reported 113 passing files and 2 failed files.
Files/components: `tests/unit/mobile-products-source.test.ts`; `src/app/(app)/products/page.tsx`; `src/components/products/product-duplicate-dialog.tsx`
Evidence: Test line `22` asserts `source` from `products/page.tsx` contains `mobileSheet`; the page now renders `ProductDuplicateDialog`, and its component line `147` supplies `mobileSheet`. Local execution in this worktree was `NOT_RUN` because dependencies are not installed; Agent 4 independently reproduced the baseline failure.

### HARD-A2-017

ID: HARD-A2-017
Route: `/inventory/receiving` round-trip through `/products/new` or `/products/[id]`
Feature: Receiving draft isolation on shared browsers
Severity: P0
Role: Sequential users sharing one browser session
Viewport: All
Reproduction: User A starts receiving and chooses create/edit/duplicate product, leaving the generated `receivingDraftKey` in browser history/session storage; sign out without closing the tab/session, sign in as User B, and revisit the return URL.
Expected: Draft data is namespaced to User A and organization A, rejected for User B, and removed after restore/completion/expiry.
Actual: The session-storage key contains only a random draft token; the stored payload includes store, supplier, reference, note, product lines, prices/quantities and focus state but no user/organization identity or expiry. Restore blindly hydrates it, and no removal path was found.
Root cause hypothesis: Draft persistence was designed for same-user navigation continuity, not account switching on shared terminals.
Files/components: `src/components/inventory/receiving-workflow.tsx`; authentication/sign-out integration (shared ownership)
Evidence: `receiving-workflow.tsx:91-167` defines an unscoped prefix/read/write payload, `:283-311` restores without identity validation, and searches found no `sessionStorage.removeItem` for these drafts.

## 7. Business-flow control assessment

| Control | Status | Assessment |
|---|---|---|
| Authentication | PASS | owned tRPC procedures are protected/role procedures; HTTP routes require a server auth token |
| Authorization/RBAC | FAIL | P0 manager initial-variant-stock bypass; label routes accept any authenticated role |
| Organization scope | PASS | inspected core reads/mutations generally constrain organization, often via store relation |
| Assigned-store scope | FAIL | count/lot/snapshot helper, product/price mutation, pricing, category removal, and print gaps |
| Input validation | FAIL | Zod bounds are broad and generally present; incompatible attribute evolution and draft identity are not validated |
| Transactionality | FAIL | native receiving/transfer/write-off/edit and import bodies are transactional; bulk set spans independent commits; attribute update/audit are split |
| Idempotency | FAIL | native stock documents/adjust/receive/transfer/apply/edit/archive use keys; product create/duplicate/import, bulk price increase, count create/scan and several metadata mutations do not |
| Audit history | FAIL | stock/product core writes usually log; initial variant inventory creates movements but no dedicated before/after audit entry, attribute mutation/audit is non-atomic, scan/count line edits do not write actor audit history |
| Retry behavior | FAIL | scan increments and additive imports/pricing reapply; image export is instance-local; no partial bulk reconciliation contract |
| User-facing errors | PASS | most tRPC services translate `AppError`/TRPC errors; runtime rendering is `NOT_RUN` |
| Raw provider/database errors | NOT_RUN | no runtime fault injection; some direct Prisma attribute writes rely on `toTRPCError` |
| Duplicate side effects | FAIL | import/create/duplicate/price and scan replay risks; native stock document keys are safer |
| Background job recovery | NA | no native Agent 2 stock/import job state machine; cross-owned AI jobs excluded |

## 8. Coverage matrix

### Roles

| Role | Static route/API review | Browser | Result |
|---|---|---|---|
| Admin | PASS for declared access; defects remain in replay/atomicity/export | NOT_RUN | FAIL |
| Manager | product/inventory/category/price paths reviewed | NOT_RUN | FAIL |
| Cashier | protected product/inventory/count/lot/print paths reviewed | NOT_RUN | FAIL |
| STAFF/limited/viewer where present | protected reads and naked HTTP token paths reviewed | NOT_RUN | FAIL |

### Viewports and themes

| Dimension | 390x844 | 414x896 | 768/tablet | 1440 | large desktop |
|---|---|---|---|---|---|
| Light | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Dark | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |

### Data states

| State | Static | Runtime/browser |
|---|---|---|
| empty | PASS (explicit empty branches found on principal lists) | NOT_RUN |
| one record | PASS | NOT_RUN |
| normal data | PASS | NOT_RUN |
| many records | FAIL (`HARD-A2-014`) | NOT_RUN |
| negative stock | PASS (explicit filter/display and ledger support) | NOT_RUN |
| missing price/cost/image | FAIL (desktop filter gap) | NOT_RUN |
| archived data | PASS (product/document/count archive/status branches found) | NOT_RUN |
| stale/incomplete job | NA for native Agent 2 flows | NOT_RUN for cross-owned AI jobs |
| invalid/deactivated relation | FAIL (attribute key/type evolution; later-chunk bulk invalidation) | NOT_RUN |

### UI states

| State | Static | Browser |
|---|---|---|
| loading/skeleton | PASS on principal pages | NOT_RUN |
| success | PASS branches found | NOT_RUN |
| empty | PASS branches found | NOT_RUN |
| validation error | PASS branches found | NOT_RUN |
| API error | PASS translated-error branches found on principal pages | NOT_RUN |
| retry | FAIL (replay defects; no consistent retry UI) | NOT_RUN |

### Actions

| Action | Static | Browser/runtime |
|---|---|---|
| create | FAIL (authorization/idempotency) | NOT_RUN |
| view | FAIL (cross-store reads) | NOT_RUN |
| edit | FAIL (scope/attribute evolution) | NOT_RUN |
| archive | FAIL (manager product scope; document archive otherwise statically PASS) | NOT_RUN |
| delete/cancel | FAIL (category scope; count store scope) | NOT_RUN |
| print | FAIL (store scope/connector unavailable) | NOT_RUN |
| export | FAIL (artifact ownership/deployment persistence) | NOT_RUN |
| navigate back with filters preserved | PASS statically for product return state and movement-journal URL; receiving draft has identity leak | NOT_RUN |

## 9. Existing tests and gaps

Relevant existing integration suites: `products.test.ts`, `inventory.test.ts`, `stock-counts.test.ts`, `attributes.test.ts`, and `imports.test.ts`. They cover core ledger correctness, receiving/transfer/write-off/edit/archive behavior, several idempotency paths, product CRUD/import, and one happy-path stock-count apply. Relevant unit/source tests cover mobile products, page wiring, category preferences, print flow, receiving round trips, movement routing, barcode/price-tag generation, and responsive lists.

Critical missing coverage:

1. Store-A-only Manager/Cashier negative tests for every stock-count, stock-lot, snapshot-ID, product mutation, price mutation/read, category removal, and print endpoint.
2. Manager API test proving variant `initialOnHand` is admin-only.
3. Response-loss/replay tests for product create/duplicate/import with stock, percentage/absolute store-price bulk updates, count scan increment, and count create.
4. Multi-chunk bulk-on-hand failure test proving no partial commit, or proving/documenting an explicit partial-result protocol.
5. Concurrent stock-count scan/set/apply/cancel tests; current suite has one admin happy-path apply/idempotency test.
6. Attribute key/type/options changes with populated variant JSON and normalized values, including audit failure atomicity.
7. Server-side pagination/load tests at realistic product/snapshot/count/import history volumes and warmed timing evidence against budgets.
8. Image ZIP artifact ownership, TTL, multi-instance persistence, missing image/oversized image, abort/disconnect, and concurrent export tests.
9. Label connector success-path test and role/store negative tests for both label HTTP routes.
10. Behavior/render tests for mobile duplicate dialog; update/remove the brittle same-file source assertion.
11. Draft isolation tests across logout/login, organization switch, history restore, expiry, and cleanup.
12. Browser tests for every owned route at all required viewports/themes and empty/loading/error/retry states; none were run in Phase A.
13. Print visual regression for A4 receiving/transfer/write-off and CSV/XLSX import/count/product exports.

## 10. Proposed implementation batches

### Batch A2-P0-1 — close store/RBAC boundaries

- Centralize product/store/count/lot/snapshot/print assertions using `assertUserCanAccessStore` and accessible product assignment predicates.
- Pass authenticated user context into product/store-price/category services; validate source and every target store inside the transaction.
- Bind export artifacts to creator and organization.
- Add an explicit server-side guard across top-level and per-variant initial stock.
- Add table-driven ADMIN/MANAGER/CASHIER/STAFF tests with two organizations and at least two same-org stores.

### Batch A2-P0-2 — replay and atomic stock/money operations

- Add request idempotency keys/fingerprints to product create/duplicate/import, store price bulk change, and stock-count scan/create as appropriate.
- Move import post-commit event handling to a reliable outbox/non-failing follow-up.
- Pre-validate the complete bulk-on-hand selection before any commit, then use one transaction or an explicit persisted batch/saga with partial status and safe resume.
- Add response-loss, concurrent, and later-chunk-failure integration tests.

### Batch A2-P0-3 — shared-browser draft isolation

- Namespace receiving drafts by organization/user, validate identity before hydrate, remove after successful restore/submit/cancel, add TTL/version cleanup, and scrub on sign-out/org switch.

### Batch A2-P1-1 — production print/export

- Persist ZIP artifacts in Redis/object storage with creator/org metadata, one-time atomic consume, TTL, size limits, and multi-instance tests.
- Implement connector label queue dispatch (or remove/disable the unsupported mode with an explicit availability state) and validate Preview/production printer behavior.

### Batch A2-P1-2 — attribute evolution

- Block in-use incompatible key/type changes or transactionally migrate `ProductVariant.attributes`, normalized values, templates, and audit record; add populated-data tests.

### Batch A2-P2-1 — scale and UX parity

- Replace full-load computed sorts/search with database-backed bounded pagination or materialized sortable data.
- Add server pagination to counts/import history.
- Add missing-image/out-of-stock desktop readiness options.
- Repair the extracted-component mobile regression test and add behavior-level coverage.

### Batch A2-P3-1 — polish after gates

- Perform the required viewport/theme/state browser matrix, accessibility pass, contact sheets, print visual comparisons, and warmed performance table; log any remaining polish issues separately.

## 11. Anticipated shared-file conflicts

| Shared area | Likely files | Coordination need |
|---|---|---|
| Auth/RBAC/store scoping | `src/server/services/storeAccess.ts`, `src/server/trpc/trpc.ts`, HTTP auth helpers | Agent 4 owns RBAC/platform validation; one writer and cross-review required |
| Prisma/idempotency/export persistence | `prisma/schema.prisma`, new migrations, `src/server/services/idempotency.ts`, Redis/storage config | schema/migration/package/config ownership must be scheduled; never use `db push` |
| Printing | `src/server/printing/adapter.ts`, connector queue/device services, printer settings | Agent 1 shares receipt connector; Agent 4 owns settings/platform; coordinate protocol changes |
| Product AI procedures | `products` router/schema/services and product form | Agent 3 owns AI descriptions/specs; isolate commits or agree file ownership before edits |
| Products used by integrations/orders/POS | product services/schema/read serializers | Agents 1 and 3 consume these contracts; cross-review access/payload changes |
| Inventory ledger consumed by POS/orders/purchase orders | `src/server/services/inventory.ts`, `StockMovement`, `InventorySnapshot` | Agents 1 and 3 must review movement/idempotency semantics; do not change their business logic silently |
| Global responsive/table/modal primitives | `ResponsiveDataList`, `Modal`, shared table and CSS/tokens | Agent 4 owns shared platform/UI; prefer local fixes or coordinated regression coverage |
| Translations | `messages/*.json` | shared-file owner required for new error/status/filter strings |
| App navigation | shell/sidebar/command palette | Agent 4 owns; Agent 2 should only request route-link changes through coordination |

## 12. Phase A conclusion

Static audit result: `FAIL`. Seventeen evidence-backed defects were recorded: eleven P0, three P1, and three P2. Browser/runtime verification remains `NOT_RUN`; no route is release-certified by this audit. The first implementation work should be the two P0 authorization/replay batches, independently verified by Agent 4 before integration.
