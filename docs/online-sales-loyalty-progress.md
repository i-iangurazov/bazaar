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
  - `sale-channel` after the downgrade fix — 4/4 pass.
- Safe local build: `CRON_SECRET=… pnpm exec next build` — pass
  (`/reports/analytics` 9.45 kB / 274 kB). Note: plain `pnpm build` fails locally
  only because `env:check:build` requires `CRON_SECRET`, which is not set in the
  local `.env`; the production migration step is a no-op locally.
- Browser check (headless Chromium, local dev server, seeded demo data):
  `?report=online` renders the tab, both blocks, daily chart, orders table and
  "Нет данных о платеже"; 0 console/page errors. Screenshot:
  `tmp/online-sales-report.png` (tmp is gitignored).
- Chart fix: the online chart no longer shows empty `costKgs`/`grossProfitKgs`
  legend entries (opt-out prop, sales page unchanged).
- URL fix: default `report`/`source`/`onlineChannel` values are omitted from the
  report URL, so existing analytics links are byte-identical
  (`tests/unit/baam-report-link.test.tsx` caught the regression).

### saleChannel downgrade fix (done)

- Reproduced: an order recorded with `saleChannel=ONLINE` was rewritten to
  `IN_STORE` when the register completed/held it with its own in-store default
  (`completePosSale`/`holdPosSaleDraft` wrote `input.saleChannel` verbatim).
- Fixed in `src/server/services/pos.ts` with `resolveSaleChannelUpdate`: an
  existing `ONLINE` sale is never downgraded; a missing value preserves the saved
  channel; upgrades remain allowed. No POS UI file changed.
- Regression test added to `tests/integration/sale-channel.test.ts`.

### Stage 2 — Programme rules (done)

- Rules fixed in code and in the schema, programme disabled by default
  (`LoyaltyProgram.enabled = false`; existing organizations are never auto-enrolled):
  member discount 5% (configurable), earn 5% (configurable, owner confirms),
  1 point = 1 KGS, max spend 50% of the eligible amount after the member discount,
  within the available balance.
- Points are whole and rounded down; money uses `Prisma.Decimal`, never JS float.
  `maxRedeemPoints = min(availablePoints, floor(eligibleAfterDiscount * 50%))`.
- Delivery/services are excluded; promo lines are excluded by default; the member
  discount keeps the larger of member vs promo, never the sum. Manual cashier
  discount combined with the programme is out of scope for v1.
- `loyaltyRulesText()` states the 52.5% total-benefit example in plain language and
  avoids calling it a "50% total discount".
- Owner settings API: `loyalty.settings`, `loyalty.updateSettings`, `loyalty.rules`
  (ADMIN) in `src/server/trpc/routers/loyalty.ts`. No settings page UI yet.

### Stage 3 — Accounts, calculation and journal (done, core)

- Schema + additive migration `20260930120000_loyalty_foundation`:
  `LoyaltyProgram`, `LoyaltyProgramStore`, `LoyaltyMember`, `LoyaltyAccount`,
  `LoyaltyLedgerEntry` (append-only, unique `eventKey`), `LoyaltyReservation`,
  `LoyaltyOrderApplication` (per-order rules/amount/line snapshot).
- One server calculation for POS and web: `src/server/services/loyalty/calc.ts`.
- Journal + atomic balance + idempotency + reservations:
  `src/server/services/loyalty/ledger.ts`.
  - Balance moves only together with a ledger row; debits use a conditional update
    (`balancePoints >= needed`), so two parallel redemptions cannot spend the same
    points.
  - `eventKey` makes earn/spend idempotent (a replay returns the original row).
  - Reservations do not touch the balance; availability = balance − live
    reservations; expired reservations never reduce availability; confirmation
    converts a reservation into exactly one REDEEM; reversal entries may push the
    accounting balance negative while spendable stays ≥ 0.
- Tests: `tests/unit/loyalty-calc.test.ts` (6, incl. the exact 1000 KGS examples:
  pay 950 / earn 47; spend 475 / pay 475 / earn 23; balance 100 → pay 850 / earn 42)
  and `tests/integration/loyalty-ledger.test.ts` (5: disabled by default, idempotent
  earn, parallel-redemption guard, reservation expiry, single conversion).

### Stage 4 — Registration and QR card (done, server + pages)

- Separate customer identity, never a staff role: email one-time code (hashed,
  10-minute TTL, attempt + rate limits, delivery skipped in test runtime), a
  dedicated `loyalty_session` httpOnly cookie (30 days, revocable), and no User row.
- Two QR types: the store QR is the public join link `/loyalty/join/<programStoreId>`
  (opening it earns/spends nothing); the customer QR is a short-lived (120 s) opaque
  token, server-verified, single-use and organization-bound.
- Pages: `/loyalty/join/[programStoreId]` (registration/sign-in) and `/loyalty/card`
  (balance, available, discount rules, history, QR). API under `/api/loyalty/*`.
- Admin settings page `/settings/loyalty`: stores, member discount, earn rate,
  spend limit, min redeem, reservation TTL, promo options and an explicit
  enable switch (`updateSettings` alone was not enough).
- Tests: `tests/integration/loyalty-member-auth.test.ts` (5).

### Stage 5 — Register and online-order integration (server done; UI NOT started)

- One shared quote (`quoteLoyaltyForOrder`) and order application
  (`applyLoyaltyToOrder`) that snapshot the rules, amounts and line distribution.
- `confirmLoyaltyForOrder` converts a reservation into exactly one redemption and
  grants the earning only when the money part is fully paid.
- Reservation concurrency: availability is guarded by an atomic conditional update
  on `LoyaltyAccount.reservedPoints`; two parallel orders on one account cannot
  spend the same points, and a partially available request fails loudly instead of
  silently re-pricing (verified in `tests/integration/loyalty-orders.test.ts`).
- NOT DONE: the register UI action/dialog and the online catalogue checkout hook.
  The register UI is intentionally untouched so the working POS is preserved.

### Stage 6 — Returns and loyalty reporting (reversals done; reporting partially)

- `reverseLoyaltyForReturn` reverses spend and earnings cumulatively and
  proportionally, so successive partial returns can never over-reverse; a full
  return lands exactly on the original amounts. Reversal earnings may push the
  accounting balance negative while spendable stays ≥ 0.
- NOT DONE: wiring reversals into the POS `completeSaleReturn` transaction, showing
  loyalty lines (member discount, points spent/earned/reversed) in analytics and the
  customer/order cards.

### Stage 7 — Local acceptance (NOT STARTED)

- POS baseline captured before any register work:
  `tmp/pos-desktop-before.png`, `tmp/pos-tablet-before.png`,
  `tmp/pos-mobile-before.png` (closed-shift state; a filled-cart/customer/payment
  baseline still needs capturing).

## Exact continuation point

1. Register UI: add ONE compact "Бонусы" action inside the existing customer
   dialog/menu in `src/app/(app)/pos/sell/page.tsx` (no layout/geometry change),
   opening a separate dialog that calls `loyalty.*` procedures; then wire
   `applyLoyaltyToOrder`/`confirmLoyaltyForOrder` into `completePosSale`.
2. Online checkout: bind the customer card to the catalogue order and reuse
   `quoteLoyaltyForOrder`.
3. Call `reverseLoyaltyForReturn` from the POS return completion transaction.
4. Show loyalty lines in analytics/order/customer views.
5. Run the full customer + cashier walkthrough and compare POS screenshots with the
   baseline above.

## Blockers

- None technical. Remaining work is scope, not access.
