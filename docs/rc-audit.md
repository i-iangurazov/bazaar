# RC Audit (Release Candidate)

Date: 2026-02-11
Branch: `main`

## Scope
Large pre-release delta was audited across security, tenancy, inventory invariants, orders, imports, exports/PDF, realtime/jobs, and UI consistency.

## Snapshot
- `git status --short` shows a broad multi-domain change set (auth, billing/plans, sales orders, diagnostics, guidance, imports, UI system).
- `git diff --stat` (current): `88 files changed, 3396 insertions(+), 777 deletions(-)` plus untracked migrations/pages/docs.

## Gate Results
- `pnpm lint`: PASS
- `pnpm typecheck`: PASS
- `pnpm i18n:check`: PASS
- `CI=1 DATABASE_TEST_URL=... pnpm test:ci`: PASS (`34` test files, `93` tests)
- `pnpm build`: PASS

## High-Risk Checklist Findings

### A) Security / Auth
Status: PASS with minor hardening fixes.
- Credentials auth/session flow and role procedures are present.
- Public auth paths remain rate-limited.
- No secret values were added to API payloads/responses.

### B) Tenant isolation
Status: PASS.
- New routes/services use `organizationId` from authenticated context and scope DB queries accordingly.
- Sales order operations are org-scoped in both router and service queries.

### C) Inventory invariants
Status: PASS.
- Stock movement writes continue via service paths with immutable ledger semantics.
- Sales completion uses idempotent completion key and movement application logic.

### D) Orders / Sales / Purchase Orders
Status: PASS after runtime checks.
- Sales order state transitions are server-validated.
- Quantity validation enforced server-side (`int().positive()`).
- Idempotent completion path retained.

### E) Imports / Rollbacks
Status: PASS with security hardening.
- Import rollback logic remains compensating/non-destructive.
- Product image ingestion had a network safety gap; fixed (see P1-1).

### F) Exports / PDFs
Status: PASS.
- Export tests and PDF tests pass in CI gate.
- Build and integration checks green.

### G) Realtime / Jobs / Redis
Status: PASS with reliability hardening.
- Redis pub/sub degradation path exists.
- Found and fixed subscriber-mode reliability issues causing noisy errors/fallback (see P1-2).

### H) UI/UX consistency + responsive
Status: PASS with targeted bug fix.
- Theme preference persistence had invalid payload edge case (`""`) from UI interactions; fixed (see P1-3).

## Issues Found and Patched

### P1-1: Import image URL fetch lacked private-network SSRF blocking
- Risk: Importing arbitrary image URLs could attempt local/private address fetches.
- Fix:
  - Added host/IP safety checks before remote fetch.
  - Blocks localhost, `.local`/`.internal`, loopback/link-local/private IPv4/IPv6 ranges.
  - Added DNS resolution check and host allow-cache.
- Files:
  - `src/server/services/productImageStorage.ts`
- Verification:
  - All gates pass, import tests remain green.

### P1-2: Redis subscriber degraded to in-memory due subscriber-mode command errors
- Risk: Realtime bus unstable; noisy logs and degraded cross-instance events.
- Fix:
  - Subscriber client now uses lazy connect + no ready-check path for subscriber role.
  - Event bus now binds Redis listeners once and explicitly connects subscriber before `SUBSCRIBE`.
  - Diagnostics Redis check now uses an isolated duplicate subscriber client (no shared global subscriber side effects).
- Files:
  - `src/server/redis.ts`
  - `src/server/events/eventBus.ts`
  - `src/server/services/diagnostics.ts`
- Verification:
  - `test:ci` + `build` pass after patch.

### P1-3: Theme preference mutation could receive empty string and fail with 400
- Risk: preference save non-deterministic in profile UX.
- Fix:
  - tRPC input preprocess coerces `""` -> `undefined` for theme preference.
  - Profile selects now pass safe fallback values (`ru`, `LIGHT`) to avoid empty state.
- Files:
  - `src/server/trpc/routers/userSettings.ts`
  - `src/app/(app)/settings/profile/page.tsx`
- Verification:
  - `typecheck/test:ci/build` pass; preference flow no longer rejects empty payload.

## Residual Risks (P2 backlog)
- Very large diff across many domains still raises review complexity risk; maintain strict commit grouping and rollback plan.
- Manual role-by-role UX sweep should be completed before production switch (see smoke checklist).

## Commit Plan (safe, reviewable)
1. `fix(security): block private-network SSRF paths in product image import`
2. `fix(realtime): harden redis subscriber lifecycle for event bus`
3. `fix(diagnostics): isolate redis pubsub probe client`
4. `fix(profile): guard empty theme payload and stable defaults`
5. `docs(release): add rc audit and smoke checklists`

