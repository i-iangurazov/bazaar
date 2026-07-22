# Phase B0 — Agent 4 P0 Verification

## Scope and safety identity

- Accepted integration baseline: `f308b2b793c2b43d7e46814c3c2007a0927fede7`.
- Worktree: `/private/tmp/bazaar-b0-agent-4-platform`.
- Database: `bazaar_hardening_agent4_platform` on local PostgreSQL only.
- Redis namespace: local Redis logical database `14`, identity `agent4-platform`.
- Provider mode: local/log or mocked; no production, Preview Production, marketplace, email, or fiscal provider was contacted.
- Migration state: all 87 checked-in migrations applied with `prisma migrate deploy`; `db push` was not used.

The destructive-test guard validated `NODE_ENV=test`, `RUN_DB_TESTS=1`,
`ALLOW_TEST_DB_RESET=1`, exact `EXPECTED_TEST_DB_NAME`, the hardcoded database
allowlist and suffix, the URL database identity, and the non-production local host
before every reset in this verification.

## Classification

| ID | Classification | Runtime evidence | Root cause group | Files likely involved |
| --- | --- | --- | --- | --- |
| HARD-A4-001 | CONFIRMED | Cashier `dashboard.summary` and Staff `analytics.salesTrend` both returned data although their route permissions deny Dashboard/Reports. | `RC-P0-AUTH-READ-BOUNDARY` | `src/server/trpc/routers/dashboard.ts`, `src/server/trpc/routers/analytics.ts`, `src/lib/roleAccess.ts` |
| HARD-A4-002 | CONFIRMED | Cashier `billing.get` returned a rejected upgrade request's private request message and platform review note. | `RC-P0-AUTH-READ-BOUNDARY` | `src/server/trpc/routers/billing.ts`, `src/server/services/billing.ts` |
| HARD-A4-003 | CONFIRMED | Cashier listed and read a completed receipts export and `resolveExportJobDownload` returned the CSV stream and receipt columns. | `RC-P0-AUTH-READ-BOUNDARY` | `src/server/trpc/routers/exports.ts`, `src/app/api/exports/[id]/route.ts`, `src/server/services/exports.ts` |
| HARD-A4-004 | CONFIRMED | Cashier exact-searching an assigned store code received a `store` result even though the role has no `viewStores` permission. | `RC-P0-SEARCH-CLIENT-ONLY-AUTH` | `src/server/trpc/routers/search.ts`, `src/server/services/search/global.ts`, `src/components/command-palette.tsx` |
| HARD-A4-005 | CONFIRMED | An authenticated Cashier assigned only Store A received an `inventory.updated` SSE event containing Store B's ID from the same organization. | `RC-P0-SSE-ORG-ONLY-SCOPE` | `src/app/api/sse/route.ts`, `src/server/events/eventBus.ts`, `src/server/services/storeAccess.ts` |
| HARD-A4-006 | CONFIRMED | A Manager assigned only the seeded store successfully closed an unassigned same-organization store; the resulting `PeriodClose.closedById` was that Manager. | `RC-P0-PERIOD-CLOSE-SCOPE` | `src/server/trpc/routers/periodClose.ts`, `src/server/services/periodClose.ts` |
| HARD-A4-007 | CONFIRMED | For SALE quantity 2 / KGS 600 and RECEIVE quantity 5 / KGS 1000, persisted fields named `salesTotalKgs` and `purchasesTotalKgs` were `2` and `5`. | `RC-P0-PERIOD-CLOSE-TOTALS` | `src/server/services/periodClose.ts`, `src/server/services/exports.ts` |
| HARD-A4-008 | CONFIRMED | With the server timezone set to UTC, a KGS 900 sale at 01:30 Bishkek on the current business date produced `todaySalesKgs=0`. | `RC-P0-BUSINESS-DAY-BOUNDS` | `src/server/services/dashboard/summary.ts`, `src/server/trpc/routers/reports.ts`, `src/lib/timezone.ts` |
| HARD-A4-009 | CONFIRMED | An organization Admin listed a null-organization dead-letter job containing a provider reference and resolved it as that tenant user. | `RC-P0-GLOBAL-JOB-TENANT-SCOPE` | `src/server/services/deadLetterJobs.ts`, `src/server/trpc/routers/adminJobs.ts`, `src/server/jobs/index.ts` |
| HARD-A4-010 | CONFIRMED | Phase A harness used an inferred shared database and whole-schema truncate. The B0 guard now rejects missing flags, mismatched/unallowlisted database names, production hosts, and implicit `DATABASE_URL` fallback before destructive SQL. | `RC-P0-TEST-DB-IDENTITY` | `tests/global-setup.ts`, `tests/setup.ts`, `tests/helpers/db.ts`, `tests/helpers/testDatabaseSafety.ts`, `.github/workflows/ci.yml` |
| HARD-A4-011 | CONFIRMED | `canAccessAppRoute` returned `true` for a Cashier on both `/settings/store-groups` and `/settings/categories` while the corresponding settings/product permissions returned `false`. | `RC-P0-ROUTE-RULE-OMISSION` | `src/lib/roleAccess.ts`, `middleware.ts` |

Agent 4 result: **11 CONFIRMED, 0 DUPLICATE, 0 DOWNGRADED, 0 FALSE_POSITIVE,
0 BLOCKED_BY_ENVIRONMENT** before cross-agent consolidation. `HARD-A4-005`
overlaps the Agent 1 SSE impact report and may be marked `DUPLICATE` in the master
ledger once Agent 1's independent runtime result is available. That consolidation
does not remove the verified shared-platform impact.

## Machine-readable evidence

| Evidence file | Findings | Result |
| --- | --- | --- |
| `tests/integration/b0-platform-p0-verification.test.ts` | HARD-A4-001 through 004, HARD-A4-006 through 009 | 8/8 PASS against `bazaar_hardening_agent4_platform` |
| `tests/integration/b0-platform-sse-p0-verification.test.ts` | HARD-A4-005 | 1/1 PASS against the isolated DB/Redis environment |
| `tests/unit/b0-platform-route-access-verification.test.ts` | HARD-A4-011 | 2/2 PASS |
| `tests/unit/test-database-safety.test.ts` | HARD-A4-010 guard failure/success matrix | 20/20 PASS |

Targeted verification command:

```bash
set -a
source .env.hardening
set +a
pnpm exec vitest run \
  tests/integration/b0-platform-p0-verification.test.ts \
  tests/integration/b0-platform-sse-p0-verification.test.ts \
  tests/unit/b0-platform-route-access-verification.test.ts \
  tests/unit/test-database-safety.test.ts \
  --maxWorkers=1 --minWorkers=1
```

The evidence tests intentionally describe and assert the accepted baseline's unsafe
behavior. During the owning P0 batch, each must be inverted to assert the corrected
authorization or calculation before the issue can close.

## Root-cause consolidation

| Root Cause Group | Primary Issue | Related/duplicate candidates | Affected routes | Owning agent | Shared files |
| --- | --- | --- | --- | --- | --- |
| `RC-P0-AUTH-READ-BOUNDARY` | HARD-A4-001 | HARD-A4-002, HARD-A4-003 share the same UI-only vs server-policy pattern but remain distinct protected data surfaces | `/dashboard`, `/reports/analytics`, `/billing`, `/reports/exports`, `/api/exports/[id]` | Agent 4 | auth/RBAC helpers |
| `RC-P0-SEARCH-CLIENT-ONLY-AUTH` | HARD-A4-004 | None | Global command palette / `search.global` | Agent 4 | auth/RBAC helpers |
| `RC-P0-SSE-ORG-ONLY-SCOPE` | HARD-A4-005 | HARD-A1-001 candidate duplicate | `/api/sse`, live POS/shell routes | Agent 4 with Agent 1 cross-review | store-access/auth helpers |
| `RC-P0-PERIOD-CLOSE-SCOPE` | HARD-A4-006 | None | `/reports/close` | Agent 4 | store-access helpers |
| `RC-P0-PERIOD-CLOSE-TOTALS` | HARD-A4-007 | None | `/reports/close`, period-close export | Agent 4 | export/report contracts |
| `RC-P0-BUSINESS-DAY-BOUNDS` | HARD-A4-008 | Related report boundary symptoms | `/dashboard`, `/reports` | Agent 4 | time-boundary helpers |
| `RC-P0-GLOBAL-JOB-TENANT-SCOPE` | HARD-A4-009 | None | `/admin/jobs` | Agent 4 | global auth/RBAC and job helpers |
| `RC-P0-TEST-DB-IDENTITY` | HARD-A4-010 | None | Test infrastructure | Agent 4; Agent 1 cross-review | CI workflow and test helpers |
| `RC-P0-ROUTE-RULE-OMISSION` | HARD-A4-011 | HARD-A2-008 overlaps category metadata, not the store-groups route | `/settings/store-groups`, `/settings/categories` | Agent 4 with Agent 2 coordination | `src/lib/roleAccess.ts` |

## Verification limits

- Local API/service/DB/SSE evidence is complete for classification.
- Browser, responsive, theme, and deployed Preview evidence remains `NOT_RUN`; those
  gates are required after a fix batch, not for proving these server/data P0s exist.
- No application behavior was changed during this verification. The only behavior
  change in B0 is the approved destructive-test safety guard and CI test-database
  identity policy.
