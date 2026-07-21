# Bazaar hardening Phase A summary

Audit date: 2026-07-22

Baseline commit: `4d7c9b33218b584334ca62f7a816f8997f144a10` (`Fix POS register and cashier context`)

Annotated tag: `hardening-baseline-2026-07-22`

Integration branch: `hardening/integration`

Phase A is audit-only. No application, schema, migration, test, dependency, runtime configuration, or production file was changed. No external marketplace/email API was called. No database was mutated.

## Branch and worktree topology

| Agent | Branch | Isolated worktree | Original audit commit |
| --- | --- | --- | --- |
| 1 — POS & Cash | `hardening/agent-1-pos` | `/private/tmp/bazaar-hardening-agent-1-pos` | `ef90d69cf79bedb1fba689cd5cc06f21b0d768ed` |
| 2 — Products & Inventory | `hardening/agent-2-inventory` | `/private/tmp/bazaar-hardening-agent-2-inventory` | `d4f8e741b1c54af53bfee2065ff9565c1c417ebe` |
| 3 — Orders, APIs & Integrations | `hardening/agent-3-commerce` | `/private/tmp/bazaar-hardening-agent-3-commerce` | `09af3da053519050aef4e00a08353856fb55458c`; supplement `680f9ddb3d5e5b82ceb6c8339643cfe2816d347a` |
| 4 — Platform QA & Release Gate | `hardening/agent-4-platform-qa` | `/private/tmp/bazaar-hardening-agent-4-platform-qa` | `a8b5b208515db65a573591c6f99231a12c411a86` audit; consolidation commit pending cross-review |

The original repository worktree remains on `main`; it was used only for read-only baseline checks. Audit documents are committed to hardening branches, so their only copy is not under ignored temporary storage.

## First-deliverable artifacts

- [Agent 1 POS audit](./AGENT_1_POS_AUDIT.md)
- [Agent 2 Products and Inventory audit](./AGENT_2_INVENTORY_AUDIT.md)
- [Agent 3 Commerce audit](./AGENT_3_COMMERCE_AUDIT.md)
- [Agent 4 Platform audit](./AGENT_4_PLATFORM_QA_AUDIT.md)
- [Master issue ledger](./MASTER_ISSUE_LEDGER.md)
- [Master route matrix](./MASTER_ROUTE_MATRIX.md)
- [Shared-file ownership](./SHARED_FILE_OWNERSHIP.md)

Each agent audit includes owned route/API/procedure/job/model inventories, full defect records, evidence, test gaps, implementation batches, and anticipated shared-file conflicts.

## Findings

| Owner | P0 | P1 | P2 | Total | Highest-risk themes |
| --- | ---: | ---: | ---: | ---: | --- |
| Agent 1 | 9 | 3 | 7 | 19 | POS store scope, draft/cashier attribution, over-return races, unsafe register/shift lifecycle, stock policy bypass, duplicate fiscalization |
| Agent 2 | 11 | 3 | 3 | 17 | inventory/store scope, product mutation scope, replay safety, bulk atomicity, print/export authorization, receiving draft isolation |
| Agent 3 | 15 | 7 | 5 | 27 | double stock deduction, revoked API-key cache, order/PO/public-checkout idempotency, customer/integration scope, stale public prices, image-proxy SSRF, invalid return mode |
| Agent 4 | 11 | 4 | 4 | 19 | platform RBAC, SSE/search/export leakage, period-close money/timezone, test DB isolation, dead-letter tenancy, export recovery, accessibility |
| **Total** | **46** | **17** | **19** | **82** | No P3-only polish was prioritized while critical risk remains |

No issue is fixed or independently verified. Static severity is provisional until browser/API reproduction confirms behavior, but P0 handling remains conservative where money, stock, authorization, tenancy, attribution, or irreversible actions are implicated.

## Baseline verification

| Check | Result | Evidence/interpretation |
| --- | --- | --- |
| `pnpm typecheck` | PASS | Baseline main worktree |
| `pnpm lint` | PASS | No warnings reported |
| `pnpm i18n:check` | PASS | Locale catalog check completed |
| `pnpm build` | PASS | 81 generated route entries; bundle-size concerns captured under HARD-A4-017 |
| `pnpm exec vitest run tests/unit` | FAIL | 113 files/543 tests passed; 2 files/2 tests failed: POS source assertion and mobile Products source assertion |
| DB-backed integration tests | NOT_RUN | Current setup derives one shared test DB and truncates its public schema; unsafe for parallel worktrees (HARD-A4-010) |
| Authenticated browser/Preview smoke | NOT_RUN | No isolated DB fixtures, role identities, or Preview deployment were provisioned during audit-only Phase A |
| Responsive/theme/accessibility matrix | NOT_RUN | Static surfaces inventoried; rendered evidence remains required |
| Provider integrations | NOT_RUN | Automated tests must mock marketplace/email providers |
| Production | NOT_RUN | Explicitly outside the first deliverable |

Cold local Next compilation is not treated as a product metric. Warm route/input/API timings remain pending Preview fixtures.

## Proposed implementation batches

The order below respects severity and shared-file contention. A batch starts only after its shared-file claim and isolated test environment are recorded.

1. **Safety harness and authorization policy** — HARD-A4-010 first; provision four explicit DB URLs and a database-identity guard. Then align route, tRPC, HTTP download/print, search, SSE, dead-letter, billing, settings, and store-access policies for HARD-A1-001–003, HARD-A2-001–003/008–010, HARD-A3-006–008, and HARD-A4-001–006/009/011.
2. **Transactional money and stock correctness** — over-return and shift/register invariants; negative-stock policy; product initial stock, scanner replay, and bulk atomicity; API order double deduction, product-store assignment, return-mode behavior, bulk PO cancel; public catalogue price consistency; period-close monetary/timezone correctness.
3. **Idempotency and external side effects** — draft ownership/attribution, product/import/price replay, order/PO/API/public-checkout idempotency and external identity, KKM claim/fiscalization, email-campaign send and confirmation delivery, cache invalidation, audit-event deduplication, and catalogue mutation audit history.
4. **Durable background lifecycles** — shared job leases/claims, queued dispatch, stale processing/running recovery, timeouts, retry semantics, partial-success representation, dead-letter isolation, and process-crash tests across exports, marketplaces, AI, email, and KKM.
5. **P1 document/print/export readiness** — receipt full-result export, inactive-register history, image ZIP durability, connector labels, attribute evolution, and removal or implementation of placeholder cash/finance routes.
6. **Operational UI and scale** — image-proxy SSRF and source-policy alignment, explicit error/retry states, server pagination (including public catalogue), filter persistence, local-day filters, responsive parity, accessible zoom/dialog focus, light/dark validation, bundle/font reductions, and warmed performance evidence.
7. **Independent release gate** — Agent 4 browser regression across every route/role/viewport/theme/state, Agent 1–3 defect verification, Preview smoke, contact sheets, performance/RBAC/migration reports, known limitations, rollback plan, and the full required command gate.

## Hold points before implementation

- Four unique databases/environments must be provisioned and positively identified; the current test reset must not run concurrently.
- The shared authorization and job-lifecycle designs must be agreed before separate domain patches touch common helpers.
- Prisma migrations are serialized on integration; `db push` remains prohibited.
- Agent 3 provider tests must use mocks; live email/marketplace side effects are not authorized.
- Agent 4-authored audit and consolidation changes require cross-review before integration.
- `hardening/integration` remains the only integration target. Nothing is pushed or merged to `main` during this phase.

## Phase A disposition

The repository is not release-ready and implementation should not begin as disconnected local fixes. The first controlled work is the test-environment isolation and authorization contract batch, followed by the P0 money/stock/idempotency batches above. Final success cannot be declared from local QA or CI alone.
