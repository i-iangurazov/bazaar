# Agent 1 Phase A Audit — POS & Cash Operations

## Audit metadata and limits

- Owner: Agent 1 — POS & Cash Operations
- Baseline commit: `4d7c9b33218b584334ca62f7a816f8997f144a10`
- Branch: `hardening/agent-1-pos`
- Audit mode: source, schema, migration, and test inspection only; no product code, schema, configuration, or test files were changed.
- Database/API mutation: `NOT_RUN`. No database was provisioned or changed.
- Browser/Preview/Production QA: `NOT_RUN`.
- Responsive, theme, accessibility, console, network, and performance measurements: `NOT_RUN` in a browser. Static findings are called out separately.
- Local test execution: `NOT_RUN`. The isolated worktree has no installed `vitest` binary; `pnpm exec vitest run ...` stopped at command resolution and executed no tests.
- Coordinator baseline evidence: `pnpm typecheck`, `pnpm lint`, and `pnpm i18n:check` passed. The baseline unit run reported 113 passing files and 2 failing files. One owned failure is analyzed under Test Gaps; it is test drift, not evidence of a runtime regression.
- Status vocabulary below: `PASS` means a static implementation path was found, not browser validation; `FAIL` means the static implementation contradicts a requirement or exposes a defect; `NOT_RUN` means runtime verification is still required; `NA` means the state does not exist in the current model.

## 1. Owned route and surface inventory

### User-facing routes

| Route | Roles exposed by route/server | Principal surfaces and actions | Responsive implementation |
| --- | --- | --- | --- |
| `/pos` | Authenticated POS roles; mutation rules vary | Persisted register selection, current shift status, prior close summary, open-shift dialog, opening cash/notes, links to sell/history/shifts/registers/debts | Separate compact/mobile and desktop layouts |
| `/pos/sell` | Admin, Manager, Staff, Cashier through POS procedures | Server product/category search, catalog, cart add/remove, quantity/price, sale discount, marking codes, notes, customer search/create/edit, single/split/debt payments, hold/cancel/resume, completion, receipt/precheck/fiscal print/download/share, embedded journal, completed-sale edit, return creation, KKM retry, navigation guard | Dedicated mobile catalog/sale/keypad/payment/scanner screens; desktop catalog/cart; tablet bottom-sheet checkout |
| `/pos/shifts` | Authenticated POS roles; close currently accepts all POS roles | Register selection, current shift/X report, payment/cash totals, cash-in/out, Z-close/count/notes/confirmation, held receipt links, recent shift history | Card layout on phone; desktop summary/table/dialogs |
| `/pos/registers` | Page visible to Manager/Admin; server CRUD currently Manager/Admin | Store/status filters, register create/edit, activate/deactivate, delete confirmation, card/table list | Mobile cards and desktop table |
| `/pos/history` | Authenticated POS roles | Register/search/date/status/payment filters, sale and return lists, held-receipt resume, receipt preview/download/share/print, return dialog, completed edit, KKM retry | Mobile cards/held merge and desktop tables/dialogs |
| `/pos/receipts` | Authenticated users through receipt procedure | Store/status/date filters, paged registry, receipt preview, CSV/XLSX export, print/download/share | Shared responsive registry |
| `/pos/debts` | Authenticated POS roles | Active-register selection, server search, pagination, debt settlement against current open shift/payment method | Mobile cards and desktop table/dialog |
| `/pos/kkm` | Manager/Admin for queue; pairing restricted to Admin | Fiscal receipt status queue, status filter, receipt retry, connector pairing code | Responsive cards/table |
| `/cash` | Authenticated application shell | Informational placeholder linking users to shift cash operations | Simple responsive card; no independent cash ledger |
| `/reports/receipts` | Agent 4 owns route; Agent 1 owns shared POS registry behavior | Reuses `ReceiptRegistry`, including the same filters/export/preview behavior as `/pos/receipts` | Shared responsive registry |

There is no POS-specific route `loading.tsx`; these pages inherit the generic `src/app/(app)/loading.tsx` transition state.

### Forms, dialogs, lists, print/export, and stateful workflows

| Surface | Forms/dialogs/lists | Loading/empty/error/retry implementation found statically |
| --- | --- | --- |
| POS landing | Register selector, open-shift dialog, shift summary | Loading and empty paths present; query-error/retry path absent |
| Sale workspace | Customer dialogs, line editor/keypad, marking-code capture, discount/notes, payment sheet, split allocation, provider reference, debt fields, hold/cancel/resume conflicts, completion/receipt, journal, return and completed-sale edit | Numerous mutation validation/errors are displayed; product/journal errors exist; several shell queries fall through to empty/disabled UI on error |
| Shift management | Cash movement form, close-shift/Z-report dialog, current X report, recent history | Loading/empty paths present; query-error/retry path absent |
| Register management | Create/edit/deactivate/delete dialogs; status/store-filtered list | Loading/empty paths present; query-error/retry path absent |
| Sale/return history | Filter bar, sales/returns/held lists, receipt/return/resume/edit dialogs | Loading/empty paths present; list query-error/retry path absent |
| Receipt registry | Store/status/date filters, paged table/cards, preview, CSV/XLSX export | Loading/empty/error path present; retry requires incidental refetch, export is limited to loaded page |
| Debts | Search/pagination, settle dialog and payment form | Loading/empty paths present; query-error/retry path absent |
| KKM | Status filter, retry action, pairing dialog | Loading/empty paths present; query-error/retry path absent; mutation errors shown |

### tRPC procedures

Router: `src/server/trpc/routers/pos.ts`.

| Namespace | Procedures |
| --- | --- |
| Entry | `entry` |
| Registers | `registers.list`, `registers.create`, `registers.update`, `registers.delete` |
| Shifts | `shifts.current`, `shifts.list`, `shifts.open`, `shifts.xReport`, `shifts.close` |
| Customers | `customers.search`, `customers.create`, `customers.update` |
| Cashiers | `cashiers.list` |
| Sales/drafts | `sales.list`, `sales.get`, `sales.editCompleted`, `sales.activeDraft`, `sales.createDraft`, `sales.updateCustomer`, `sales.updateNotes`, `sales.addLine`, `sales.updateLine`, `sales.removeLine`, `sales.updateDiscount`, `sales.upsertMarkingCodes`, `sales.cancelDraft`, `sales.holdDraft`, `sales.resumeHeldDraft`, `sales.complete`, `sales.retryKkm` |
| Returns | `returns.list`, `returns.get`, `returns.editCompleted`, `returns.createDraft`, `returns.addLine`, `returns.updateLine`, `returns.removeLine`, `returns.complete` |
| Debts | `debts.list`, `debts.settle` |
| Receipts | `receipts` |
| Cash | `cash.record` |
| KKM | `kkm.receipts`, `kkm.createPairingCode`, `kkm.retryReceipt` |

Auxiliary procedures used by POS pages are `stores.list`, `stores.hardware`, `products.bootstrap`, `products.list`, and `inventory.searchProducts`. Changes to their shared contracts require coordination with Agents 2 and 4.

### REST, streaming, and connector APIs

| Method and endpoint | Purpose | Authentication/scoping observed |
| --- | --- | --- |
| `GET /api/pos/receipts/[id]/pdf` | Render sale/return receipt PDF | Session token and organization check; no accessible-store check |
| `POST /api/printing/receipt/connector` | Build connector print payload | Session token and organization check; no accessible-store check |
| `GET /api/qz/certificate` | QZ signing certificate | Shared printing integration |
| `GET /api/qz/status` | QZ configuration/status | Shared printing integration |
| `POST /api/qz/sign` | Sign QZ print request | Shared printing integration |
| `POST /api/kkm/connector/pair` | Pair connector device | Pairing-code flow |
| `GET /api/kkm/connector/queue` | Pull fiscal receipt work | Paired device/store connector flow |
| `POST /api/kkm/connector/heartbeat` | Update connector/device health | Paired connector flow |
| `POST /api/kkm/connector/result` | Submit fiscalization outcome | Paired connector flow |
| `GET /api/sse` | Organization event stream for live POS invalidation | Organization-filtered only; no accessible-store filtering |
| `POST /api/trpc/[trpc]` | All POS tRPC queries/mutations | Procedure-dependent checks |

### Background jobs and asynchronous lifecycle

| Job/flow | States found | Audit result |
| --- | --- | --- |
| `kkm-retry-receipts` | Adapter receipts use pending/failed/sent-like states; retry job scans failed work | `FAIL`: no atomic external-side-effect claim and no complete stale-processing recovery |
| Connector receipt queue | `QUEUED`, `PROCESSING`, terminal success/failure through connector result | `FAIL`: abandoned `PROCESSING` work is not reaped/timed out |
| Manual sale/receipt KKM retry | Failed receipt may be resubmitted manually | `FAIL`: races with job/manual retries can duplicate provider calls |
| `cleanup-idempotency-keys` | Global retention cleanup | Static registration found; execution and retention behavior `NOT_RUN` |

The current fiscal receipt lifecycle does not model an explicit `completed_with_errors` state. A durable `timed_out` recovery path was not found for connector work.

### Roles and permission rules

| Role | Intended POS policy found in `docs/pos.md` | Static implementation result |
| --- | --- | --- |
| Admin | Full POS; register administration; shift close/refund confirmation | `FAIL`: store-scoped read/mutation gaps remain despite role level |
| Manager | POS operations; shift close/refund confirmation; not register administration | `FAIL`: can create/update/delete registers |
| Cashier | Open shift, sell, return initiation, cash in/out | `FAIL`: can close shifts and complete returns |
| Staff | Included by `cashierProcedure` | `FAIL`: receives the same close/refund completion authority as Cashier |
| Limited user/viewer | No such role exists in the Prisma `Role` enum | `NA` |

`cashierProcedure` permits Admin, Manager, Staff, and Cashier. `managerProcedure` permits Admin and Manager. Procedure selection is insufficient where documentation requires Admin-only register changes or Manager/Admin approval.

### Relevant database models and enums

Primary models: `CustomerOrder`, `CustomerOrderLine`, `PosRegister`, `RegisterShift`, `SalePayment`, `CashDrawerMovement`, `SaleReturn`, `SaleReturnLine`, `FiscalReceipt`, `KkmConnectorDevice`, `KkmConnectorPairingCode`, `RefundRequest`, `MarkingCodeCapture`, `IdempotencyKey`, `InventorySnapshot`, `StockMovement`, `Customer`, `Store`, `StoreProduct`, `StorePrice`, `Product`, `ProductVariant`, `StoreComplianceProfile`, `StorePrinterSettings`, and `AuditLog`.

Relevant enums: `Role`, `CustomerOrderStatus`, `RegisterShiftStatus`, `PosPaymentMethod`, `CashDrawerMovementType`, `PosReturnStatus`, `PosKkmStatus`, `KkmMode`, `FiscalReceiptStatus`, `RefundRequestStatus`, `MarkingCodeStatus`, `StockMovementType`, `PrinterPrintMode`, and `MarkingMode`.

Relevant migrations inspected:

- `20260213103000_pos_cash_register`
- `20260214042000_pos_hardening`
- `20260215021000_pos_mkassa_connector`
- `20260215024000_pos_open_shift_unique`
- `20260227223000_store_printer_settings`
- `20260228014000_fiscal_receipt_print_fields`
- `20260511143000_pos_discount_debt`
- `20260511154500_pos_debt_search_indexes`
- `20260515134000_printing_templates_auto_print`
- `20260515151500_disable_unfinished_auto_print`
- `20260614120000_pos_held_receipts`
- `20260614143000_pos_active_draft_held_scope`

## 2. Defect ledger

### HARD-A1-001

ID: `HARD-A1-001`

Route: `/pos/shifts`, `/pos/history`, `/pos/receipts`, `/pos/debts`, `/pos/kkm`, `GET /api/pos/receipts/[id]/pdf`, `POST /api/printing/receipt/connector`, `GET /api/sse`

Feature: Store-scoped POS reads and event/receipt access

Severity: P0

Role: Restricted same-organization Admin, Manager, Staff, or Cashier

Viewport: All; API-direct reproduction is viewport-independent

Reproduction: Sign in as a user whose `accessibleStoreIds` excludes store B, then omit the store filter or supply store B/register/receipt identifiers to shift-list/X-report, return-list/get, debt-list, receipt-list, KKM-list, receipt PDF/print connector, or subscribe to the organization SSE feed.

Expected: Every query, download, print payload, and event stream is constrained to stores accessible to the actor; inaccessible identifiers return a safe not-found/forbidden result.

Actual: These paths validate organization membership but do not propagate or enforce the actor's store access. The SSE stream publishes organization events containing sale/register/shift identifiers without per-store filtering.

Root cause hypothesis: The router/service contracts were designed around `organizationId` plus an optional caller-controlled `storeId`, while `ctx.user`/`assertUserStoreAccess` was not added consistently to read services and REST/SSE handlers.

Files/components: `src/server/trpc/routers/pos.ts`, `src/server/services/pos.ts`, `src/server/services/kkmConnector.ts`, `src/app/api/pos/receipts/[id]/pdf/route.ts`, `src/app/api/printing/receipt/connector/route.ts`, `src/app/api/sse/route.ts`, `src/server/events/eventBus.ts`

Evidence: `shifts.list` and `shifts.xReport` call organization-only services (`pos.ts` router around lines 270-333); `listRegisterShifts`/`getShiftXReport` filter by organization and optional store (`services/pos.ts` around lines 1478 and 1619). The same pattern occurs in `listSaleReturns`/`getSaleReturn` around 4873/4931, `listPosDebts` around 2657, `listPosReceipts` around 3856, and `listFiscalReceipts` in `kkmConnector.ts` around 404. The PDF and connector routes check token/organization around lines 87-110 and 69-90 respectively. SSE filters organization around lines 78-98 and 112-144, not accessible stores. Runtime exploitation is `NOT_RUN`.

### HARD-A1-002

ID: `HARD-A1-002`

Route: `/pos/sell`, `/pos/history`, `/pos/shifts`, `/pos/debts`, `/pos/kkm`

Feature: Store-scoped POS mutations

Severity: P0

Role: Restricted same-organization Admin, Manager, Staff, or Cashier, subject to procedure role

Viewport: All; API-direct reproduction is viewport-independent

Reproduction: From a restricted user session, call a mutation with a valid same-organization identifier from an inaccessible store: sale marking-code update, any return draft/line/completion mutation, debt settlement, cash movement, or manual KKM retry.

Expected: The server rejects every inaccessible-store target before changing stock, money, fiscal state, or audit history.

Actual: The affected router procedures omit `ctx.user`, and their services validate organization/record state without validating the actor's accessible stores. Knowledge of a target ID is sufficient to cross store boundaries.

Root cause hypothesis: Store access was implemented in selected sale/shift paths but not made a mandatory service boundary invariant for all POS mutations.

Files/components: `src/server/trpc/routers/pos.ts`, `src/server/services/pos.ts`, `src/server/services/kkmConnector.ts`

Evidence: `sales.upsertMarkingCodes` around router lines 787-804 calls the organization-only service around `services/pos.ts:3738`; return create/add/update/remove/complete router paths around 914-1090 omit the actor; `debts.settle` around 1126-1146, `cash.record` around 1188, and KKM retry paths around 893-907/1218 onward do the same. The service implementations around 2744, 4632-5630, 5659, and 5855 have no accessible-store assertion. Runtime exploitation is `NOT_RUN`.

### HARD-A1-003

ID: `HARD-A1-003`

Route: `/pos/registers`, `/pos/shifts`, `/pos/history`, `/pos/sell`

Feature: Register administration, shift close, and refund approval RBAC

Severity: P0

Role: Manager, Staff, Cashier

Viewport: All

Reproduction: As Manager, call register create/update/delete. As Cashier or Staff, call shift close or complete a return.

Expected: Per the documented POS permission matrix, only Admin administers registers, while only Manager/Admin closes a shift or confirms a refund.

Actual: Register mutations use `managerProcedure`; shift close and return completion use `cashierProcedure`, which also authorizes Staff and Cashier.

Root cause hypothesis: Coarse `managerProcedure`/`cashierProcedure` wrappers were reused instead of dedicated operation-level permission checks.

Files/components: `docs/pos.md`, `src/server/trpc/trpc.ts`, `src/server/trpc/routers/pos.ts`, `src/app/(app)/pos/registers/page.tsx`, `src/app/(app)/pos/shifts/page.tsx`

Evidence: `docs/pos.md` assigns register management to Admin and shift close/refund confirmation to Manager/Admin. `registers.create/update/delete` use `managerProcedure` around router lines 177-255; `shifts.close` around line 335 and `returns.complete` around line 1066 use `cashierProcedure`. `cashierProcedure` allows Admin, Manager, Staff, and Cashier. Authorization execution is `NOT_RUN`.

### HARD-A1-004

ID: `HARD-A1-004`

Route: `/pos/sell`

Feature: Active/held draft ownership, resume, checkout, and cashier attribution

Severity: P0

Role: Cashier or Staff sharing a store/register

Viewport: All; API-direct reproduction is viewport-independent

Reproduction: Cashier A creates or holds a draft. Cashier B obtains its ID and calls update customer/notes/discount/line, cancel, hold, or complete directly without using the explicit held-receipt resume flow.

Expected: An active draft remains owned by its creator; a held draft cannot be edited/completed until an audited resume/transfer operation assigns it to the current cashier.

Actual: The common draft lock checks organization, store access, and `DRAFT` status only. It does not require `createdById` to match the actor or `isHeld=false`. Completion attributes the sale to the completing actor, so another cashier can alter, cancel, or complete the draft and receive attribution.

Root cause hypothesis: Draft mutators centralize record/status locking but omit ownership and held-state invariants; the explicit resume transfer rule is therefore bypassable.

Files/components: `src/server/services/pos.ts`, `src/server/trpc/routers/pos.ts`, `src/app/(app)/pos/sell/page.tsx`, `src/lib/posPaymentDrafts.ts`

Evidence: `lockPosSaleDraftForEdit` around `services/pos.ts:573` filters `id`, `organizationId`, and POS draft status, then asserts store access, but neither actor ownership nor `isHeld`. Update/cancel/hold/complete services reuse that helper. `completePosSale` writes `createdById: input.actorId`, making the bypass an attribution defect. `resumeHeldDraft` is a separate explicit transfer path. Runtime concurrency/ownership tests are absent.

### HARD-A1-005

ID: `HARD-A1-005`

Route: `/pos/history`, `/pos/sell`

Feature: Return/refund quantity integrity and stock restoration

Severity: P0

Role: Authorized POS user able to create/complete returns

Viewport: All; API-direct/concurrent reproduction is viewport-independent

Reproduction: Create two return drafts for the same original sale line while its full quantity is still available, add the full quantity to each draft, then complete both drafts sequentially or concurrently.

Expected: Completion locks/revalidates the original sold line and already completed returns so total returned quantity can never exceed quantity sold.

Actual: Availability is checked while adding/updating draft lines, but completion locks only its own return. It does not revalidate the cumulative completed quantity or lock the original order line before restoring stock and refunding money.

Root cause hypothesis: A pre-completion optimistic validation was mistaken for a transactional invariant; competing/stale drafts are not serialized against the original sale line.

Files/components: `src/server/services/pos.ts`, `src/server/trpc/routers/pos.ts`, `tests/integration/pos.test.ts`

Evidence: `assertReturnLineAvailable` is called during draft add/update and completed-return edit around `services/pos.ts:4632`, `4719`, `4793`, and `5131`. `completeSaleReturn` begins around line 5396 and locks only the target `SaleReturn` around 5415-5417; no availability recheck or original-line lock occurs before inventory/refund effects. No competing-return test was found.

### HARD-A1-006

ID: `HARD-A1-006`

Route: `/pos/shifts`, `/pos/sell`

Feature: Shift close safety with active drafts

Severity: P0

Role: Manager/Admin under intended policy; currently any POS role

Viewport: All

Reproduction: Keep an unheld active sale draft on an open shift, close that shift from another tab/session, then attempt to continue or complete the sale.

Expected: Shift close is blocked while any active or held draft depends on that shift, or the active draft is explicitly transferred/cancelled with an auditable user decision.

Actual: Shift close checks only held drafts. The active cart survives client-side until checkout fails; later draft creation can auto-cancel the stale draft associated with the closed shift.

Root cause hypothesis: The close guard was added for held receipts but excludes `DRAFT` records where `isHeld=false`; stale-draft cleanup then masks the orphaned cart instead of preventing it.

Files/components: `src/server/services/pos.ts`, `src/app/(app)/pos/shifts/page.tsx`, `src/app/(app)/pos/sell/page.tsx`, `src/lib/mobilePosNavigationGuard.ts`

Evidence: `closeRegisterShift` around `services/pos.ts:1685-1694` searches only `status: DRAFT` plus `isHeld: true`. `createPosSaleDraft` around line 1840 can cancel a stale draft whose shift is closed. No active-unheld-draft shift-close integration test was found.

### HARD-A1-007

ID: `HARD-A1-007`

Route: `/pos/registers`, `/pos`, `/pos/sell`, `/pos/shifts`, `/pos/history`, `/pos/debts`

Feature: Register deactivation lifecycle

Severity: P0

Role: Manager/Admin currently able to update a register

Viewport: All

Reproduction: Deactivate a register that has an open shift, active cart, held receipt, or outstanding debt, then navigate to the dependent POS routes.

Expected: Deactivation is rejected while operational dependencies exist, or inactive registers remain available in recovery/history/settlement workflows without allowing new sales.

Actual: Register update accepts `isActive=false` without checking operational dependencies. Shared selection normalizes against active registers, making the open shift/held receipt difficult or impossible to select and close/resume; debt pages query active registers and can hide debt from settlement.

Root cause hypothesis: Register CRUD treats activation as a simple flag while POS selectors treat inactive records as nonexistent, with no lifecycle transition policy between the two.

Files/components: `src/server/services/pos.ts`, `src/server/trpc/routers/pos.ts`, `src/lib/posRegisterContext.ts`, `src/lib/usePosRegisterSelection.ts`, `src/app/(app)/pos/registers/page.tsx`, `src/app/(app)/pos/debts/page.tsx`

Evidence: `updatePosRegister` around `services/pos.ts:1073` has no open-shift/draft/debt guard. `normalizeRegisterId` in `posRegisterContext.ts` and active-list normalization in `usePosRegisterSelection.ts` reject inactive selections. History/shifts request all statuses but still use the active-only selection hook; debts requests the default active list. Lifecycle/browser recovery is `NOT_RUN`.

### HARD-A1-008

ID: `HARD-A1-008`

Route: `/pos/sell`

Feature: Store negative-stock policy during sale and completed-sale edit

Severity: P0

Role: All sale-capable roles

Viewport: All

Reproduction: Configure a store with `allowNegativeStock=false`, provide less stock than the cart quantity, and complete a POS sale or edit a completed sale upward.

Expected: POS respects the store's effective negative-stock policy and rejects a stock-depleting mutation when stock would become negative.

Actual: POS passes `allowNegativeStock: true` to stock movement handling. An existing integration test explicitly expects the store policy to be false while the snapshot becomes negative and is marked permissive.

Root cause hypothesis: POS introduced an unconditional override to avoid checkout blocking, bypassing the documented per-store policy and mutating the snapshot's policy state.

Files/components: `README.md`, `src/server/services/pos.ts`, inventory stock-movement service used by POS, `tests/integration/pos.test.ts`

Evidence: The repository documents per-store `allowNegativeStock` behavior in `README.md` around lines 152 and 419-420. POS completion passes `allowNegativeStock: true` around `services/pos.ts:4215`; completed-sale editing has the same override around line 3080. The integration test named `allows POS sale completion to drive stock negative` asserts a false store setting and a `-2` permissive snapshot. Product-owner confirmation is needed, but current behavior contradicts the documented policy.

### HARD-A1-009

ID: `HARD-A1-009`

Route: `/pos/sell`, `/pos/history`, `/pos/kkm`; KKM adapter retry job

Feature: Fiscal receipt retry idempotency and duplicate external side effects

Severity: P0

Role: Manager/Admin or background worker

Viewport: All; worker/API race is viewport-independent

Reproduction: Trigger manual sale KKM retry and receipt retry while the background retry worker selects the same failed adapter receipt, or issue two manual retries concurrently.

Expected: One atomic claim owns the retry; all other attempts observe in-progress/terminal state, and a provider idempotency key prevents duplicate fiscalization.

Actual: Each retry path reads failure state and directly calls `adapter.fiscalizeReceipt` without an atomic claim or durable provider idempotency boundary. Concurrent attempts can perform the external fiscalization more than once.

Root cause hypothesis: Database status checks and the provider call are separate, and independent manual/job entry points do not share a compare-and-set transition.

Files/components: `src/server/services/kkmConnector.ts`, `src/server/services/pos.ts`, KKM adapter implementations, `src/server/jobs/index.ts`, `src/app/(app)/pos/kkm/page.tsx`

Evidence: `retryFiscalReceipt` reads and calls the adapter around `kkmConnector.ts:439-486`; the retry job selects failed work and calls it around lines 554-574. `retryPosSaleKkm` independently invokes fiscalization around `services/pos.ts:5659-5745`. No processing claim or external idempotency token spans these paths. External APIs must be mocked in the missing race test.

### HARD-A1-010

ID: `HARD-A1-010`

Route: `/pos/kkm`; `GET /api/kkm/connector/queue`; `POST /api/kkm/connector/result`

Feature: Connector job timeout and stale-processing recovery

Severity: P1

Role: Admin/Manager operator and connector device

Viewport: All; background lifecycle is viewport-independent

Reproduction: Let a connector pull a queued receipt so it becomes `PROCESSING`, then terminate the device before it posts a result and wait beyond a reasonable lease timeout.

Expected: Work has a lease/heartbeat deadline, becomes timed out or retryable, and is safely reclaimed with duplicate protection and visible recovery status.

Actual: Queue pull moves work to `PROCESSING`; subsequent queue selection considers only `QUEUED`, while the adapter retry worker considers failed adapter receipts. No reaper/lease expiry for abandoned connector processing was found.

Root cause hypothesis: `PROCESSING` is treated as permanent ownership rather than a leased state, and connector heartbeat is not tied to receipt recovery.

Files/components: `src/server/services/kkmConnector.ts`, `src/app/api/kkm/connector/queue/route.ts`, `src/app/api/kkm/connector/heartbeat/route.ts`, `src/app/api/kkm/connector/result/route.ts`, Prisma fiscal receipt/connector models

Evidence: Connector selection/update around `kkmConnector.ts:230-276` moves only queued work to processing. Retry selection around lines 554-559 targets failed adapter receipts. No timed-out transition or scheduled stale-processing query was found. Runtime stale-job recovery is `NOT_RUN`.

### HARD-A1-011

ID: `HARD-A1-011`

Route: `/pos/receipts`, `/reports/receipts`

Feature: Receipt journal CSV/XLSX export completeness

Severity: P1

Role: Any role allowed to view receipt registry

Viewport: All

Reproduction: Create more than 100 receipts matching a registry filter, open either receipt registry route, and export CSV or XLSX.

Expected: Export includes every matching authorized receipt or clearly labels a current-page export and provides a server-side full export flow.

Actual: The component always fetches page 1 with page size 100 and exports only the loaded `receipts` array. Matching rows beyond 100 are silently omitted.

Root cause hypothesis: A client-side convenience export was built over a paged query without either iterating pages or introducing an export endpoint.

Files/components: `src/components/pos/receipt-registry.tsx`, `src/app/(app)/pos/receipts/page.tsx`, `src/app/(app)/reports/receipts/page.tsx`, `src/server/services/pos.ts`

Evidence: `ReceiptRegistry` queries `page: 1, pageSize: 100` around lines 86-94. Its export handlers map the current `receipts` array around line 170 onward. The UI does not fetch all matching pages before download. Large-dataset export is `NOT_RUN`.

### HARD-A1-012

ID: `HARD-A1-012`

Route: `/pos/history`, `/pos/shifts`, `/pos/debts`

Feature: Historical and outstanding obligations for inactive registers

Severity: P1

Role: Admin/Manager/Cashier with store access

Viewport: All

Reproduction: Deactivate a register after it has sales/shift history or an outstanding customer debt, then try to select it on history, shifts, or debts.

Expected: Inactive registers remain selectable for read-only history and authorized settlement/recovery, while new sales remain disabled.

Actual: History and shifts request all register statuses but feed them through active-only selection normalization. Debts requests the active list and filters results to the selected active register, hiding obligations tied to inactive registers.

Root cause hypothesis: A selector hook optimized for current selling context is reused for historical/settlement contexts that require inactive entities.

Files/components: `src/lib/usePosRegisterSelection.ts`, `src/lib/posRegisterContext.ts`, `src/app/(app)/pos/history/page.tsx`, `src/app/(app)/pos/shifts/page.tsx`, `src/app/(app)/pos/debts/page.tsx`

Evidence: History and shifts request register `status: "all"` near `history/page.tsx:76` and `shifts/page.tsx:58`, but selection normalization only accepts active records. Debts uses the default active query around `debts/page.tsx:55`. Browser verification is `NOT_RUN`.

### HARD-A1-013

ID: `HARD-A1-013`

Route: `/pos/sell`, `/pos/history`, `/pos/shifts`

Feature: Large-list pagination and discoverability

Severity: P2

Role: All POS roles

Viewport: All

Reproduction: Use a store with more than 80 catalog matches, more than 30 matching sales, more than 20 returns, or more than 20 shifts; attempt to browse beyond the first page without knowing a search term.

Expected: Lists expose server pagination/infinite loading with total/count context and do not silently cap data.

Actual: The sale catalog fetches page 1/80 with no load-more control; history fetches sales page 1/30 and returns page 1/20; shift history fetches page 1/20. Backend pagination exists but the pages do not expose it for these lists.

Root cause hypothesis: Initial UI limits became permanent caps after server pagination was introduced.

Files/components: `src/app/(app)/pos/sell/page.tsx`, `src/app/(app)/pos/history/page.tsx`, `src/app/(app)/pos/shifts/page.tsx`, `src/server/trpc/routers/pos.ts`

Evidence: Catalog query is fixed near `sell/page.tsx:801-807`; history queries are fixed near `history/page.tsx:114-163`; shift history uses page 1/20 near `shifts/page.tsx:89-90`. No next/load-more UI was found. Performance and large-data browser tests are `NOT_RUN`.

### HARD-A1-014

ID: `HARD-A1-014`

Route: `/pos`, `/pos/registers`, `/pos/shifts`, `/pos/history`, `/pos/debts`, `/pos/kkm`

Feature: Query API-error and retry states

Severity: P2

Role: All users of the affected route

Viewport: All

Reproduction: Make the primary register, shift, history, debt, or KKM list query return an API/network error.

Expected: Show a clear localized error, preserve user context, and provide an explicit retry action.

Actual: The affected pages implement loading and empty states but do not render the primary query's `error` state; a failure can appear as an empty/disabled workflow with no direct retry.

Root cause hypothesis: Mutation errors received dedicated handling while query rendering branches assume non-loading data is successful.

Files/components: `src/app/(app)/pos/page.tsx`, `src/app/(app)/pos/registers/page.tsx`, `src/app/(app)/pos/shifts/page.tsx`, `src/app/(app)/pos/history/page.tsx`, `src/app/(app)/pos/debts/page.tsx`, `src/app/(app)/pos/kkm/page.tsx`

Evidence: Static searches find mutation `onError` handlers but no rendered `registersQuery.error`, `salesQuery.error`, `debtsQuery.error`, or KKM receipt-query error branches in the listed pages. `/pos/sell` product/journal queries and the shared receipt registry do have partial error handling, showing the missing pattern is route-specific. Failure injection is `NOT_RUN`.

### HARD-A1-015

ID: `HARD-A1-015`

Route: `/pos/sell` mobile POS/PWA

Feature: Light/dark theme support

Severity: P2

Role: All sale-capable roles

Viewport: 390x844 and 414x896; other widths using the mobile branch

Reproduction: Select light theme and open the mobile POS catalog, sale, keypad, payment, or scanner screens.

Expected: The mobile POS follows semantic theme tokens with readable contrast in both light and dark themes.

Actual: Mobile screens use hardcoded near-black/slate backgrounds and white text, so light theme remains visually dark and bypasses shared theme tokens.

Root cause hypothesis: The mobile workspace was designed as a standalone dark interface rather than being connected to the application token system.

Files/components: `src/app/(app)/pos/sell/page.tsx`, global theme tokens/CSS (shared with Agent 4)

Evidence: Mobile render branches contain repeated `bg-[#070b14]`, `bg-slate-950`, and white/slate foreground utilities around `sell/page.tsx:6304`, `6715`, and `6990-7209`. Light/dark screenshots and contrast measurements are `NOT_RUN`.

### HARD-A1-016

ID: `HARD-A1-016`

Route: All application routes, including mobile POS/PWA

Feature: Accessibility zoom and gesture support

Severity: P2

Role: All users, especially low-vision and motor-access users

Viewport: Phone/tablet PWA and mobile browser

Reproduction: Attempt pinch zoom or browser zoom gestures on mobile POS or another application page.

Expected: Users can zoom content unless a narrowly scoped operational screen has a documented equivalent accessibility accommodation.

Actual: Global viewport metadata sets maximum scale 1 and disables user scaling; the mounted viewport-lock component also rewrites the viewport and prevents gesture/multitouch/control-wheel zoom.

Root cause hypothesis: PWA gesture suppression intended to prevent accidental POS zoom was applied globally and overrides browser accessibility controls.

Files/components: `src/app/layout.tsx`, `src/components/pwa-viewport-lock.tsx`, `src/app/providers.tsx`

Evidence: `src/app/layout.tsx:27-32` sets `maximumScale: 1` and `userScalable: false`. `pwa-viewport-lock.tsx` enforces equivalent metadata and cancels zoom gestures, and it is mounted through the global provider tree. Device/accessibility testing is `NOT_RUN`.

### HARD-A1-017

ID: `HARD-A1-017`

Route: `/pos/sell` receipt journal, `/pos/history`, `/pos/receipts`, `/reports/receipts`

Feature: Local-day date filters and exports

Severity: P2

Role: All users filtering by business day

Viewport: All; timezone-dependent

Reproduction: In a positive-offset timezone such as Asia/Bishkek, use the Today/default date preset around local midnight or before the UTC day changes, then query/export receipts or sales.

Expected: Date inputs and inclusive business-day boundaries reflect the user's/store's local calendar day.

Actual: UI helpers convert local `Date` objects with `toISOString().slice(0, 10)`, which serializes in UTC and can shift a local day backward; the resulting query can include/exclude the wrong day.

Root cause hypothesis: UTC serialization is being used as a date-only formatter without an explicit store/business timezone model.

Files/components: `src/app/(app)/pos/sell/page.tsx`, `src/app/(app)/pos/history/page.tsx`, `src/components/pos/receipt-registry.tsx`, POS date-filter services

Evidence: `formatDateInput` uses `value.toISOString().slice(0, 10)` around `sell/page.tsx:139`, `history/page.tsx:37`, and `receipt-registry.tsx:46`. Timezone-boundary browser/service tests were not found and are `NOT_RUN`.

### HARD-A1-018

ID: `HARD-A1-018`

Route: `/pos/shifts`, `/pos/history`; POS idempotent mutations/event stream

Feature: Idempotent replay of non-database side effects

Severity: P2

Role: Any authorized user retrying after a timeout

Viewport: All; network-retry reproduction is viewport-independent

Reproduction: Repeat an open-shift, close-shift, or complete-return mutation with the same idempotency key after the first database transaction committed but the client did not receive the response.

Expected: A replay returns the original result and emits no duplicate realtime, metrics, notification, or downstream side effect.

Actual: The services use the idempotency transaction but ignore its `replayed` result for these operations, then publish events after the transaction on every request. Return completion can publish duplicate inventory/refund events.

Root cause hypothesis: Idempotency protects database writes, but event publication was added outside the guarded transaction without applying the established replay check used by other POS operations.

Files/components: `src/server/services/pos.ts`, `src/server/services/idempotency.ts`, `src/server/events/eventBus.ts`

Evidence: Open/close shift destructure only the transaction result and publish afterward around `services/pos.ts:1390` and `1774`. `completeSaleReturn` starts its idempotent transaction around 5407 and publishes inventory/refund events around 5631-5648 without a replay guard. Sale/debt completion paths do inspect `replayed`, demonstrating the intended pattern. Event-count retry tests are absent.

### HARD-A1-019

ID: `HARD-A1-019`

Route: `/pos/history`, `/pos/registers`, `/pos/receipts`, `/reports/receipts`, `/pos/kkm`

Feature: Filter persistence after navigation

Severity: P2

Role: All users of filtered POS lists

Viewport: All

Reproduction: Apply non-default search/status/store/date/payment filters, open a detail or navigate to another route, then return using Back or the POS navigation.

Expected: Filters and page context survive route navigation, preferably in URL search parameters so Back/Forward and shared links are deterministic.

Actual: Most list filters live only in component state and are reset when the route unmounts; the URL does not encode the list context.

Root cause hypothesis: Local state was sufficient for initial single-page use, but navigation persistence was never designed into route-level filter state.

Files/components: `src/app/(app)/pos/history/page.tsx`, `src/app/(app)/pos/registers/page.tsx`, `src/components/pos/receipt-registry.tsx`, `src/app/(app)/pos/kkm/page.tsx`

Evidence: Search/status/date/payment/store filter values in the listed components are initialized with React state and are not read from or written to route search parameters. Register identity is persisted separately, but list-filter state is not. Back-navigation browser QA is `NOT_RUN`.

## 3. Coverage matrix

### Roles

| Role | Static access check | Browser/API matrix | Result/risk |
| --- | --- | --- | --- |
| Admin | PASS: route/procedure access exists | NOT_RUN | FAIL overall due store-scope gaps and unverified destructive flows |
| Manager | PASS: core access exists | NOT_RUN | FAIL due register-administration overreach and store-scope gaps |
| Cashier | PASS: sale/open/cash access exists | NOT_RUN | FAIL due shift-close/refund overreach and cross-cashier draft access |
| Staff | PASS: included in POS base procedure | NOT_RUN | FAIL due shift-close/refund overreach and cross-cashier draft access |
| Limited user/viewer | NA: no corresponding Prisma role | NA | NA |

### Viewports

| Viewport | Static branch found | Browser result |
| --- | --- | --- |
| 390x844 | Mobile POS and responsive cards | NOT_RUN |
| 414x896 | Mobile POS and responsive cards | NOT_RUN |
| 768/tablet | Desktop workspace shell with tablet checkout behavior | NOT_RUN |
| 1440 desktop | Desktop tables/catalog/cart | NOT_RUN |
| Large desktop | Desktop max-width/layout paths | NOT_RUN |

The main sale page uses a phone cutoff below 768 px; 768 px enters the desktop workspace while checkout remains a bottom-sheet style until the large breakpoint. This boundary needs explicit 767/768 browser coverage.

### Themes

| Theme | Static result | Browser/contrast result |
| --- | --- | --- |
| Light | FAIL for mobile POS due hardcoded dark palette | NOT_RUN |
| Dark | Static styles present | NOT_RUN |

### Data states

| State | Static result | Required runtime follow-up |
| --- | --- | --- |
| Empty | Empty-state branches found on main lists | Browser NOT_RUN; query-error false-empty must be distinguished |
| One record | No code-specific blocker found | NOT_RUN |
| Normal data | Primary flows implemented | NOT_RUN |
| Many records | FAIL: several route caps and incomplete export | Seeded pagination/export/performance suite |
| Negative stock | FAIL: POS forces permissive override | Policy-backed integration and concurrent stock test |
| Missing price/cost/image | Free-price/manual price and image fallbacks exist statically | Product-policy and browser validation NOT_RUN |
| Archived/inactive data | FAIL: inactive register history/debt/recovery gaps | Inactive-register lifecycle suite |
| Stale/incomplete job | FAIL: connector processing can remain stuck | Fake-clock worker/connector recovery suite |
| Invalid/deactivated relation | Partial validation exists; deactivated register is unsafe | Mutation and route recovery tests NOT_RUN |

### UI states

| State | Static result | Runtime result |
| --- | --- | --- |
| Loading | Loading indicators/route fallback found | NOT_RUN |
| Skeleton | Generic application loading route; not all POS tables have dedicated skeletons | NOT_RUN |
| Success | Success/toast/receipt states found | NOT_RUN |
| Empty | Empty states found | NOT_RUN |
| Validation error | Zod/service checks and form messages found | NOT_RUN |
| API error | FAIL on multiple primary queries | Failure injection NOT_RUN |
| Retry | Partial for mutations/KKM; FAIL for several primary queries | Network retry NOT_RUN |

### Actions

| Action | Static implementation | Audit result |
| --- | --- | --- |
| Create | Registers, shifts, drafts, customers, returns, cash, payment | FAIL until auth/store/concurrency defects are closed |
| View | Routes and detail/receipt dialogs exist | FAIL due cross-store read exposure |
| Edit | Register, draft, completed sale/return, customer, lines/discount | FAIL due draft ownership and store-scope gaps |
| Archive/deactivate | Register activation flag | FAIL due unsafe live dependency handling |
| Delete/cancel | Register delete, draft cancel, sale/order cancellation semantics | NOT_RUN; RBAC and ownership failures apply |
| Print | Receipt/precheck/QZ/connector/PDF paths found | NOT_RUN; cross-store access failure applies |
| Export | Receipt CSV/XLSX found | FAIL: silently exports only first 100 rows |
| Navigate back with filters | Most filters are component-local | FAIL |

## 4. Business-flow invariant assessment

| Invariant | Result | Evidence summary |
| --- | --- | --- |
| Authorization | FAIL | Operation-level RBAC contradicts documented register/close/refund policy |
| Organization scoping | Static organization filters are widespread | Runtime NOT_RUN |
| Store scoping | FAIL | Read and mutation families omit actor store access |
| Validation | MIXED | Strong amount/status/Zod validation; return completion and draft held/owner invariants missing |
| Transactionality | MIXED | Core DB sale/refund/cash/shift writes use transactions; external KKM side effect is outside atomic ownership |
| Idempotency | FAIL | DB replay exists, but event and KKM external side effects are not consistently replay-safe |
| Audit history | MIXED | Major operations write audit history; stale draft auto-cancel and some recovery paths need explicit verification |
| Retry behavior | FAIL | KKM manual/job races and stale connector work; primary queries often lack retry UI |
| User-facing errors | MIXED | Mutations generally map/display errors; query failures often look empty/disabled |
| Raw provider/database errors | Static mapping exists in many paths | Failure injection NOT_RUN |
| Duplicate side effects | FAIL | Return/shift event replay and KKM external retry races |

## 5. Existing tests and test gaps

### Existing coverage inventoried

- `tests/integration/pos.test.ts` covers many shift, held/resume, checkout/payment/stock, completed edit, marking, return, cash, debt, idempotency, store-access, and KKM paths. It is substantial but mostly happy-path/sequential and does not close the cross-store matrix.
- Unit/source suites cover POS entry source, register-management source, sale math, payment drafts, mobile state/navigation guard, register context/selection, cash accounting, receipt payload/PDF route, PWA source/manifest, printing adapter, and QZ signing.
- No POS Playwright/browser suite was found. Existing browser coverage targets Bazaar catalog behavior, not owned POS flows.

### Baseline owned test drift

The coordinator's baseline run reports `tests/unit/pos-entry-source.test.ts` failing at line 177 because its string slice expects `clearCartRuntimeSyncState()` between the `completeMutation` declaration and `const sale = saleQuery.data`. The implementation was refactored: cleanup now lives in `handleConfirmedCompletion` around `src/app/(app)/pos/sell/page.tsx:2592-2630`, including the call around line 2627, and both debt and payment completion paths call that handler around lines 2760 and 2812. This is a brittle source-string assertion whose extraction boundary no longer includes the behavior. It is test drift, not proof the cleanup is absent. Replace it with a behavior-level completion test (or, at minimum, target the helper/call graph) during implementation. A second baseline failing file is outside this agent's reported ownership.

### Required new coverage

1. Data-driven authorization/store matrix for every POS query and mutation across Admin/Manager/Cashier/Staff, permitted store, inaccessible store, omitted store filter, and foreign-organization ID.
2. REST PDF/print and SSE tests proving store-level denial/filtering, including indistinguishable not-found behavior.
3. Draft ownership tests across two cashiers: active edits, cancel, hold, direct held completion, explicit resume transfer, actor/register/shift attribution, and concurrent tabs.
4. Concurrent return tests: competing drafts and simultaneous completion can never return/refund/restore more than sold.
5. Shift-close tests with active and held drafts; register deactivate/delete tests with open shift, active/held draft, history, and debt.
6. Store negative-stock policy tests for sale completion, completed-sale edit, return, retry, and concurrent stock movements. Resolve the current contradictory test with product policy rather than simply changing its expectation.
7. Mocked KKM adapter tests for concurrent manual/job retries, provider idempotency, process crash after claim/provider call, connector lease expiry, heartbeat, late result, retry, and terminal failure.
8. Idempotency replay assertions that count database writes and non-database events for shift open/close, sale, return, cash, and debt.
9. Large-dataset tests for catalog/history/shifts/receipts/debts: search, filters, sorting, page boundaries, total counts, and full export-only-authorized behavior.
10. Browser suite at 390x844, 414x896, 768, 1440, and large desktop; light/dark; empty/loading/API error/retry; console/network error capture; keyboard/focus/dialog behavior; pinch/zoom accessibility.
11. Timezone tests using store/user local dates around UTC boundaries and DST-capable zones, even though the current audit timezone has no DST.
12. Warm performance measurements for core POS visibility, product input/click under 100 ms, checkout API, and a network assertion that cart editing does not refetch the product list.
13. Offline/PWA tests for service-worker update behavior, stale asset/API handling, reconnection, navigation guards, and explicit prevention of offline money/stock mutations unless designed and idempotent.

Source-string tests are insufficient for the P0 flows above. DB-backed tests must use the agent's isolated database and must not truncate another agent's data. Marketplace/email/fiscal provider calls must be mocked.

## 6. Proposed implementation batches

### Batch A1.0 — Authorization and store boundaries (P0)

- Introduce mandatory actor/store authorization at POS service boundaries, not only UI/router filters.
- Apply it to all listed reads/mutations, receipt PDF/print payload endpoints, and store-filtered SSE delivery.
- Implement the documented Admin-only register and Manager/Admin close/refund permissions.
- Enforce active draft owner and held-state invariants; preserve explicit, audited resume/transfer.
- Add the full role/store/API matrix before integration.

### Batch A1.1 — Stock, refund, shift, and register correctness (P0)

- Revalidate and serialize return availability at completion.
- Block shift close on every dependent active/held draft.
- Define and enforce register deactivate/delete lifecycle with recoverable history/debt/shift access.
- Resolve and enforce the effective negative-stock policy with Agent 2; remove any unsafe unconditional override.
- Verify money, stock, attribution, audit, and idempotency under concurrency.

### Batch A1.2 — Fiscal/connector lifecycle (P0/P1)

- Add a single atomic claim/lease and provider idempotency contract shared by manual and background retries.
- Add timeout/recovery for connector `PROCESSING`, safe late-result handling, and observable failure reasons.
- Mock adapters and test crash/retry/race scenarios; do not call external KKM services in automation.

### Batch A1.3 — History, export, and inactive context (P1/P2)

- Add server-backed pagination/load-more and totals to capped lists.
- Replace current-page receipt export with a complete authorized server export, or label/offer page export explicitly.
- Separate active selling-register selection from inactive history/debt/recovery selection.
- Persist filters/page in URL state and validate Back/Forward behavior.

### Batch A1.4 — UI resilience, theme, accessibility, and dates (P2)

- Add explicit primary-query error and retry states.
- Replace hardcoded mobile colors with coordinated semantic tokens and validate light/dark contrast.
- Scope/remove global zoom suppression with Agent 4.
- Introduce local/store timezone-safe date-only helpers.
- Replace the drifted source-string test with behavior coverage.

### Batch A1.5 — Independent browser/performance verification

- Run the complete role/viewport/theme/data/UI/action matrix on Preview.
- Capture screenshots/contact sheets and machine-readable console/network/timing evidence.
- Measure warmed routes separately from cold Next compilation.
- Hand every resolved issue to Agent 4 for independent release-gate verification.

## 7. Anticipated shared-file conflicts and ownership coordination

| Shared area | Likely owner/coordination | Reason |
| --- | --- | --- |
| `src/server/services/pos.ts`, `src/server/trpc/routers/pos.ts` | Agent 1 primary | Central POS business logic and permissions |
| Inventory movement service and negative-stock policy | Coordinate with Agent 2 | POS completion/edit/returns apply inventory effects owned by Products & Inventory |
| Prisma schema/migrations | Serialized shared ownership across agents | KKM leases/idempotency or authorization changes may require schema work; one writer at a time; migrations only, never `db push` |
| KKM services, job registry, adapter/provider contracts | Agent 1 with Agent 3/Agent 4 review | POS fiscal behavior overlaps integrations and platform job lifecycle |
| Receipt registry and `/reports/receipts` | Agent 1 component logic; Agent 4 route/release review | One shared component serves owned POS and Reports route |
| `src/app/api/sse/route.ts`, event bus, shared query/cache | Coordinate with Agent 4 | Platform-wide live updates and cache invalidation |
| `src/app/layout.tsx`, providers, PWA components, `public/sw.js`, global CSS/tokens | Agent 4 primary; Agent 1 supplies POS requirements | Zoom, theme, service-worker, app-shell changes are global |
| Auth/RBAC helpers and role access | Agent 4 shared-file owner; Agent 1 defines POS operation matrix | Global authorization behavior must not regress other domains |
| Store/printer settings and QZ/shared printing | Coordinate with Agent 4 | Settings and platform print transport are shared |
| Translations/messages | Serialized shared ownership | New errors/statuses require localized copy in shared catalogs |
| Package dependencies | Agent 4 integration control | No new dependency should be introduced for a local POS defect without review |

No shared file should be modified for these findings until it is assigned in `docs/hardening/SHARED_FILE_OWNERSHIP.md`. Agent 4 must independently verify the domain fixes and cross-review any Agent 4-authored shared-platform change with another agent.

## 8. Phase A handoff

- Defect totals: 9 P0, 3 P1, 7 P2, 0 P3.
- Highest release blockers: cross-store data/mutation exposure, documented RBAC violations, cross-cashier/held-draft bypass, over-return race, unsafe shift/register lifecycle, negative-stock policy bypass, and duplicate fiscalization risk.
- Evidence strength: all defects are source-confirmed hypotheses with precise paths; none has yet met the runtime reproduction, browser evidence, performance, or independent-verification parts of the Definition of Done.
- Release status: `FAIL` for Phase B entry until every P0 has an assigned owner/test design. Preview and Production release gates remain `NOT_RUN`.
