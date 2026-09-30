# Online sales + loyalty progress

Owner request (2026-09-30): add an "Online sales" analytics report and a
UDS-style loyalty programme. Work locally in `main`, never push/deploy, keep the
current POS UI unchanged.

## Environment check

- Repo: `/Users/ilias_iangurazov/Commercial/bazaar`, branch `main`.
- HEAD at start: `71154371196c1429c6e7099a8872dc63518e12f6` (matches the task's
  reference commit).
- No project-level `AGENTS.md` found.
- Available tooling: shell, editor, pnpm, prisma, vitest, docker (only for an
  isolated local test DB). No Vercel/Neon MCP or deploy tooling is used.
- Local Postgres/Redis were not running at session start; they are started only
  for isolated local verification.

## Stage log

### Stage 1 — Online sales report (done, pending owner review)

- Status: implemented locally; awaiting owner review.
- Facts established:
  - `CustomerOrder.saleChannel` (`IN_STORE`/`ONLINE`, nullable) is the commercial
    channel. `source` (`MANUAL`/`CATALOG`/`API`) and `isPosSale` are separate.
  - Catalog checkout creates `CONFIRMED` + `saleChannel=ONLINE` +
    `source=CATALOG` with no `SalePayment` rows
    (`src/server/services/bazaarCatalog.ts`).
  - `SalePayment.shiftId` is required, so online orders generally have no
    payment rows — payment evidence must be treated as "unknown", never "unpaid".
  - `completePosSale` currently writes `saleChannel: input.saleChannel`, which
    can relabel an ONLINE order as IN_STORE when completed at a register.
    Flagged for Stage 5; not changed yet.
- What changed:
  - New server report `src/server/services/reporting/onlineSales.ts`
    (`getOnlineSalesReport`): two separate result blocks — orders created in the
    period (`createdAt`) and completed sales/returns (`completedAt`), a daily
    series, and a paginated orders table. Uses `reportPeriod` for Bishkek
    `[start; next-day-start)` boundaries and existing indexes.
  - Router procedures `reports.onlineSales` and `reports.onlineSalesExport`
    (`src/server/trpc/routers/reports.ts`), both behind `withReportRead`
    (server-side org/store scoping and the analytics feature gate).
  - URL state extended with `report`, `onlineChannel`, `source`
    (`src/lib/reporting.ts`).
  - Analytics tab "Продажи / Онлайн-продажи" plus the report UI
    (`src/components/reports/online-sales-report.tsx`,
    `src/app/(app)/reports/analytics/page.tsx`).
  - i18n keys (`onlineSales` namespace + `reporting.tabs`) in ru/kg/en.
  - Tests: `tests/integration/online-sales-report.test.ts`,
    `tests/unit/report-url-state.test.ts`.
- Deliberate interpretations:
  - `saleChannel=ONLINE` is the definition of an online sale; `isPosSale=false`
    is not used as the criterion. Unknown channel is a separate filter and a
    note, never merged into ONLINE.
  - Money received is `SalePayment`-based and only shown when payment rows
    exist; otherwise the UI states "Нет данных о платеже".
  - Returns decrease the period in which the return completed.
- Not done in Stage 1 (per task): no historical reclassification of old
  unknown-channel orders (needs a dry-run + count report; not implemented yet).
- Next step: Stage 2 (loyalty data model + settings, disabled by default).

## Verification

- `pnpm exec tsc --noEmit` — pass.
- `pnpm lint` — pass.
- `node --import tsx scripts/i18n-check.ts` — pass.
- `pnpm exec vitest run tests/unit/report-url-state.test.ts` — 8/8 pass.
- Integration (isolated local DB `bazaar_hardening_agent4_platform`):
  - `tests/integration/online-sales-report.test.ts` — pass.
  - Regression set `reporting-sales`, `reporting-operations`,
    `reporting-access-cost`, `reports`, `customer-purchase-report`,
    `sale-channel`, `analytics` — 24/24 pass.
- Not yet verified: full `next build` and visual check of the analytics page in a
  browser (the new report tab was not opened in a running app).

## Blockers

- None. Registration channel for loyalty (Stage 4) depends on an existing
  SMS/email provider; to be confirmed when that stage starts.
