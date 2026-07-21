# Agent 4 — Platform QA and release-gate Phase A audit

Baseline: `4d7c9b33218b584334ca62f7a816f8997f144a10`

Branch: `hardening/agent-4-platform-qa`

Audit date: 2026-07-22

Mode: audit only; no application, test, schema, migration, dependency, configuration, or shared-runtime file was changed.

## Scope and evidence policy

This document records static route/procedure/service/schema inspection plus read-only build and unit evidence. It does not claim authenticated browser, Preview, device, dark-mode, accessibility-tool, production, DB-backed, or performance-timing coverage. Those checks are explicitly `NOT_RUN` until isolated databases, test identities, and a Preview deployment exist.

## Owned route inventory

| Route | Surface | Primary procedures/services | Static role gate | Phase A state |
| --- | --- | --- | --- | --- |
| `/dashboard` | Dashboard, mobile command center, activity | `dashboard.bootstrap`, `dashboard.summary`, `dashboard.activity` | UI route Admin/Manager; procedures any authenticated user | FAIL — HARD-A4-001, HARD-A4-008 |
| `/reports` | Stockout, slow-mover, shrinkage reports and client export | `reports.stockouts`, `slowMovers`, `shrinkage` | Admin/Manager | FAIL — HARD-A4-008, HARD-A4-016 |
| `/reports/analytics` | Sales KPIs, sold items, receipt drill-down | all nine `analytics.*` queries | UI route Admin/Manager; procedures any authenticated user | FAIL — HARD-A4-001 |
| `/reports/close` | Period close and period-close export request | `periodClose.list`, `periodClose.close`, `exports.create` | Admin/Manager | FAIL — HARD-A4-006, HARD-A4-007 |
| `/reports/exports` | Export request, status, retry, download | `exports.list/get/create/retry`, `/api/exports/[id]` | UI route Admin/Manager; read procedures any authenticated user | FAIL — HARD-A4-003, HARD-A4-012 |
| `/reports/receipts` | Receipt registry report | POS receipt registry procedures | Admin/Manager route; overlaps Agent 1 | STATIC_ONLY — domain verification assigned to Agent 1 |
| `/sales/orders/metrics` | Sales-order metrics | sales/analytics procedures | `viewSales`; overlaps Agent 3 | STATIC_ONLY — domain verification assigned to Agent 3 |
| `/admin/metrics` | Inventory/business metrics | `adminMetrics.get` | Admin | FAIL — HARD-A4-015 |
| `/admin/jobs` | Dead-letter list/retry/resolve | `adminJobs.list/retry/resolve` | Admin | FAIL — HARD-A4-009, HARD-A4-015 |
| `/admin/support` | Impersonation, support bundle, feature flags | `adminSupport.*`, `/api/impersonation` | Admin | FAIL — HARD-A4-015 |
| `/billing` | Plan, limits, usage, upgrade request | `billing.get/requestUpgrade/setPlanDev` | UI route Admin; `billing.get` any authenticated user | FAIL — HARD-A4-002, HARD-A4-015 |
| `/cash`, `/finance/income`, `/finance/expense` | Cash and finance quick-action destinations | No data procedure or mutation is used by these pages | `viewCash` (Admin/Manager) | FAIL — HARD-A4-019 |
| `/platform` | Cross-organization billing control | `platformOwner.*` | Platform owner | STATIC_ONLY |
| `/settings/profile` | User, theme, locale, business profile | `userSettings.*`, `orgSettings.*`, store product settings | All authenticated; business sections Admin/org owner | STATIC_ONLY |
| `/settings/users` | Users, roles, store assignments, invites, password reset | `users.*`, `invites.*` | Admin | STATIC_ONLY |
| `/settings/printing` | Shared printing setup | `stores.hardware/updateHardware`, QZ/connector routes | Admin route; read procedure broader | STATIC_ONLY — overlaps POS and products |
| `/settings/store-groups` | Store assortment groups | `stores.assortmentOverview/previewAssortmentShare/applyAssortmentShare` | Nav/API Admin or org owner; middleware has no route rule | FAIL — HARD-A4-011 |
| `/settings/categories` | Store category visibility/archive | `productCategories.listForStore/setStoreVisibility` | Nav mutation Admin/org owner; middleware has no route rule | FAIL — HARD-A4-011; domain overlaps Agent 2 |
| `/settings/attributes` | Attribute settings | `attributes.*` | Manager+ | STATIC_ONLY — business logic assigned to Agent 2 |
| `/settings/units` | Unit settings | `units.*` | Manager+ | STATIC_ONLY — business logic assigned to Agent 2 |
| `/settings/import` | Product import settings/workspace | `imports.*` | Manager+ | STATIC_ONLY — business logic assigned to Agent 2 |
| `/settings/diagnostics` | Organization diagnostics | `diagnostics.getLastReport/runAll/runOne` | Org owner | STATIC_ONLY |
| `/settings/whats-new` | Release information | no domain mutation | Admin | STATIC_ONLY |
| `/stores`, `/stores/new` | Store list/create/edit/policy/legal/product settings | `stores.list/create/update/updatePolicy/updateLegalDetails/updateProductSettings/updateProductCatalog` | Admin/Manager | STATIC_ONLY |
| `/stores/[id]/compliance` | Store compliance configuration | `compliance.*` | Admin/Manager | STATIC_ONLY |
| `/stores/[id]/hardware` | Store printer/connector profile | `stores.hardware/updateHardware` | Route Admin/Manager; page/API read also allow Staff | STATIC_ONLY — RBAC intent needs product decision |
| `/onboarding` | Organization setup | `onboarding.*` | Admin | STATIC_ONLY |
| `/help`, `/help/compliance` | Help and compliance guidance | guidance/compliance reads | Authenticated | STATIC_ONLY |
| `/dev/scanner-test` | Scanner diagnostics | scan/product lookups | Admin | STATIC_ONLY |
| `/login`, `/signup`, `/invite`, `/invite/[token]`, `/verify/[token]`, `/reset`, `/reset/[token]`, `/register-business/[token]` | Authentication and onboarding entry points | NextAuth, `publicAuth.*`, invite/auth-token services | Public/token scoped | STATIC_ONLY |
| `/`, `/[locale]`, `/[locale]/[...slug]` | Landing/localized redirects | locale middleware | Public | STATIC_ONLY |
| All authenticated routes | App shell, desktop sidebar, mobile top/bottom nav, command palette, themes, guidance, PWA | `AppShell`, `MobileAppShell`, `CommandPalette`, `ThemeSync`, `/api/sse` | Client filtering plus middleware | FAIL — HARD-A4-004, HARD-A4-005, HARD-A4-013, HARD-A4-014, HARD-A4-017 |

## Owned API, procedure, job, and model inventory

### tRPC routers and procedures

- `dashboard`: `bootstrap`, `summary`, `activity`.
- `reports`: `stockouts`, `slowMovers`, `shrinkage`.
- `analytics`: `salesTrend`, `topProducts`, `stockoutsLowStock`, `inventoryValue`, `salesOverview`, `salesFilterOptions`, `soldProducts`, `salesDayDetail`, `productReceipts`.
- `adminMetrics`: `get`.
- `exports`: `list`, `get`, `create`, `retry`.
- `periodClose`: `list`, `close`.
- `users`: `list`, `create`, `update`, `setActive`, `resetPassword`, `updateLocale`.
- `invites`: `list`, `create`.
- `billing`: `get`, `requestUpgrade`, development-only `setPlanDev`.
- `platformOwner`: `summary`, `listUpgradeRequests`, `reviewUpgradeRequest`, `listOrganizations`, `updateOrganizationBilling`.
- `stores`: `assortmentOverview`, `previewAssortmentShare`, `applyAssortmentShare`, `list`, `updatePolicy`, `create`, `updateProductSettings`, `updateProductCatalog`, `update`, `updateLegalDetails`, `hardware`, `updateHardware`.
- `orgSettings`: `getBusinessProfile`, `updateBusinessProfile`.
- `userSettings`: `getMyProfile`, `updateMyProfile`, `updateMyPreferences`.
- `adminJobs`: `list`, `retry`, `resolve`.
- `adminSupport`: `storeFlags`, `upsertStoreFlag`, `createImpersonation`, `revokeImpersonation`, `exportBundle`.
- `diagnostics`: `getLastReport`, `runAll`, `runOne`.
- `guidance`: `getState`, `dismissTip`, `resetTips`, `completeTour`, `resetTour`, `syncState`.
- `impersonation`: `status`.
- `search`: `global`.

### HTTP and runtime endpoints

- `/api/auth/[...nextauth]`, `/api/locale`, `/api/impersonation`.
- `/api/health`, `/api/preflight`, `/api/metrics`.
- `/api/jobs/run`, `/api/sse`, `/api/exports/[id]`.
- Global PWA assets: `/manifest.webmanifest`, `/sw.js`, `/offline.html`.
- Shared printing/QZ endpoints were inventoried as cross-domain dependencies; domain behavior remains with Agents 1 and 2.

### Jobs

- Shared runner and lock/retry/dead-letter lifecycle in `src/server/jobs/index.ts`.
- `export-job`, diagnostics jobs, cleanup job, email campaign job, order follow-up job, and domain integration jobs registered into the shared runner.
- Required lifecycle coverage found: queued/running/done/failed and dead-letter retry. Missing or unverified: timed-out state, stale-running recovery, lock-skipped queued recovery, completed-with-errors where partial results are possible, and process-crash recovery.

### Relevant models

`Organization`, `User`, `UserStoreAccess`, `UserGuideState`, `Store`, `ProductCatalog`, `StoreComplianceProfile`, `StorePrinterSettings`, `StoreCategoryPreference`, `ExportJob`, `PeriodClose`, `DiagnosticsReport`, `PlanUpgradeRequest`, `DeadLetterJob`, `StoreFeatureFlag`, `AuditLog`, `ImpersonationSession`, `InviteToken`, `AccessRequest`, `AuthToken`, plus report read models `CustomerOrder`, `CustomerOrderLine`, `SalePayment`, `SaleReturn`, `RegisterShift`, `CashDrawerMovement`, `StockMovement`, `InventorySnapshot`, `ProductCost`, `StorePrice`, and `ReorderPolicy`.

## Defects found

### HARD-A4-001

- ID: HARD-A4-001
- Route: `/dashboard`, `/reports/analytics`, tRPC `dashboard.*`, `analytics.*`
- Feature: RBAC for financial and operational analytics
- Severity: P0
- Role: Cashier, Staff/limited user
- Viewport: All/API
- Reproduction: Authenticate as Cashier or Staff and call `dashboard.bootstrap`, `dashboard.summary`, or any `analytics.*` query directly through tRPC, even though middleware redirects those roles away from `/dashboard` and `/reports`.
- Expected: The server procedure enforces the same `viewDashboard`/`viewReports` role policy as route middleware.
- Actual: All dashboard and analytics queries use `protectedProcedure`; baseline integration tests explicitly expect Staff analytics and Cashier dashboard calls to succeed.
- Root cause hypothesis: Route authorization and API authorization evolved independently; store scoping was treated as a substitute for feature-level permission.
- Files/components: `src/lib/roleAccess.ts`, `middleware.ts`, `src/server/trpc/routers/dashboard.ts`, `src/server/trpc/routers/analytics.ts`, `tests/integration/analytics.test.ts`, `tests/integration/store-isolation.test.ts`.
- Evidence: `roleAccess.ts:38-75,106-140`; `dashboard.ts:15,33,51`; `analytics.ts:118-295`; `analytics.test.ts:73-101`; `store-isolation.test.ts:618-629`.

### HARD-A4-002

- ID: HARD-A4-002
- Route: `/billing`, tRPC `billing.get`
- Feature: Billing/plan/usage privacy
- Severity: P0
- Role: Manager, Cashier, Staff/limited user
- Viewport: All/API
- Reproduction: Call `billing.get` as any authenticated non-admin.
- Expected: Only the role permitted to open `/billing` can read organization plan usage, limits, upgrade history, messages, and review notes.
- Actual: `/billing` is guarded by `manageBilling` (Admin only), while `billing.get` uses `protectedProcedure` and returns usage plus upgrade request history.
- Root cause hypothesis: UI-only role check was added without matching procedure authorization.
- Files/components: `src/lib/roleAccess.ts`, `src/server/trpc/routers/billing.ts`, `src/server/services/billing.ts`, `src/app/(app)/billing/page.tsx`.
- Evidence: `roleAccess.ts:111`; `billing.ts:11`; `billing.ts service:35-119`; billing page checks `session.user.role === "ADMIN"` at `page.tsx:91-94`.

### HARD-A4-003

- ID: HARD-A4-003
- Route: `/reports/exports`, `/api/exports/[id]`, tRPC `exports.list/get`
- Feature: Export metadata and file download authorization
- Severity: P0
- Role: Cashier, Staff/limited user
- Viewport: All/API
- Reproduction: As a store-assigned Cashier/Staff user, call `exports.list`, obtain a job ID, then call `exports.get` or `GET /api/exports/{id}`.
- Expected: Report/export read and download require the same Manager/Admin permission as export generation and `/reports`.
- Actual: `exports.list/get` use `protectedProcedure`; download checks organization and store assignment only. Files can contain costs, margins, cash movements, receipts, and tax/compliance data.
- Root cause hypothesis: Store-access checks were implemented, but feature-level RBAC was omitted from read/download paths.
- Files/components: `src/server/trpc/routers/exports.ts`, `src/app/api/exports/[id]/route.ts`, `src/server/services/exports.ts`, `src/lib/roleAccess.ts`.
- Evidence: `exports.ts router:37-66`; API route `:23-53`; service `:2395-2468`; route policy `roleAccess.ts:123`.

### HARD-A4-004

- ID: HARD-A4-004
- Route: Global command palette; tRPC `search.global`
- Feature: Server-side search-result RBAC
- Severity: P0
- Role: Cashier, Staff/limited user
- Viewport: Desktop/mobile/API
- Reproduction: Call `search.global` directly as a role lacking supplier, store, or purchase-order permissions using a text query of at least three characters.
- Expected: Server returns only entity types allowed for the caller.
- Actual: Server returns scoped stores and purchase-order IDs/supplier labels regardless of domain permission; only `CommandPalette` filters forbidden result types after receiving them.
- Root cause hypothesis: Authorization was placed in presentation filtering instead of the search service/router.
- Files/components: `src/server/trpc/routers/search.ts`, `src/server/services/search/global.ts`, `src/components/command-palette.tsx`, `src/lib/roleAccess.ts`.
- Evidence: search router uses `protectedProcedure` at `search.ts:5`; grouped entity queries at `global.ts:213-300`; client-only permission filter at `command-palette.tsx:366-369`.

### HARD-A4-005

- ID: HARD-A4-005
- Route: `/api/sse` and every live-updating authenticated route
- Feature: Store-scoped real-time events
- Severity: P0
- Role: Manager, Cashier, Staff with limited store assignments
- Viewport: All/API
- Reproduction: Open `/api/sse` as a user assigned to Store A while an event occurs in Store B in the same organization.
- Expected: Event is delivered only if the caller can access the event store.
- Actual: `canReceiveEvent` resolves only the event's organization and compares it with the token organization. It never resolves caller store assignments. Payloads expose store/product/order/register/shift IDs and receipt numbers.
- Root cause hypothesis: Tenant isolation was implemented, but user-store isolation was not added to the SSE authorization context.
- Files/components: `src/app/api/sse/route.ts`, `src/server/events/eventBus.ts`, `src/server/services/storeAccess.ts`.
- Evidence: `sse/route.ts:24-94,118-146`; payload definitions `eventBus.ts:18-74`.

### HARD-A4-006

- ID: HARD-A4-006
- Route: `/reports/close`, tRPC `periodClose.list/close`
- Feature: Store-scoped period close
- Severity: P0
- Role: Manager with limited store assignments
- Viewport: All/API
- Reproduction: Call `periodClose.list({storeId: inaccessibleStoreId})` or `periodClose.close(...)` for another store in the same organization.
- Expected: `assertUserCanAccessStore` rejects inaccessible stores before read or close.
- Actual: Router and service filter only by organization/store ID and role; no user-store access assertion exists.
- Root cause hypothesis: Period close predates store-assignment enforcement used by reports/analytics.
- Files/components: `src/server/trpc/routers/periodClose.ts`, `src/server/services/periodClose.ts`, `src/server/services/storeAccess.ts`.
- Evidence: router `periodClose.ts:24-47`; service `periodClose.ts:17-39`; compare report scoping in `routers/reports.ts:44-64`.

### HARD-A4-007

- ID: HARD-A4-007
- Route: `/reports/close`, period-close export
- Feature: Monetary period-close totals
- Severity: P0
- Role: Admin, Manager
- Viewport: All/export
- Reproduction: Close a period containing a sale of multiple units at a non-unit price, then inspect `PeriodClose.totals` or export `PERIOD_CLOSE_REPORT`.
- Expected: `salesTotalKgs` and `purchasesTotalKgs` are monetary KGS totals.
- Actual: Both fields sum absolute `StockMovement.qtyDelta`, i.e. units. Export headers label those values as KGS.
- Root cause hypothesis: Quantity movement aggregation was stored under monetary field names without joining document line totals/costs.
- Files/components: `src/server/services/periodClose.ts`, `src/server/services/exports.ts`, `tests/integration/period-close.test.ts`.
- Evidence: `periodClose.ts:45-61`; export labels `exports.ts:450-520` and period-close row builder; the only period-close integration test checks duplicates, not totals.

### HARD-A4-008

- ID: HARD-A4-008
- Route: `/dashboard`, `/reports`
- Feature: Business-day date boundaries in production
- Severity: P0
- Role: Admin, Manager
- Viewport: All
- Reproduction: Run the server in UTC (typical serverless default), complete a sale between 00:00 and 05:59 Asia/Bishkek, then open Dashboard “today” or a date-bounded stock report.
- Expected: All business-day bounds use the declared `Asia/Bishkek` timezone.
- Actual: Dashboard calls `new Date().setHours(0...)`; stock reports parse date-only values with the server's local timezone. Sales analytics has a separate correct +06 conversion, demonstrating the intended behavior.
- Root cause hypothesis: Formatting was centralized on `defaultTimeZone`, but query boundary construction was not.
- Files/components: `src/server/services/dashboard/summary.ts`, `src/server/trpc/routers/reports.ts`, `src/server/services/salesAnalytics.ts`, `src/lib/timezone.ts`.
- Evidence: dashboard `summary.ts:386-393,540-681`; report parser `reports.ts router:24-42`; correct reference `salesAnalytics.ts:55-103`; no repository `TZ` deployment configuration was found.

### HARD-A4-009

- ID: HARD-A4-009
- Route: `/admin/jobs`, tRPC `adminJobs.list/retry/resolve`
- Feature: Dead-letter tenant isolation
- Severity: P0
- Role: Organization Admin
- Viewport: All/API
- Reproduction: Create or encounter a dead letter whose payload has no `organizationId`, then list or retry it as an admin from any organization.
- Expected: Tenant admins can access only jobs explicitly belonging to their organization; global jobs require platform-owner/operations authorization.
- Actual: `listDeadLetterJobs` returns every `organizationId: null` row to every org admin; retry/resolve allow null-organization jobs. Retrying can execute a global job.
- Root cause hypothesis: Null organization was treated as shared visibility instead of privileged platform scope.
- Files/components: `src/server/jobs/index.ts`, `src/server/services/deadLetterJobs.ts`, `src/server/trpc/routers/adminJobs.ts`, `prisma/schema.prisma`.
- Evidence: organization extraction and nullable insert `jobs/index.ts:279-303`; list/retry rules `deadLetterJobs.ts:6-43`; nullable model `schema.prisma:2827-2844`.

### HARD-A4-010

- ID: HARD-A4-010
- Route: Test infrastructure / all DB-backed tests
- Feature: Four-agent database isolation
- Severity: P0
- Role: Engineering agents/CI
- Viewport: NA
- Reproduction: Start DB tests from two worktrees with the same base `.env` and no unique `DATABASE_TEST_URL`.
- Expected: Each agent resolves a distinct database/schema and cannot delete another agent's fixtures.
- Actual: Global setup derives the same `${databaseName}_test`, while every DB suite calls a whole-`public`-schema `TRUNCATE ... CASCADE` before each test.
- Root cause hypothesis: The harness was designed for serialized single-worktree execution.
- Files/components: `tests/global-setup.ts`, `tests/helpers/db.ts`, `tests/setup.ts`, agent environment files (not yet created).
- Evidence: `global-setup.ts:36-57`; `helpers/db.ts:8-31`. DB tests were deliberately not run during Phase A.

### HARD-A4-011

- ID: HARD-A4-011
- Route: `/settings/store-groups`, `/settings/categories`
- Feature: Settings route authorization
- Severity: P0
- Role: Cashier, Staff/limited user
- Viewport: All
- Reproduction: Navigate directly to either URL while authenticated as Cashier/Staff.
- Expected: Middleware applies `manageSettings` or `manageProducts` before rendering the page.
- Actual: Neither prefix exists in `routeAccessRules`, so `canAccessAppRoute` falls through to `true`. Store-groups mutations still fail server-side, but the route renders; categories can load hidden/archive metadata through protected read procedures.
- Root cause hypothesis: New settings pages were added to navigation without extending centralized route rules/tests.
- Files/components: `src/lib/roleAccess.ts`, `middleware.ts`, both settings pages, `src/server/trpc/routers/productCategories.ts`.
- Evidence: `roleAccess.ts:106-145`; nav entries `app-shell.tsx:373-399`; missing coverage in `tests/unit/role-access.test.ts:105-117`.

### HARD-A4-012

- ID: HARD-A4-012
- Route: `/reports/exports`, shared background runner
- Feature: Export job lifecycle and recovery
- Severity: P1
- Role: Admin, Manager
- Viewport: All/background
- Reproduction: Request Export B while Export A holds the global `export-job` lock, or terminate the process after a job becomes `RUNNING`.
- Expected: B is picked up later; stale running work times out/requeues; lifecycle exposes recoverable terminal states.
- Actual: `requestExport` fire-and-forgets `runJob`; the lock is keyed only by job name. A lock miss returns `skipped` and leaves B `QUEUED`. No recurring queue drain or stale `RUNNING` recovery exists, and queued/running rows count against the 20-job cap.
- Root cause hypothesis: In-process execution was used as a queue without a durable dispatcher/lease.
- Files/components: `src/server/jobs/index.ts`, `src/server/services/exports.ts`, `prisma/schema.prisma`, `/api/jobs/run`.
- Evidence: global lock `jobs/index.ts:24-44,260-276`; fire-and-forget `exports.ts:2529-2538,2582-2591`; status selection/update `:2600-2709`; four-state enum `schema.prisma:179-184`.

### HARD-A4-013

- ID: HARD-A4-013
- Route: Global; at least 107 `<Modal>` call sites, including command palette and critical workflows
- Feature: Dialog keyboard accessibility and focus containment
- Severity: P1
- Role: Keyboard/screen-reader user
- Viewport: Desktop/mobile
- Reproduction: Open a custom `Modal`, press Tab repeatedly, and close it.
- Expected: Initial focus moves into the dialog, Tab is trapped, background is inert, and focus returns to the trigger.
- Actual: Custom `Modal` sets dialog ARIA and Escape/body locking only; `containerRef` is never focused, no focus trap/inert handling exists, and focus restoration is absent. `MobileMoreMenu` remains mounted with focusable off-screen links while `aria-hidden=true`.
- Root cause hypothesis: Custom primitives predate the Radix dialog/sheet primitives already present in the repository.
- Files/components: `src/components/ui/modal.tsx`, `src/components/mobile-app-shell.tsx`, all custom Modal consumers.
- Evidence: `modal.tsx:26-119`; `mobile-app-shell.tsx:226-340`; static search found 107 Modal call sites.

### HARD-A4-014

- ID: HARD-A4-014
- Route: Global mobile web/PWA
- Feature: Accessible zoom
- Severity: P2
- Role: Low-vision user
- Viewport: 390x844, 414x896, tablet
- Reproduction: Attempt pinch zoom in a mobile browser/PWA.
- Expected: User can zoom content.
- Actual: root viewport sets `maximumScale: 1` and `userScalable: false`.
- Root cause hypothesis: POS-like viewport locking was applied globally instead of to a narrowly justified surface.
- Files/components: `src/app/layout.tsx`.
- Evidence: `layout.tsx:34-42`.

### HARD-A4-015

- ID: HARD-A4-015
- Route: `/admin/jobs`, `/admin/metrics`, `/admin/support`, `/billing`, `/dashboard`
- Feature: Loading/error/retry states
- Severity: P2
- Role: Admin, Manager where applicable
- Viewport: All/themes
- Reproduction: Force each primary query to return an API error.
- Expected: Clear translated error plus retry, without presenting failed data as empty/zero.
- Actual: Admin Jobs falls into its empty state; Billing renders only the header; Admin Metrics renders filters with no result state; Admin Support omits primary-query errors; Dashboard displays an error but no retry and treats activity errors as empty.
- Root cause hypothesis: Query-success rendering was implemented before a shared error-state contract.
- Files/components: the five route pages listed above.
- Evidence: `admin/jobs/page.tsx:78-88`; `billing/page.tsx:147-475`; no `metricsQuery.error` branch in Admin Metrics; no `usersQuery.error`/`storeFlagsQuery.error` branches in Admin Support; Dashboard error branches at `page.tsx:419-421,590-594` lack retry.

### HARD-A4-016

- ID: HARD-A4-016
- Route: `/reports`, `/reports/close`
- Feature: Server pagination and large-data behavior
- Severity: P2
- Role: Admin, Manager
- Viewport: All
- Reproduction: Use an organization with many products, movements, users, and period closes, then load the route.
- Expected: Bounded server queries with search/filter/sort/pagination.
- Actual: stockouts/slow movers/shrinkage and period closes load complete result sets; `ResponsiveDataList` only changes rendering and cannot bound DB/network work.
- Root cause hypothesis: Client export and responsive rendering reused an all-rows query.
- Files/components: `src/server/services/reports.ts`, `src/server/services/periodClose.ts`, report pages, `src/components/responsive-data-list.tsx`.
- Evidence: unbounded reads/grouping `reports.ts:59-278`; `periodClose.ts:17-21`; no page/pageSize inputs in report or period-close routers.

### HARD-A4-017

- ID: HARD-A4-017
- Route: Global, especially `/reports/analytics`, `/products`, `/inventory/counts/[id]`, receipt routes
- Feature: Initial JavaScript/font performance
- Severity: P2
- Role: All
- Viewport: Mobile/desktop, cold and warm
- Reproduction: Build baseline and inspect route sizes; load any app route with a cold font cache.
- Expected: Heavy code is route-split and catalog-only fonts are loaded only where needed.
- Actual: build reports 494 kB first-load JS for analytics, 506 kB for products, 429 kB for inventory count detail, and 417 kB for receipt routes. Root layout globally requests nine Google font families with multiple weights.
- Root cause hypothesis: large client pages and global catalog-font stylesheet imports.
- Files/components: route client components, `src/app/layout.tsx`, charts/export/modal dependencies.
- Evidence: successful `pnpm build` output on baseline; `layout.tsx:12-15,72-74`. Browser transfer and warm interaction timings remain `NOT_RUN`.

### HARD-A4-018

- ID: HARD-A4-018
- Route: Release gate / POS and Products
- Feature: Baseline unit-test gate
- Severity: P1
- Role: Engineering/release
- Viewport: NA
- Reproduction: Run `pnpm exec vitest run tests/unit` on baseline.
- Expected: Unit gate passes before hardening changes.
- Actual: 113 files pass and 2 fail (543/545 tests): POS completion lacks expected runtime-sync cleanup; mobile Products lacks expected `mobileSheet` source marker.
- Root cause hypothesis: Product code and source-string regression assertions drifted, or real regressions landed without corresponding updates.
- Files/components: `src/app/(app)/pos/sell/page.tsx`, `tests/unit/pos-entry-source.test.ts`, `src/app/(app)/products/page.tsx`, `tests/unit/mobile-products-source.test.ts`.
- Evidence: failure assertions at `pos-entry-source.test.ts:177` and `mobile-products-source.test.ts:22`; routed to Agents 1 and 2 for domain root-cause confirmation.

### HARD-A4-019

- ID: HARD-A4-019
- Route: `/cash`, `/finance/income`, `/finance/expense`
- Feature: Cash and finance route readiness
- Severity: P1
- Role: Admin, Manager
- Viewport: All
- Reproduction: Open any of the three routes directly as a role with `viewCash`.
- Expected: A released cash/income/expense route provides its named workflow, or is hidden and unavailable until that workflow is ready.
- Actual: Each route renders only a generic card with placeholder strings such as `Card`, `Cash description`, and `Finance income description`; there is no data query, form, mutation, loading state, or error state. The routes are included in middleware/RBAC, and finance actions are offered by the command palette.
- Root cause hypothesis: Quick-action route scaffolds were shipped and added to navigation/access policy before their business workflows were implemented.
- Files/components: `src/app/(app)/cash/page.tsx`, `src/app/(app)/finance/income/page.tsx`, `src/app/(app)/finance/expense/page.tsx`, `src/components/command-palette.tsx`, `src/lib/roleAccess.ts`, `messages/en.json`, `messages/ru.json`, `messages/kg.json`.
- Evidence: Each page contains only `PageHeader` plus a static `Card`; English messages at `messages/en.json:2232-2256` are generic placeholders; `roleAccess.ts:133-134` exposes the routes under `viewCash`; the command palette links income and expense actions to the finance routes.

## Coverage matrix

| Dimension | Values required | Phase A result |
| --- | --- | --- |
| Roles | Admin, Manager, Cashier, limited/Staff | STATIC role/procedure comparison complete for owned core routes; browser and live API calls `NOT_RUN` |
| Viewports | 390x844, 414x896, 768, 1440, large desktop | Responsive source/breakpoints inventoried; rendered validation `NOT_RUN` |
| Themes | Light, dark | Token/theme implementation inventoried; visual/contrast validation `NOT_RUN` |
| Data | empty, one, normal, many, negative, missing fields, archived, stale job, invalid relation | Code paths partially inventoried; fixture/browser validation `NOT_RUN`; stale export gap FAIL |
| UI states | loading, skeleton, success, empty, validation error, API error, retry | Static coverage PARTIAL; HARD-A4-015 FAIL |
| Actions | create, view, edit, archive, cancel/delete, print, export, back/filter persistence | Procedure/action inventory complete; end-to-end execution `NOT_RUN` |
| Performance | warmed route/API/input budgets | Production build size captured; cold/warm browser and API timings `NOT_RUN` |
| Runtime | console, network, deployment, PWA update/cache | Static PWA/runtime review complete; Preview/production behavior `NOT_RUN` |

## Read-only verification evidence

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS, no warnings |
| `pnpm i18n:check` | PASS |
| `pnpm build` | PASS; 81 static pages generated; notable bundle sizes recorded in HARD-A4-017 |
| `pnpm exec vitest run tests/unit` | FAIL; 113 files passed, 2 failed; 543 tests passed, 2 failed |
| `git diff --check` | Pending until consolidated documents are complete |
| DB integration tests | NOT_RUN — no Agent-4-specific database provisioned; running them would violate isolation requirement |
| Authenticated browser/Preview smoke | NOT_RUN — no Preview/test identities supplied in Phase A |

## Test gaps

- Only one Playwright file exists and covers the public Bazaar catalog; there is no authenticated all-route browser regression harness.
- Critical RBAC gaps above lack negative tests that align route permissions with procedure and download permissions.
- No SSE test covers limited-store subscribers.
- Period-close tests cover duplicate prevention only, not money correctness, store access, invalid ranges, concurrency, or timezone boundaries.
- Export tests do not cover concurrent requests, lock-skipped queued jobs, worker crashes, stale running jobs, limited-role read/download denial, or timeout recovery.
- Dead-letter tests do not cover null-organization visibility/retry across two tenants.
- Dashboard source-string tests do not verify Asia/Bishkek query bounds.
- Error-state coverage is mostly source-string or absent; there is no network-failure browser suite.
- Responsive and theme tests are predominantly source-string assertions; no screenshot/axe/contact-sheet harness covers required roles and viewports.
- DB tests are serialized within one process but unsafe across worktrees until each agent receives a unique database URL.

## Proposed implementation batches

1. P0 authorization boundary: introduce server permission middleware/policies for dashboard, analytics, billing, exports, search result types, SSE store subscriptions, settings routes, and global dead letters. Add two-tenant/two-store negative integration tests.
2. P0 financial correctness: replace period-close quantity totals with real money aggregates; centralize Asia/Bishkek range conversion for dashboard/reports; add boundary and currency tests.
3. P0 hardening infrastructure: provision four explicit DB URLs, add an agent/database identity guard to test reset, and document safe commands before any DB test runs.
4. P1 durable jobs: durable per-job leases/claiming, queue drain, timeout/stale recovery, idempotent claim/update, status model decision, and concurrency tests.
5. P1 accessibility: migrate the custom Modal/mobile more menu to the existing Radix primitives or implement equivalent focus trap, inert background, focus restore, and browser keyboard tests.
6. P1 release gate: Agents 1 and 2 resolve or correctly rebaseline the two failing unit assertions with behavior-level coverage.
7. P2 state/performance: shared error/retry pattern, server pagination for reports/period closes, route-level code splitting, scoped font loading, and warmed Preview timing table.
8. Browser matrix and independent gate: authenticated Playwright fixtures for four roles, required viewports/themes/states, screenshots/contact sheets, console/network assertions, and Agent-4 verification of domain commits.

## Anticipated shared-file conflicts

- `src/lib/roleAccess.ts`, `middleware.ts`, auth/tRPC middleware, and `src/server/services/storeAccess.ts`: Agent 4 coordinator; domain owners supply permission requirements and tests.
- `src/server/jobs/index.ts` and Prisma job enums/models: Agent 4 coordinator; Agent 3 owns marketplace/email job semantics and must review lifecycle changes.
- `prisma/schema.prisma` and migrations: serialized integration ownership only; no `db push`; one migration author at a time.
- `src/components/ui/modal.tsx`, app shell/mobile shell, globals/tokens, query client, translations, and dependencies: Agent 4 ownership with cross-review required.
- Reports receipt registry and printing settings overlap Agent 1; categories/attributes/units/import/store assignment overlap Agent 2; sales metrics and email/integration jobs overlap Agent 3.
- `src/server/services/exports.ts` reads POS, inventory, orders, and compliance data. Agent 4 owns export orchestration/authorization; Agents 1–3 must review domain row semantics before merge.

## Phase A exit status

Agent 4 first deliverable is complete as a static audit, but the program is not ready for fixes. P0 isolation controls and the consolidated Agent 1–3 findings must be accepted into the master backlog first. No issue above meets the definition of done; none has browser or independent verification yet.
