# Agent 3 Commerce Audit — Phase A

## Audit boundary and method

- Baseline: `4d7c9b33218b584334ca62f7a816f8997f144a10` on `hardening/agent-3-commerce`.
- Scope: sales orders, purchase orders, customers, suppliers, Bazaar API, order email actions, Email Marketing, sender domains, M-Market, Bakai Store, O! Market, AI descriptions/specifications, export validation, and integration job lifecycle.
- Method: static route/service/router/schema/test inspection only. No application code, schema, configuration, or test files were changed.
- Runtime status: browser QA, live database reproduction, external-provider calls, Preview deployment, screenshots, responsive/theme checks, console/network inspection, and performance measurements are `NOT_RUN`. External APIs were not called and no database was mutated.
- Evidence: durable source references are recorded in each defect below. No evidence exists only under ignored `tmp/`.

## Summary

Static inspection found 20 defects: 12 P0, 5 P1, and 3 P2. The highest-risk findings are API-order stock being deducted twice when the order is completed, cached revoked API credentials remaining usable, cross-store customer leakage, missing purchase-order and marketplace server authorization/store scope, optional/ambiguous API idempotency, and a UI labelled as a return flow that creates an ordinary sale.

## Owned route and UI inventory

| Route | Surface inventory | Primary files |
| --- | --- | --- |
| `/orders` | Compatibility redirect to `/sales/orders`. | `src/app/(app)/orders/page.tsx` |
| `/sales/orders` | Server-paginated order table; search/store/status filters; mobile filter sheet; single and bulk selection; complete/cancel actions; links to create, return, metrics, and detail. | `src/app/(app)/sales/orders/page.tsx` |
| `/sales/orders/new` | Store/customer/address/notes form; product picker; client-side draft lines; quantity editing; standard and `?mode=return` presentations. | `src/app/(app)/sales/orders/new/page.tsx` |
| `/sales/orders/[id]` | Current order document; customer editing; line add/update/remove; tracking form; confirmation/tracking email actions; confirm/ready/complete/cancel actions. | `src/app/(app)/sales/orders/[id]/page.tsx` |
| `/sales/orders/metrics` | Store/date/grouping controls, summary metrics, revenue/profit/cost series, top product/bundle views, loading state. | `src/app/(app)/sales/orders/metrics/page.tsx`, `loading.tsx` |
| `/purchase-orders` | Paginated purchase-order table/cards, selection, select-all-results, single cancel, concurrent bulk cancel, create/detail navigation. | `src/app/(app)/purchase-orders/page.tsx` |
| `/purchase-orders/new` | Store/supplier/product form, line quantities/cost/unit/pack selection, create draft or create-and-submit. | `src/app/(app)/purchase-orders/new/page.tsx` |
| `/purchase-orders/[id]` | Current PO document; line add/update/remove; submit/approve/receive/cancel; receiving form; PDF print/download. | `src/app/(app)/purchase-orders/[id]/page.tsx`, `src/app/api/purchase-orders/[id]/pdf/route.ts` |
| `/customers` | Store/search/source filters; paginated table/mobile cards; create/edit modal; detail sheet with recent orders; soft delete. | `src/app/(app)/customers/page.tsx` |
| `/customers/new` | Entry route into customer creation. | `src/app/(app)/customers/new/page.tsx` |
| `/suppliers` | Organization supplier table/cards; create/edit dialog; delete and bulk delete; query-string create state. | `src/app/(app)/suppliers/page.tsx` |
| `/suppliers/new` | Entry route into supplier creation. | `src/app/(app)/suppliers/new/page.tsx` |
| `/operations/integrations` | Integration landing/cards and navigation. | `src/app/(app)/operations/integrations/page.tsx` |
| `/operations/integrations/bazaar-api` | Accessible-store selector; API-key list/create/revoke; one-time token display; API usage examples. | `src/app/(app)/operations/integrations/bazaar-api/page.tsx` |
| `/operations/integrations/email-marketing` | Campaign workspace; builder blocks; preview; customer audience and product pickers; sender/domain setup; logo upload/gallery; drafts/history/automation controls; test/send/resume/archive/delete. | `src/app/(app)/operations/integrations/email-marketing/page.tsx`, `workspace.tsx`, `builder-utils.ts` |
| `/operations/integrations/m-market` | Connection/token; branch mappings; selected-product table; preflight; AI description/spec/category/template actions; all/ready-only export; job history/error report. | `src/app/(app)/operations/integrations/m-market/page.tsx` |
| `/operations/integrations/bakai-store` | Connection mode/token; workbook template upload/download; stock and branch mappings; product selection; AI descriptions; workbook/API preflight; export/API sync; jobs/workbook/error reports. | `src/app/(app)/operations/integrations/bakai-store/page.tsx` |
| `/operations/integrations/o-market` | Connection/token/base URL; store/category mappings; product selection; preflight; product export/ready-only/stock-price/full sync; jobs/error report. | `src/app/(app)/operations/integrations/o-market/page.tsx` |

Product-page AI entry points are adjacent owned behavior, not ownership of the full `/products` route: availability, one-product generation, bulk generation, asynchronous generation progress, and failed-item retry in `src/server/trpc/routers/products.ts`.

## Owned HTTP API inventory

| Endpoint | Methods | Responsibility |
| --- | --- | --- |
| `/api/bazaar/v1/products` | GET | API-key product/variant/price/stock catalogue with pagination/search. |
| `/api/bazaar/v1/orders` | GET, POST | API-key order listing and order creation with immediate stock deduction. |
| `/api/bazaar/v1/orders/[id]` | GET | API order lookup by internal ID, number, or external ID. |
| `/api/bazaar/v1/customers` | POST | API-key customer creation/upsert. |
| `/api/purchase-orders/[id]/pdf` | GET | Authenticated PO PDF/print artifact. |
| `/api/email-marketing/logo` | POST | Marketing logo upload. |
| `/api/email-marketing/unsubscribe` | GET, POST | Signed unsubscribe landing/action. |
| `/api/email-marketing/resend-webhook` | POST | Resend signature verification and delivery event ingestion. |
| `/api/m-market/jobs/[id]/error-report` | GET | M-Market job error artifact. |
| `/api/bakai-store/template` | GET, POST | Template download/upload. |
| `/api/bakai-store/jobs/[id]/workbook` | GET | Generated workbook artifact. |
| `/api/bakai-store/jobs/[id]/error-report` | GET | Bakai job error artifact. |
| `/api/o-market/jobs/[id]/error-report` | GET | O! Market job error artifact. |
| `/api/jobs/run` | POST | Secret-authenticated job runner relevant to email, marketplace, and AI job recovery. |

## Owned tRPC inventory

- `salesOrders`: `metrics`, `list`, `getById`, `createDraft`, `setCustomer`, `updateTracking`, `sendEmail`, `addLine`, `updateLine`, `removeLine`, `confirm`, `markReady`, `complete`, `cancel`.
- `purchaseOrders`: `list`, `listIds`, `getById`, `create`, `createFromReorder`, `submit`, `approve`, `receive`, `cancel`, `addLine`, `updateLine`, `removeLine`.
- `customers`: `list`, `detail`, `create`, `update`, `delete`, `previewImport`, `importRows`.
- `suppliers`: `list`, `create`, `update`, `delete`, `bulkDelete`.
- `bazaarApi`: `listStores`, `apiKeys`, `createApiKey`, `revokeApiKey`.
- `emailMarketing`: `logoGallery`, `senders`, `createSender`, `checkSenderDomain`, `archiveSender`, `overview`, `preview`, `audiencePreview`, `customers`, `products`, `sendTest`, `saveDraft`, `send`, `sendCampaign`, `resumeCampaign`, `duplicateCampaign`, `archiveCampaign`, `deleteCampaignDraft`, `history`, `detail`, `automations`, `updateAutomation`, `testAutomation`.
- `mMarket`: `overview`, `settings`, `revealToken`, `validateLocal`, `saveConnection`, `saveBranchMappings`, `products`, `listIds`, `updateProducts`, `preflight`, `bulkGenerateDescriptions`, `startDescriptionGenerationJob`, `bulkAutofillSpecs`, `bulkCreateBaseTemplates`, `assignMissingCategory`, `exportNow`, `exportReadyNow`, `jobs`, `getJob`.
- `bakaiStore`: `overview`, `settings`, `revealToken`, `saveSettings`, `testConnection`, `saveMappings`, `saveBranchMappings`, `products`, `listIds`, `updateProducts`, `startDescriptionGenerationJob`, `preflight`, `apiPreflight`, `exportNow`, `exportReadyNow`, `apiSyncNow`, `apiSyncReadyNow`, `jobs`, `getJob`.
- `oMarket`: `overview`, `settings`, `revealToken`, `saveSettings`, `testConnection`, `saveStoreMappings`, `saveCategoryMappings`, `products`, `listIds`, `updateProducts`, `preflight`, `exportNow`, `exportReadyNow`, `syncStockPriceNow`, `fullSyncNow`, `jobs`, `getJob`.
- Adjacent `products` AI procedures: `descriptionGenerationAvailability`, `generateDescription`, `bulkGenerateDescriptions`, `startDescriptionGenerationJob`, `descriptionGenerationJob`, `retryDescriptionGenerationJobFailed`.

## Background job inventory and lifecycle audit

| Job/worker | Observed states and dispatch | Recovery/retry audit |
| --- | --- | --- |
| Email campaign send | Campaign `DRAFT/SENDING/SENT/FAILED/PARTIAL`; recipient `PENDING/SENT/FAILED/SKIPPED`; registered centrally as `email-campaign-send`. | Framework retries three times/dead-letters. Resume is limited to `SENDING`; no explicit stale campaign watchdog was found. |
| Customer order follow-up | Central `customer-order-follow-up` job; uses delivery timestamps/logs/provider idempotency. | Framework retries three times/dead-letters. Runtime behavior `NOT_RUN`. |
| M-Market export | `QUEUED/RUNNING/DONE/FAILED/RATE_LIMITED`; request creates a row then starts `runJob` in-process. | Only stale `RUNNING` rows time out; `QUEUED` rows are not recovered. No user retry endpoint; new export is the only retry-like action. |
| Bakai workbook export/API sync | `QUEUED/RUNNING/DONE/FAILED`; two service-local registered jobs, started in-process. | Only stale `RUNNING` rows time out. A stale `QUEUED` row is considered active and can block later requests. |
| O! Market export/sync | `QUEUED/RUNNING/DONE/FAILED`; one service-local registered job, started in-process. | Only stale `RUNNING` rows time out. A stale `QUEUED` row is considered active and can block later requests. |
| Product description generation | Job `QUEUED/PROCESSING/DONE/DONE_WITH_ERRORS/FAILED/CANCELLED`; items `PENDING/PROCESSING/SUCCESS/FAILED/SKIPPED/CANCELLED`; service-local registration and in-process start. | Contains stale queued/processing recovery and failed-item retry, but the generic job route does not import/register this worker in a fresh runtime. |

## RBAC and scoping inventory

| Surface | Intended/static route access | Server implementation finding |
| --- | --- | --- |
| Sales orders | `viewSales`: Admin, Manager, Staff, Cashier; complete/cancel/metrics Manager/Admin. | Sales router generally enforces organization, accessible store, plan feature, and manager-only finalization. Product assignment validation has a P0 gap (HARD-A3-009). |
| Purchase orders/suppliers | `viewPurchaseOrders`/`viewSuppliers`: Admin, Manager. | Purchase-order reads and supplier list use generic `protectedProcedure`; purchase mutations/PDF do not enforce actor store access (HARD-A3-007). |
| Customers | `manageCustomers`: Admin, Manager. | Router role gate exists, but list/detail/dedupe/recent orders leak across a store-limited manager's store boundary (HARD-A3-006). |
| Integration UI | `manageIntegrations`: Admin, Manager. | Marketplace read procedures/artifact GETs use generic authentication and marketplace store selection validates organization ownership only (HARD-A3-008). |
| Bazaar API key management | Admin/Manager UI and router; accessible-store checks. | Key creation/list scope is present; cached authentication bypasses revocation temporarily (HARD-A3-002). |
| Email Marketing | Manager/Admin procedures with per-store checks in core services. | Primary store checks are present; idempotency/suppression/content-validation gaps remain. |

## Relevant data-model inventory

- Orders/stock: `CustomerOrder`, `CustomerOrderLine`, `CustomerOrderEmailLog`, `CustomerOrderStatus`, `CustomerOrderSource`, `SalePayment`, `StockMovement`, `InventorySnapshot`, `OrganizationCounter`, `IdempotencyKey`.
- Purchasing/parties: `PurchaseOrder`, `PurchaseOrderLine`, `PurchaseOrderStatus`, `Supplier`, `Customer`.
- API: `BazaarApiKey` plus order/product/variant/store price/stock models.
- Email: `EmailCampaign`, `EmailCampaignRecipient`, `EmailMarketingLogo`, `EmailSenderDomain`, `EmailSenderIdentity`, `EmailAutomation`, `EmailAutomationDelivery`.
- Marketplaces: `MMarketIntegration`, `MMarketBranchMapping`, `MMarketExportJob`, `MMarketIncludedProduct`; `BakaiStoreIntegration`, `BakaiStoreStockMapping`, `BakaiStoreBranchMapping`, `BakaiStoreExportJob`, `BakaiStoreIncludedProduct`, `BakaiStoreProductSyncState`; `OMarketIntegration`, `OMarketStoreMapping`, `OMarketCategoryMapping`, `OMarketExportJob`, `OMarketIncludedProduct`, `OMarketProductSyncState`.
- AI/catalog inputs: `ProductDescriptionGenerationJob`, `ProductDescriptionGenerationItem`, `Product`, `StoreProduct`, `ProductVariant`, `StorePrice`, `ProductCost`, `AttributeDefinition`, `CategoryAttributeTemplate`, `VariantAttributeValue`.
- Shared governance: `Organization`, `Store`, `User`, `UserStoreAccess`, `AuditLog`, `DeadLetterJob`.

## Defects

### HARD-A3-001 — API order stock is deducted again on completion

- **ID:** HARD-A3-001
- **Route:** `POST /api/bazaar/v1/orders` then `/sales/orders/[id]`
- **Feature:** API order stock deduction and order completion
- **Severity:** P0
- **Role:** API key; then Admin or Manager
- **Viewport:** API / all UI viewports
- **Reproduction:** Create an API order for quantity 1, progress its `CONFIRMED` status through `READY`, then complete it in Sales Orders. Inspect stock and `StockMovement` rows.
- **Expected:** The sale deducts one unit exactly once over the complete lifecycle.
- **Actual:** API creation deducts one unit immediately, and completion deducts a second unit.
- **Root cause hypothesis:** Confirmed static root cause: API creation calls a movement-aware deduction, while generic completion always appends new `SALE` movements without recognizing the API order's existing movements.
- **Files/components:** `src/server/services/bazaarApi.ts`, `src/server/services/salesOrders.ts`, `prisma/schema.prisma`
- **Evidence:** `bazaarApi.ts:1372-1410` creates a `CONFIRMED` order and calls `applyBazaarApiOrderStockDeduction`; `salesOrders.ts:1196-1259` completes any eligible order and applies `qtyDelta: -line.qty`. `StockMovement` has no uniqueness constraint on order/line references (`schema.prisma:1625-1651`). Existing Bazaar API tests do not complete a created API order.

### HARD-A3-002 — Revoked Bazaar API credentials remain valid from cache

- **ID:** HARD-A3-002
- **Route:** `/operations/integrations/bazaar-api`; all Bazaar API GET endpoints
- **Feature:** API key revocation/authentication
- **Severity:** P0
- **Role:** Manager/Admin revokes; revoked API client continues access
- **Viewport:** API / all management viewports
- **Reproduction:** Authenticate a GET to warm the credential cache, revoke that key, then issue another GET with the same token before the cache TTL expires.
- **Expected:** Revocation is effective immediately for every request.
- **Actual:** A cached GET auth context is returned without re-reading `revokedAt`, for up to the default 30-minute TTL.
- **Root cause hypothesis:** Confirmed static root cause: revocation updates the database but does not evict the token-hash cache; GET authentication returns the cached context before querying the key.
- **Files/components:** `src/server/services/bazaarApi.ts`, `src/server/trpc/routers/bazaarApi.ts`
- **Evidence:** `bazaarApi.ts:34`, `606-649`, and `651-713` show the 30-minute default, revocation without eviction, and cache-first GET authentication. No cache invalidation call for revoked credentials was found.

### HARD-A3-003 — API order retries are unsafe when `externalId` is omitted

- **ID:** HARD-A3-003
- **Route:** `POST /api/bazaar/v1/orders`
- **Feature:** Order creation idempotency
- **Severity:** P0
- **Role:** API key
- **Viewport:** API
- **Reproduction:** Submit a valid order without `externalId`, simulate a lost response, and retry the identical request.
- **Expected:** A retry key is required or the retry resolves to the original order with no second stock/email side effect.
- **Actual:** `externalId` is optional and no `Idempotency-Key` is accepted, so each request creates a new confirmed order and deducts stock again.
- **Root cause hypothesis:** Confirmed static root cause: idempotency is conditional on an optional body field rather than a required, persisted request key.
- **Files/components:** `src/app/api/bazaar/v1/orders/route.ts`, `src/server/services/bazaarApi.ts`, `prisma/schema.prisma`
- **Evidence:** `orders/route.ts:12-29` declares optional `externalId`; `123-143` does not read an idempotency header. `bazaarApi.ts:1191-1203` makes the field optional and `1372-1419` creates the order, stock, and customer effects.

### HARD-A3-004 — Internal sales and standard purchase-order creation are not idempotent

- **ID:** HARD-A3-004
- **Route:** `/sales/orders/new`; `/purchase-orders/new`
- **Feature:** Draft/document creation and PO on-order quantity
- **Severity:** P0
- **Role:** Staff/Cashier/Manager/Admin for sales draft; Manager/Admin for PO
- **Viewport:** All
- **Reproduction:** Double-submit or retry `salesOrders.createDraft`; separately retry `purchaseOrders.create` with `submit: true` after a lost response.
- **Expected:** One logical submission creates one document and one set of inventory-side effects.
- **Actual:** Each retry creates another document; submitted PO retries also repeat `onOrder` adjustments.
- **Root cause hypothesis:** Confirmed static root cause: these create procedures do not accept/use an idempotency key, although completion, receiving, and reorder creation do.
- **Files/components:** `src/server/trpc/routers/salesOrders.ts`, `src/server/services/salesOrders.ts`, `src/server/trpc/routers/purchaseOrders.ts`, `src/server/services/purchaseOrders.ts`
- **Evidence:** `salesOrders.ts` router `178-216` and service `579-621` create without idempotency. Purchase router `144-179` and service `142-270` create without idempotency; submitted creation adjusts on-order quantities at service lines `242-252`.

### HARD-A3-005 — External order IDs can collide by substring

- **ID:** HARD-A3-005
- **Route:** `POST /api/bazaar/v1/orders`; `GET /api/bazaar/v1/orders`; `GET /api/bazaar/v1/orders/[id]`
- **Feature:** External order identity, replay, lookup, filtering
- **Severity:** P0
- **Role:** API key
- **Viewport:** API
- **Reproduction:** Create external ID `EXT-10`, then create or fetch `EXT-1` in the same store.
- **Expected:** External IDs compare exactly and are uniquely enforced within the API key/store scope.
- **Actual:** The shorter ID can match the longer ID's notes text and return/replay the wrong order.
- **Root cause hypothesis:** Confirmed static root cause: external identity is encoded into free-form `notes` and queried with substring `contains`; there is no dedicated indexed/unique external ID column.
- **Files/components:** `src/server/services/bazaarApi.ts`, `prisma/schema.prisma`
- **Evidence:** `bazaarApi.ts:55-58` constructs the marker; `959-982` and `1242-1277` query `notes: { contains: marker }`. `CustomerOrder` has no API external-ID field/unique constraint (`schema.prisma:1706-1784`).

### HARD-A3-006 — Customer records, dedupe, and order history cross store boundaries

- **ID:** HARD-A3-006
- **Route:** `/customers`; customer import; all order-to-customer upserts
- **Feature:** Customer privacy, store-scoped dedupe, metrics, recent orders
- **Severity:** P0
- **Role:** Store-limited Manager
- **Viewport:** All
- **Reproduction:** Give a manager access only to Store A; create the same email in Store B; list/open customers from Store A or create an order in Store A with that email.
- **Expected:** Only Store A customers/orders are visible and Store A gets its own customer record.
- **Actual:** List/detail searches the whole organization, recent orders are not scoped to accessible stores, and order upsert can update Store B's customer instead of creating Store A's.
- **Root cause hypothesis:** Confirmed static root cause: `storeId` is validated but omitted from customer lookup/list/detail matching queries; dedupe helpers accept only organization ID.
- **Files/components:** `src/server/services/customers.ts`, `src/server/trpc/routers/customers.ts`, `tests/integration/customers.test.ts`, `docs/customer-database-plan.md`
- **Evidence:** `customers.ts:266-348`, `427-541`, and `1035-1090` omit store scope from lookup/list/detail/recent orders/upsert. The design contract explicitly requires same-store matching and isolation (`customer-database-plan.md:19-46`, `86`, `106-109`), while current tests assert organization-wide dedupe/shared visibility.

### HARD-A3-007 — Purchase-order and supplier authorization is only enforced in navigation

- **ID:** HARD-A3-007
- **Route:** `/purchase-orders*`; `/suppliers*`; `GET /api/purchase-orders/[id]/pdf`
- **Feature:** PO/supplier RBAC, store scope, receiving, PDF confidentiality
- **Severity:** P0
- **Role:** Staff/Cashier; store-limited Manager
- **Viewport:** API / all UI viewports
- **Reproduction:** Call PO list/detail or supplier list as Staff/Cashier; as a manager assigned only Store A, pass a Store B PO/store ID to create, mutate, receive, cancel, or download its PDF.
- **Expected:** Staff/Cashier are denied, and managers can read/mutate only assigned stores.
- **Actual:** Generic authentication exposes PO and supplier reads; purchase operations and PDF enforce organization only, permitting cross-store access and stock mutation.
- **Root cause hypothesis:** Confirmed static root cause: route permissions are not mirrored by router/API policies, and PO services are invoked without `assertUserCanAccessStore` on the actor.
- **Files/components:** `src/lib/roleAccess.ts`, `src/server/trpc/routers/purchaseOrders.ts`, `src/server/trpc/routers/suppliers.ts`, `src/server/services/purchaseOrders.ts`, `src/app/api/purchase-orders/[id]/pdf/route.ts`
- **Evidence:** `roleAccess.ts:39-83` and `106-124` reserve PO/supplier UI for Admin/Manager. PO `list/listIds/getById` use `protectedProcedure` and organization-only filters (`purchaseOrders.ts:23-142`); mutations pass organization but no actor store assertion (`144-365`). Supplier `list` is protected (`suppliers.ts:12-18`). PDF checks only token organization (`route.ts:116-147`).

### HARD-A3-008 — Marketplace server APIs and artifacts bypass integration/store permissions

- **ID:** HARD-A3-008
- **Route:** `/operations/integrations/{m-market,bakai-store,o-market}` and their artifact endpoints
- **Feature:** Integration RBAC, mappings, selected products, provider responses, exports
- **Severity:** P0
- **Role:** Staff/Cashier; store-limited Manager
- **Viewport:** API / all UI viewports
- **Reproduction:** As Staff/Cashier call marketplace overview/settings/products/preflight/jobs/getJob or download a known job artifact; as a Store A manager submit Store B to marketplace mutations.
- **Expected:** Integration access requires Admin/Manager and every store-specific read/write is limited to accessible stores.
- **Actual:** Multiple procedures and artifact GETs require only authentication/organization; service store resolution accepts any organization store.
- **Root cause hypothesis:** Confirmed static root cause: the UI route uses `manageIntegrations`, but marketplace routers use `protectedProcedure`, download routes check only organization, and service context helpers do not receive the user.
- **Files/components:** `src/lib/roleAccess.ts`, `src/server/trpc/routers/mMarket.ts`, `bakaiStore.ts`, `oMarket.ts`, corresponding services, and marketplace artifact routes
- **Evidence:** Integration UI is gated at `roleAccess.ts:119`. Protected reads appear at `mMarket.ts:29-43,112-160,186-194,339-367`, `bakaiStore.ts:28-42,140-185,242-260,328-356`, and `oMarket.ts:24-37,138-180,212-231,302-320`. Store helpers validate only organization (`services/mMarket.ts:359-385`, `bakaiStore.ts:761-787`, `oMarket.ts:498-523`). Artifact routes query by `token.organizationId` without role/store assertions.

### HARD-A3-009 — Manual sales orders accept products not assigned to the order store

- **ID:** HARD-A3-009
- **Route:** `/sales/orders/new`; `/sales/orders/[id]`; `salesOrders.createDraft/addLine`
- **Feature:** Product picker enforcement and store stock integrity
- **Severity:** P0
- **Role:** Staff/Cashier/Manager/Admin with order-store access
- **Viewport:** API / all UI viewports
- **Reproduction:** Call the tRPC mutation directly with an organization product that is inactive/unassigned in the order store, then complete the order.
- **Expected:** The server rejects products not active and assigned to that store.
- **Actual:** The service accepts the product and later deducts it from the order store, potentially creating incorrect/negative stock for an unavailable item.
- **Root cause hypothesis:** Confirmed static root cause: UI quick search is store-filtered, but `resolveUnitPrice` validates only product organization/deletion and variant activity, not `StoreProduct` assignment/activity or catalogue hiding.
- **Files/components:** `src/server/services/salesOrders.ts`, `src/server/trpc/routers/salesOrders.ts`, product/store assignment models
- **Evidence:** `salesOrders.ts:149-198` lacks a store-assignment query; draft and add-line paths call it (`579-630`, `850-883`); completion deducts from the order store (`1196-1259`).

### HARD-A3-010 — Bazaar API product price/stock cache has no mutation invalidation

- **ID:** HARD-A3-010
- **Route:** `GET /api/bazaar/v1/products`
- **Feature:** API product availability, price, stock
- **Severity:** P0
- **Role:** API key
- **Viewport:** API
- **Reproduction:** Warm a product response, then change price, stock, archive state, or store assignment and repeat the same request inside 30 minutes.
- **Expected:** Commerce-critical product availability, price, and stock reflect committed mutations promptly.
- **Actual:** The full response can remain stale until TTL expiry, exposing old price/stock or products no longer saleable.
- **Root cause hypothesis:** Confirmed static root cause: response-level cache defaults to 30 minutes and no product/inventory mutation invalidation path was found.
- **Files/components:** `src/server/services/bazaarApi.ts`, shared product/inventory mutation services, cache configuration
- **Evidence:** `bazaarApi.ts:35`, `716-736`, and `930-955` cache a result containing price and stock. Repository search found no invalidation for `bazaar-api:products:v1:*`.

### HARD-A3-011 — The advertised return mode creates an ordinary sale

- **ID:** HARD-A3-011
- **Route:** `/sales/orders/new?mode=return`
- **Feature:** Returns/refunds and stock direction
- **Severity:** P0
- **Role:** Staff/Cashier/Manager/Admin
- **Viewport:** All
- **Reproduction:** Open return mode, create the document, then progress it through the normal order detail flow to completion.
- **Expected:** A return references an original sale, validates returnable quantity/payment, records refund/audit data, and restores stock exactly once.
- **Actual:** Only the heading/hint changes; the page calls the standard `createDraft` mutation and creates a normal sale that completion deducts from stock.
- **Root cause hypothesis:** Confirmed static root cause: `isReturnMode` is presentation-only and is not represented in the mutation or domain model used by this page.
- **Files/components:** `src/app/(app)/sales/orders/new/page.tsx`, `src/server/trpc/routers/salesOrders.ts`, `src/server/services/salesOrders.ts`, translations; coordinate with Agent 1 return ownership
- **Evidence:** `new/page.tsx:61`, `87-95`, `205-233`, and `244-252` show the same mutation/payload. English copy states that return mode currently creates a draft without stock movement (`messages/en.json:4329-4330`), but the draft remains completable as a sale.

### HARD-A3-012 — Bulk PO cancellation can irreversibly partially succeed

- **ID:** HARD-A3-012
- **Route:** `/purchase-orders`
- **Feature:** Bulk destructive action and on-order restoration
- **Severity:** P0
- **Role:** Manager/Admin
- **Viewport:** All
- **Reproduction:** Select multiple cancelable POs and make one cancellation fail after another has succeeded (stale status, injected server error, or concurrency).
- **Expected:** The bulk action is atomic, or it returns a durable per-item outcome that clearly preserves/reconciles partial state.
- **Actual:** Independent cancellations run concurrently; one rejection shows a generic error after other POs may already be irreversibly canceled.
- **Root cause hypothesis:** Confirmed static root cause: the client implements a destructive bulk operation as `Promise.all` over single-item mutations with no server transaction, operation ID, or reconciliation result.
- **Files/components:** `src/app/(app)/purchase-orders/page.tsx`, `src/server/trpc/routers/purchaseOrders.ts`, `src/server/services/purchaseOrders.ts`
- **Evidence:** `purchase-orders/page.tsx:149-190` fetches candidate IDs, then runs `Promise.all` across `purchaseOrders.cancel`. No bulk cancellation procedure exists.

### HARD-A3-013 — Marketplace and AI jobs are not durably dispatched and queued jobs can stick

- **ID:** HARD-A3-013
- **Route:** Marketplace export/sync actions; AI description generation; `/api/jobs/run`
- **Feature:** Background job dispatch, stale recovery, retry
- **Severity:** P1
- **Role:** Manager/Admin; job runner
- **Viewport:** API / all integration viewports
- **Reproduction:** Terminate/recycle the request runtime after a job row is committed but before the fire-and-forget `runJob` completes; invoke the generic job route in a fresh runtime.
- **Expected:** A durable worker claims queued jobs, all registered job names are available to the runner, stale queued/running jobs recover, and retries are explicit.
- **Actual:** Requests launch in-process promises; the generic runner statically knows only cleanup/email/follow-up jobs unless a service happened to be imported; marketplace recovery times out only `RUNNING`, so `QUEUED` can remain forever and block Bakai/O! follow-up requests.
- **Root cause hypothesis:** Confirmed static root cause: persistence of job state is not coupled to durable queue dispatch, job registration is a service import side effect, and stale-queued recovery is incomplete.
- **Files/components:** `src/server/jobs/index.ts`, `src/app/api/jobs/run/route.ts`, `src/server/services/mMarket.ts`, `bakaiStore.ts`, `oMarket.ts`, `productDescriptionGenerationJobs.ts`
- **Evidence:** Central registry contains only three static jobs (`jobs/index.ts:195-211`) and unknown jobs skip (`224-260`). Service-local registration occurs at M-Market `3404`, Bakai `4008-4014`, O! Market `2268`, and AI `1324`. In-process dispatch appears at M-Market `3157-3165`, Bakai `3320`/`3419`, O! Market `1818-1827`, and AI `254-264`. Marketplace timeout queries only `RUNNING` (M-Market `2996-3004`, Bakai `3164-3172`, O! `1831-1839`).

### HARD-A3-014 — Marketplace partial exports are reported as full success

- **ID:** HARD-A3-014
- **Route:** M-Market/Bakai Store/O! Market ready-only export and job history
- **Feature:** Job terminal state and `completed_with_errors`
- **Severity:** P1
- **Role:** Manager/Admin
- **Viewport:** All integration viewports
- **Reproduction:** Run ready-only export with both valid and invalid selected products and inspect the job/integration terminal state.
- **Expected:** Exported plus skipped/failed products produce an explicit partial/completed-with-errors state and actionable report.
- **Actual:** Marketplace enums lack `COMPLETED_WITH_ERRORS`/`TIMED_OUT`; M-Market records `DONE` and integration `SUCCESS` while writing an error report for skipped invalid products, and Bakai/O! similarly collapse partial outcomes into `DONE` based on limited counters.
- **Root cause hypothesis:** Confirmed static root cause: marketplace lifecycle enums and update branches cannot represent the required terminal states.
- **Files/components:** `prisma/schema.prisma`, marketplace services/pages/translations
- **Evidence:** Marketplace job enums are defined at `schema.prisma:249-300` without partial/timed-out states. M-Market explicitly sets `DONE` while persisting a ready-only error report and `SUCCESS` (`mMarket.ts:3266-3310`). Timeout is represented as `FAILED` plus JSON flags in each service.

### HARD-A3-015 — New email campaign send is not idempotent

- **ID:** HARD-A3-015
- **Route:** `/operations/integrations/email-marketing`; `emailMarketing.send`
- **Feature:** Campaign creation and bulk delivery
- **Severity:** P1
- **Role:** Manager/Admin
- **Viewport:** All
- **Reproduction:** Double-submit the new campaign send mutation or retry after a response timeout.
- **Expected:** One logical send produces one campaign and at most one delivery per customer.
- **Actual:** Each call creates another `SENDING` campaign with its own recipients and kicks delivery, so recipients can receive duplicate campaigns.
- **Root cause hypothesis:** Confirmed static root cause: the mutation accepts no idempotency key and the service always creates a new campaign/recipient set for this path.
- **Files/components:** `src/server/trpc/routers/emailMarketing.ts`, `src/server/services/emailMarketing.ts`, campaign models
- **Evidence:** Router `emailMarketing.ts:449-468` has no operation key. Service `emailMarketing.ts:2980-3063` unconditionally creates a campaign and recipients. Saved-campaign send has a status-based transition, but this new-send path does not.

### HARD-A3-016 — Complaint webhooks do not suppress future marketing

- **ID:** HARD-A3-016
- **Route:** `POST /api/email-marketing/resend-webhook`; future Email Marketing audiences
- **Feature:** Abuse complaint suppression
- **Severity:** P1
- **Role:** Provider webhook; Manager/Admin future sender
- **Viewport:** API
- **Reproduction:** Ingest an `email.complained` event for a campaign recipient, then build a later audience containing the same customer.
- **Expected:** The customer/email is durably suppressed from future marketing sends.
- **Actual:** Only the current recipient is marked failed/complained; the customer unsubscribe/suppression field is unchanged, so the customer remains eligible.
- **Root cause hypothesis:** Confirmed static root cause: complaint handling updates only `EmailCampaignRecipient`, while audience filters rely on `Customer.emailMarketingUnsubscribedAt`.
- **Files/components:** `src/server/services/emailMarketing.ts`, `src/app/api/email-marketing/resend-webhook/route.ts`, `Customer`/recipient models
- **Evidence:** Audience filters require `emailMarketingUnsubscribedAt: null` (`emailMarketing.ts:1688-1721`). Complaint handling at `3416-3425` does not update the customer or a suppression list. Existing webhook tests cover delivery/bounce, not complaint suppression.

### HARD-A3-017 — API order confirmation email is fire-and-forget

- **ID:** HARD-A3-017
- **Route:** `POST /api/bazaar/v1/orders`
- **Feature:** Order confirmation email delivery/recovery
- **Severity:** P1
- **Role:** API key/customer
- **Viewport:** API
- **Reproduction:** Create an API order and recycle the serverless request runtime immediately after the response/transaction; inspect the email log and delivery.
- **Expected:** The committed order has a durable outbox/job with observable retry or a synchronous recorded outcome.
- **Actual:** Email sending is detached from the request with an unawaited promise; failure is only logged and has no durable retry state.
- **Root cause hypothesis:** Static deployment-risk root cause: a serverless request lifetime is being used as a background worker.
- **Files/components:** `src/server/services/bazaarApi.ts`, `src/server/services/orderEmails.ts`, email/job infrastructure
- **Evidence:** `bazaarApi.ts:1422-1440` publishes the event and calls `void sendOrderConfirmationEmail(...).catch(...)` after commit. No outbox/queued email record is created in this path. Runtime fault-injection remains `NOT_RUN`.

### HARD-A3-018 — Invalid custom button URLs can be sent with the button silently omitted

- **ID:** HARD-A3-018
- **Route:** `/operations/integrations/email-marketing`
- **Feature:** Custom email button URLs and validation
- **Severity:** P2
- **Role:** Manager/Admin
- **Viewport:** All
- **Reproduction:** Enter an invalid/custom unsupported URL in a hero/button/promo/product block and send after preview warnings.
- **Expected:** A button with text requires a valid URL before send, or the user explicitly confirms omission.
- **Actual:** Router schemas accept arbitrary strings, link checklist failures are non-critical, and the renderer omits invalid links.
- **Root cause hypothesis:** Confirmed static root cause: normalization validates URLs only during rendering/warnings, while send blocking does not treat invalid links as critical.
- **Files/components:** `src/server/trpc/routers/emailMarketing.ts`, `src/server/services/emailMarketing.ts`, email builder workspace
- **Evidence:** URL schemas are length-only (`emailMarketing.ts` router `66-105`, `126-135`, `168-197`). Warnings are produced at service `2133-2205`, but links are `critical: false` at `2230-2280`; renderers call `resolveEmailLinkUrl` and omit unresolved URLs.

### HARD-A3-019 — Owned tables do not meet filter persistence/pagination contracts

- **ID:** HARD-A3-019
- **Route:** `/sales/orders`; `/customers`; `/purchase-orders`; `/suppliers`
- **Feature:** Server tables, navigation persistence, large-data behavior
- **Severity:** P2
- **Role:** All roles permitted on each route
- **Viewport:** All
- **Reproduction:** Apply filters/page, open a record, navigate back; separately load many suppliers and try to search/page/sort POs or suppliers.
- **Expected:** Server search/filter/pagination/sorting are available where relevant and preserved through navigation.
- **Actual:** Sales/customer filters and page live only in component state; purchase orders expose no search/store/status/sort controls despite a status input; supplier list loads the full organization without server search/pagination.
- **Root cause hypothesis:** Confirmed static root cause: list state is not URL-backed and supplier/PO list contracts are incomplete.
- **Files/components:** owned list pages and `src/server/trpc/routers/purchaseOrders.ts`, `suppliers.ts`
- **Evidence:** Sales uses local state (`sales/orders/page.tsx:48-82`); customers use local filter/page state and search params only for `add=1` (`customers/page.tsx:65-100`); PO list sends only page/page size (`purchase-orders/page.tsx:55-64`); supplier router returns all rows (`suppliers.ts:12-18`).

### HARD-A3-020 — Bazaar API exposes unexpected internal error messages

- **ID:** HARD-A3-020
- **Route:** `/api/bazaar/v1/products`, `/orders`, `/orders/[id]`, `/customers`
- **Feature:** Public API error hygiene
- **Severity:** P2
- **Role:** API key/unauthenticated caller
- **Viewport:** API
- **Reproduction:** Trigger an unexpected database/provider/runtime exception and inspect the JSON response.
- **Expected:** Known errors map to stable public codes; unexpected failures return a generic message and correlation ID while details remain in logs.
- **Actual:** Route catch blocks return `error.message` directly, potentially exposing Prisma/provider/internal details.
- **Root cause hypothesis:** Confirmed static root cause: the route-level error adapter treats any exception message as a public API code.
- **Files/components:** Bazaar API route handlers and shared error/logging adapter
- **Evidence:** `src/app/api/bazaar/v1/orders/route.ts:117-120,144-147` returns arbitrary `Error.message`; the products/customers/order-detail route handlers use the same pattern.

## Coverage matrix

Legend: `PASS` means a static contract was found and no defect was identified in that narrow check; `FAIL` cites a defect; `NOT_RUN` means runtime coverage is still required; `NA` means the dimension does not apply. No route is release-passable from this Phase A audit alone.

| Route/surface | Role/RBAC | Data + UI states | Create/edit/status actions | Print/export | 390x844 | 414x896 | 768 | 1440/large | Light/dark |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/sales/orders` | PASS (static scope) | NOT_RUN | FAIL A3-001/A3-019 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/sales/orders/new` | PASS (static scope) | NOT_RUN | FAIL A3-004/A3-009/A3-011 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/sales/orders/[id]` | PASS (static scope) | NOT_RUN | FAIL A3-001/A3-009/A3-011 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/sales/orders/metrics` | PASS (static role/scope) | NOT_RUN | NOT_RUN | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/purchase-orders` | FAIL A3-007 | NOT_RUN | FAIL A3-004/A3-012/A3-019 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/purchase-orders/new` | FAIL A3-007 | NOT_RUN | FAIL A3-004/A3-007 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/purchase-orders/[id]` | FAIL A3-007 | NOT_RUN | FAIL A3-007 | FAIL A3-007 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/customers*` | FAIL A3-006 | NOT_RUN | FAIL A3-006/A3-019 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/suppliers*` | FAIL A3-007 | NOT_RUN | FAIL A3-019 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| `/operations/integrations` | PASS (static route gate) | NOT_RUN | NOT_RUN | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Bazaar API management | PASS (static management scope) | NOT_RUN | FAIL A3-002 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Email Marketing | PASS (static role/store checks) | NOT_RUN | FAIL A3-015/A3-016/A3-018 | NA | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| M-Market | FAIL A3-008 | NOT_RUN | FAIL A3-013/A3-014 | FAIL A3-008/A3-014 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Bakai Store | FAIL A3-008 | NOT_RUN | FAIL A3-013/A3-014 | FAIL A3-008/A3-014 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| O! Market | FAIL A3-008 | NOT_RUN | FAIL A3-013/A3-014 | FAIL A3-008/A3-014 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Bazaar REST API | FAIL A3-002/A3-003 | NOT_RUN | FAIL A3-001/A3-003/A3-005/A3-010/A3-017/A3-020 | NA | NA | NA | NA | NA | NA |

Required data states (empty, one, normal, many, negative stock, missing price/cost/image, archived, stale/incomplete job, invalid/deactivated relation), UI states (loading/skeleton/success/empty/validation/API error/retry), every required role, browser console/network, and back-navigation persistence are all `NOT_RUN` unless a static `FAIL` is shown above.

## Mutation contract audit

| Mutation family | Authorization/scope | Validation | Transactionality | Idempotency/retry | Audit/side effects | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Sales order create/edit/status | Store assertions are generally present; product-store assignment missing. | Zod/domain transitions present. | Core writes generally transactional. | Completion has idempotency; creation does not. | Audit/email present in many transitions. | FAIL A3-001/A3-004/A3-009/A3-011 |
| Purchase order create/edit/status/receive | Role exists on mutations; actor store access absent. | Domain state/quantity checks present. | Receive is transactional and keyed; client bulk cancel is not atomic. | Receive/reorder keyed; normal create/cancel not keyed. | Audit/stock-on-order present. | FAIL A3-004/A3-007/A3-012 |
| Customer/supplier writes/import | Manager procedures; customer write entry asserts selected store. | Normalization/import preview exists. | Imports/chunks use transactions. | No general request idempotency; store-level dedupe contract is broken. | Audit present. | FAIL A3-006/A3-007 |
| Bazaar API key/order/customer | Key management store-scoped; cached revocation broken. | Zod plus service checks. | API order/stock/customer transaction present. | External ID optional and ambiguous. | API confirmation email not durable. | FAIL A3-001/A3-002/A3-003/A3-005/A3-010/A3-017/A3-020 |
| Email campaigns/senders/automations | Manager and core store checks present. | Content/audience/sender validation exists; links non-blocking. | Campaign+recipients transaction exists. | New send lacks an idempotency key. | Delivery logs/webhook summary exist; complaint suppression missing. | FAIL A3-015/A3-016/A3-018 |
| Marketplace selections/mappings/exports | UI role gate exists; server reads/store scope incomplete. | Preflight exists. | Job rows/audits persist, provider side effects are external. | Cooldown/random keys are not durable request idempotency; queued recovery incomplete. | Audit/error artifacts present. | FAIL A3-008/A3-013/A3-014 |
| AI description/spec generation | Manager start; protected progress read; organization/store ownership checks exist. | Product/image/limit checks exist. | Job/items created transactionally. | Failed-item retry exists; dispatch durability incomplete. | Audit/progress present. | FAIL A3-013 |

## Existing automated coverage and test gaps

Existing DB-backed suites cover portions of sales orders, purchase orders, Bazaar API, customers, M-Market, Bakai Store, Email Marketing product search, and description jobs. They are environment-gated and were not run in this audit because no isolated Agent 3 database was provisioned. Unit/source tests cover selected PDFs, route source strings, payloads, workbooks, builder utilities, and progress calculations. Source-string tests are not sufficient for critical workflows.

Critical missing coverage:

1. No owned-route browser E2E exists; the only Playwright file targets Bazaar catalogue.
2. API create -> ready -> complete stock exactly-once test, including cancellation after each state.
3. Cached GET -> revoke key -> immediate denial test, including multi-instance/Redis behavior.
4. Required request idempotency tests for API orders, sales drafts, normal PO create/submit, and new campaign send.
5. Exact external-ID collision cases (`EXT-1` vs `EXT-10`) and database uniqueness/concurrency.
6. Store-limited manager tests for customers, PO CRUD/receive/PDF, supplier reads, marketplace reads/writes/artifacts, and AI store selection.
7. Server rejection of unassigned/inactive/archived product and variant relations in sales orders.
8. Return/refund browser and DB workflow; original-sale linkage, quantity caps, payment refund, stock restoration, retries, and audit.
9. Bulk PO cancel failure injection and reconciliation/atomicity.
10. Process termination after queued job commit, fresh-runtime job registry, queued/running timeout, retry, dead letter, and partial terminal-state tests.
11. Resend complaint -> durable suppression -> later audience exclusion test; webhook replay/out-of-order events.
12. Invalid custom link send-blocking and rendered-email link tests.
13. Empty/one/many/archived/missing-data/stale-job states; loading/skeleton/error/retry; filter back-navigation.
14. All role/viewport/theme combinations, keyboard/accessibility, console/runtime/API errors, and warmed-route performance budgets.
15. Mock-provider contract tests for Resend, M-Market, Bakai, O! Market, and AI; no live provider calls in automation.

## Proposed implementation batches

1. **P0 stock/order identity:** HARD-A3-001, A3-003, A3-005, A3-009, A3-010. Establish one stock-impact boundary, required durable API idempotency/external ID, exact unique identity, server product-store checks, and cache invalidation. Coordinate inventory writes/cache invalidation with Agent 2.
2. **P0 authorization/privacy:** HARD-A3-002, A3-006, A3-007, A3-008. Add shared policy assertions, store-scoped queries/artifacts, immediate credential invalidation, and cross-role/cross-store integration tests.
3. **P0 document safety:** HARD-A3-004, A3-011, A3-012. Add create-operation keys, replace fake return mode with the real return domain flow or remove the entry until complete, and make bulk cancel atomic/reconcilable. Coordinate returns with Agent 1.
4. **P1 durable jobs:** HARD-A3-013, A3-014. Move dispatch to a durable worker/queue, import/register workers explicitly, recover queued/running jobs, expose retry, and migrate terminal enums/UI to completed-with-errors/timed-out.
5. **P1 email reliability/compliance:** HARD-A3-015, A3-016, A3-017. Add send idempotency, durable API-order email outbox, complaint suppression, webhook replay tests, and mocked Resend contract tests.
6. **P2 validation/table/API polish:** HARD-A3-018, A3-019, A3-020. Block invalid links, complete URL-backed server table contracts, and centralize safe public error mapping.

Each batch must add DB integration tests and browser evidence before Agent 4 verification; source-string tests alone do not close any P0/P1.

## Anticipated shared-file conflicts

| Shared area | Anticipated need | Coordination owner/conflict |
| --- | --- | --- |
| Prisma schema/migrations | Dedicated API external ID/idempotency; job terminal states; possibly suppression/outbox records. | Coordinate with Agent 2 for schema/migrations and Agent 4 release/migration gate. Never use `db push`. |
| Inventory/stock service and cache invalidation | One API/manual order stock-impact contract; Bazaar API price/stock cache eviction. | Agent 2 owns inventory behavior; Agent 3 should provide commerce invariants/tests and coordinate edits. |
| Returns/refunds | Remove/replace fake Sales Order return entry with actual return semantics. | Agent 1 owns returns/POS; no unilateral Agent 3 change to Agent 1 business logic. |
| Auth/RBAC/store-access helpers | PO, customer, marketplace, artifact policy assertions. | Shared auth helper ownership must be reserved before editing; Agent 4 cross-checks RBAC matrix. |
| Job registry/Redis/queue configuration | Explicit job registration, durable dispatch, stale recovery, retry/dead letter. | Shared platform files require Agent 4 coordination and deployment verification. |
| Shared query/cache configuration | Immediate auth revocation and product/stock invalidation across instances. | Coordinate with Agent 2 and Agent 4; avoid local-only invalidation. |
| Translations | New error/status/partial/timed-out/return messages across `en/ru/kg`. | Reserve translation files for one agent at a time. |
| App shell/navigation/shared UI | Potentially hide disabled return entry and surface job partial/retry state. | Agent 4 owns shell/global UI; domain owner supplies behavior and tests. |
| Package dependencies | A durable queue/outbox library may be proposed after design review. | Agent 4/package owner approval required; no dependency change in Phase A. |

## Phase A release posture

- Agent 3 domain gate: **FAIL** due to unowned/unfixed P0/P1 findings above.
- Browser/Preview/performance/accessibility evidence: **NOT_RUN**.
- Migrations: **NA** for this audit-only commit; likely required in implementation batches.
- Independent Agent 4 verification: **NOT_RUN**.
- No fix was implemented in this phase.
