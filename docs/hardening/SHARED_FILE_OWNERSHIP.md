# Hardening shared-file ownership

Baseline: `4d7c9b33218b584334ca62f7a816f8997f144a10`

Status: Phase B0 infrastructure complete. Domain implementation locks remain inactive until the approved B0 commits are integrated and the first P0 batch is explicitly claimed.

## Rules

1. One named agent owns a shared file or file family for one implementation batch at a time.
2. The owner records the issue IDs, exact files, start commit, intended tests, and expected handoff before editing.
3. Other agents do not edit a claimed file. They send requirements and candidate patches to the owner.
4. A claim ends only after the commit is reviewed, integrated, and the ledger records the released files.
5. Prisma changes use checked-in migrations only. `db push` is prohibited.
6. Package additions require Agent 4 coordination, lockfile review, build verification, and a reason existing dependencies are insufficient.
7. A local defect must not be fixed through a shared primitive without regression coverage for all known consumers.
8. Agent 4 does not silently fix domain business logic. The domain owner authors the correction; Agent 4 independently verifies it.
9. Changes authored by Agent 4 require cross-review from Agent 1, 2, or 3 before integration.
10. Emergency P0 work still follows these locks unless the user explicitly approves the production-incident exception.

## Ownership table

| Shared area | Files/families | Coordinating owner | Required reviewers | Known domain consumers |
| --- | --- | --- | --- | --- |
| Route and feature RBAC | `middleware.ts`, `src/lib/roleAccess.ts`, shared tRPC authorization middleware, `src/server/services/storeAccess.ts` | Agent 4 | Every affected domain owner | All agents |
| Authentication/session | NextAuth configuration, session typing, auth-token and impersonation helpers | Agent 4 | Agent 3 for API behavior; affected domain owner | All agents |
| Prisma schema/migrations | `prisma/schema.prisma`, `prisma/migrations/**`, generated client contract | Agent 4 serializes authorship; domain owner authors domain semantics | At least Agent 4 plus one other affected owner | All agents |
| Query/cache/runtime events | tRPC/query-client configuration, invalidation helpers, SSE event bus and `/api/sse` | Agent 4 | Agent 1 for POS latency; Agent 2/3 when their events change | All agents |
| Background-job framework | `src/server/jobs/index.ts`, shared lock/retry/dead-letter helpers and status enums | Agent 4 | Agent 3 mandatory; domain owner for each registered job | Agents 2–4 |
| Global app shell/navigation | app layout, `AppShell`, sidebar, mobile shell/navigation, command palette, global search overlay | Agent 4 | Domain owner for changed navigation/search result types | All agents |
| Shared UI primitives | `src/components/ui/**`, especially modal/dialog/sheet/table/form primitives | Agent 4 | One domain owner with representative consumer coverage | All agents |
| Global styles/design tokens | global CSS, Tailwind/theme tokens, font loading, theme synchronization | Agent 4 | One domain owner plus light/dark and mobile regression evidence | All agents |
| Localization | translation catalogs, locale types/configuration, shared labels | Agent 4 serializes edits; originating domain supplies copy | A second agent and `pnpm i18n:check` | All agents |
| Dependencies/build config | `package.json`, `pnpm-lock.yaml`, Next/Vercel/build/lint/test configuration | Agent 4 | A second agent; domain owner if dependency-specific | All agents |
| Printing framework | QZ/connector transport, shared receipt/document print primitives and store printer settings | Agent 4 coordinates | Agents 1 and 2 mandatory | POS and Inventory |
| Export orchestration | export router/service, export job lifecycle, download endpoint and common serializers | Agent 4 | Agents 1–3 review their row semantics | All domains |
| Audit history | common audit-log writer, metadata conventions, actor/store attribution helpers | Agent 4 coordinates | Every affected domain owner | All agents |
| Test database harness | `tests/global-setup.ts`, `tests/helpers/db.ts`, database scripts/env conventions | Agent 4 | One domain agent running DB tests | All agents |
| Browser regression harness | Playwright configuration, authentication fixtures, route matrix/reporters, screenshot/contact-sheet tooling | Agent 4 | Agents 1–3 approve their flow fixtures | All agents |

## Domain-owned overlap boundaries

| Overlap | Domain author | Coordinator/reviewer | Boundary |
| --- | --- | --- | --- |
| Receipt registry and POS printing | Agent 1 | Agent 4 | Agent 1 owns receipt correctness; Agent 4 owns shared printing transport and platform accessibility.
| Product category visibility, attributes, units, imports, store assignment | Agent 2 | Agent 4 | Agent 2 owns product/inventory semantics; Agent 4 owns settings route authorization and shell.
| Sales metrics fed by API orders | Agent 3 | Agent 4 | Agent 3 owns order lifecycle semantics; Agent 4 owns analytics presentation and feature authorization.
| Marketplace/email jobs on shared runner | Agent 3 | Agent 4 | Agent 3 owns provider state machines; Agent 4 owns common leasing, retry, timeout, and dead-letter behavior.
| Export rows sourced from POS/inventory/orders | Respective Agents 1/2/3 | Agent 4 | Domain owners validate values; Agent 4 owns authorization, queueing, file retention, and download delivery.
| Store/register attribution | Agent 1 for POS; Agent 2/3 for their mutations | Agent 4 | Shared store-access helpers change only through a coordinated RBAC batch.

## Claim record template

Add one row before starting a shared-file implementation batch.

| State | Batch/issues | Owner | Start commit | Exact files | Required tests | Reviewers | Released commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RELEASED | `B0-DB-SAFETY` / `HARD-A4-010` | Agent 4 | `f308b2b793c2b43d7e46814c3c2007a0927fede7` | `tests/global-setup.ts`, `tests/setup.ts`, `tests/helpers/db.ts`, `tests/helpers/testDatabaseSafety.ts`, `tests/unit/test-database-safety.test.ts`, `.env.example`, `.github/workflows/ci.yml` | 20 focused guard tests, isolated migration/reset proof, CI no-skip policy, full 884-test baseline | Agent 1 — APPROVED | `584c37d`, `d6079b7` |
| RELEASED | `B0-PLATFORM-P0-EVIDENCE` / `HARD-A4-001..011` | Agent 4 | `f308b2b793c2b43d7e46814c3c2007a0927fede7` | `tests/integration/b0-platform-p0-verification.test.ts`, `tests/integration/b0-platform-sse-p0-verification.test.ts`, `tests/unit/b0-platform-route-access-verification.test.ts`, `docs/hardening/B0_AGENT_4_P0_VERIFICATION.md` | 31 focused evidence/guard tests, Agent 4 isolated DB/Redis, full baseline | Agent 1 — APPROVED after timezone-state and command corrections | `4f1ae32`, `aaad412` |
| Example only | `HARD-A4-001` | Agent 4 | baseline SHA | `src/lib/roleAccess.ts` | unit + two-role integration + browser denial | affected domain owners | pending |

Allowed states: `PROPOSED`, `CLAIMED`, `IN_REVIEW`, `INTEGRATED`, `RELEASED`.

## Required handoff for a shared change

- Issue IDs and confirmed root cause.
- Exact before/after behavior and authorization matrix.
- Migration name and rollback procedure, if applicable.
- Unit/integration/browser evidence appropriate to risk.
- Desktop/mobile and light/dark evidence for visual primitives.
- Query invalidation, caching, retry, and idempotency impact.
- Bundle/performance comparison when runtime or dependencies change.
- Cross-review identity, decision, and unresolved comments.
- Integration commit and Preview verification result.

## Phase A anticipated contention

- RBAC work is expected to touch route policy, server procedure middleware, store-access checks, search, SSE, exports, and settings. It must be one coordinated authorization batch, not parallel edits.
- Job recovery work overlaps export, marketplace, email, diagnostics, and cleanup workers. Agree on the common lifecycle before domain job changes.
- Schema changes may be requested by POS, inventory, integration jobs, and export status recovery. Migrations must be ordered and rebased onto the integration branch one at a time.
- Modal/dialog accessibility affects a large cross-domain surface. Change the primitive only after representative POS, inventory, commerce, settings, keyboard, and focus regression cases exist.
- Translation and package-lock churn is centralized to avoid conflicts that conceal missing strings or dependency changes.
