# Bazaar continuation on main

**Follow-up correction:** this document records the earlier continuation. BAAM has since moved to a [question assistant](baam-assistant.md). The initial release check verified Vercel URLs but missed the staged custom-domain alias; [the release correction](custom-domain-release.md) explains the `bazaar.kg` 404 and the required canonical-domain verification.

This continues the original 5 September assessment and stabilization commit `190edad`. The audit's **14/100 score and 23% coverage remain historical**, not a current readiness score. Its report and Stripe/ORDO designs remain unchanged under `artifacts/bazaar-assessment/20260905T114424Z/`. **BAAM is the current product name.**

Current local evidence is under `artifacts/bazaar-continuation/20260905/`. These ignored artifacts include browser journeys and machine-readable before/after results. Captured email links and synthetic credentials remain private. Tracked tests and these documents describe reproducible contracts without embedding credentials.

Final local validation passed **96 focused unit tests and 80 disposable database tests**, plus 12 selected legacy auth contract checks. TypeScript, changed-file ESLint, translation validation and diff checks passed. Browser evidence is reported separately below; overlapping scenarios are not added into a global readiness score.

CI includes a dedicated stabilization job with separate ephemeral PostgreSQL/Redis services, explicit image pulls, and cleanup even on failure. The release gate requires that job alongside the existing checks. The regular test job continues using its own separate database.

## Authentication

The real browser journey passed **19 checks**: cold-page safety, signup, invalid business input/retry, persistence, mandatory verification and resend, reused-link error, owner login, reset delivery/completion, old-cookie rejection, fresh login, all four roles, open-session role/store revocation, disable/reactivate, invitation acceptance/verification/login, and logout.

Server tests cover concurrent and wrong-identity token consumption, sibling reset links, registration rollback, invitation concurrency, audit redaction and session-update bypasses. See [the authentication contract](auth-lifecycle.md). Local email capture exercises actual application request payloads; it does not establish provider delivery.

The browser uncovered native GET submission before hydration, which could expose login fields in the URL, and lost input during cold loading. Password forms use POST fallbacks and wait for their handlers; login/reset inputs also wait before becoming editable. Verification resend is available from login. Expired/reused verification links no longer claim success.

Login return destinations are validated both before and after locale removal, preventing protocol-relative or backslash URLs from leaving Bazaar.

## Management and recovery

Four product management defects are corrected: the All stores filter, a pointer lock after canceled bulk actions, incomplete cross-page archive/restore, and overflowing category labels. The primary browser suites resolved 32 assertions (27 management assertions and five logins), with explicit supplementary read-only checks documented in `management-summary.json`. Actual archive affected all 30 selected products; a simulated five-request failure left five selected for retry, and retry restored those five only. Category updates persisted for all 30.

Product create/edit use a labeled input adapter that omits stock/cost/store-assignment fields. Restricted duplication uses the normal endpoint with excluded copy options disabled and produced one persisted copy from two requests sharing the same key. These results do not establish the full stock-coupled product lifecycle.

[Shared job recovery](job-recovery.md) documents durable retry claims, shared locks, truthful completion status and manual reconciliation. Sixteen real database/Redis tests use synthetic handlers. The jobs UI separately passed eight unit and five browser scenarios using mocked job actions; no real provider job was triggered. Shared modal descriptions now retain Radix's accessible description association without console warnings.

## Reporting and BAAM

Current report corrections cover impossible calendar dates, consistent refund-actor filtering, tenant-safe payment relations, and products/categories returned in the period without a sale in that period. Filtered page exports use the table's recorded values and formatter.

[BAAM metric definitions](baam-metrics.md) describe the certified calculation contract and its limits. The read-only `/baam` page provides a deterministic sales/returns brief, payment reconciliation, store/period controls and daily figures. Current roles, analytics entitlements and store grants authorize each retrieval. Its database transaction is read-only; no AI provider or operational mutation is involved.

Query time is not an ingestion watermark. Source completeness remains unknown. Profit, tax, stock, forecasting, all-channel revenue and arbitrary conversational analysis are outside this MVP. Browser verification covers the real empty endpoint, filters and permissions; nonzero display fixtures are explicitly mocked.

## Stripe

[Inactive Stripe preparation](stripe-inactive-preparation.md) implements and tests an immutable legacy entitlement snapshot contract. It cannot create payment objects or require a card, and is not wired into the current billing resolver.

The proposed UK seller is unconfirmed. There is no approved account, authorized sandbox, price catalog or grandfathering cutoff. Existing application billing behavior is unchanged. Durable cohort storage, Checkout/Portal, signed webhooks, reconciliation, sandbox lifecycle tests and activation remain outstanding. The historical Stripe design supplies detailed acceptance criteria.

## Release sequence

The owner authorized migrations, pushes to `main`, CI checks and Vercel deployment. Production credentials are not downloaded. Production prebuild checks migrations inside Vercel using its existing configuration:

1. Require every reviewed migration file and its pinned SQL checksum. Verify applied migration names/checksums match this checkout and no unfinished migration exists.
2. Permit only the reviewed pending additions: `20260905140000_user_session_version` and `20260905150000_dead_letter_retry_claim`. Older unexpected pending migrations stop the build.
3. Apply those additions before building. Repeated builds with an up-to-date schema are a no-op.
4. Check CI and the exact Vercel deployment, promote that tested deployment when staged, verify the canonical `www.bazaar.kg` alias points to its ID, then perform in-scope browser smoke checks on the actual customer domain. See [the custom-domain release procedure](custom-domain-release.md).

`vercel.json` explicitly selects `pnpm build`, including its guarded prebuild. Migration-history checks do not certify arbitrary physical schema drift. Git-triggered Vercel builds can run concurrently with CI; both exact-commit outcomes must be checked. Artifacts are excluded from CLI deployments as well as Git.

The first guarded deployment identified five pre-existing ledger differences. [Exact historical acknowledgements](deployment-migration-history.md) document their Git provenance and pinned digests. They do not authorize any additional migration or change the excluded scope.

The auth migration requires existing users to log in again. Unverified accounts must verify their email when required; login provides resend recovery. No verification backfill is included. The job migration adds nullable retry-claim metadata and preserves existing jobs.

Both reviewed migrations applied successfully in Vercel on 5 September at 14:05 UTC. Exact deployment, CI and production smoke outcomes are recorded in `artifacts/bazaar-continuation/20260905/release.json` and the interactive continuation report.

The baseline CI reported two failures in old reporting expectations. Replacement monetary fixtures use an explicit reporting projection. A subsequent run passed 1,441 tests and exposed one old signup expectation permitting account takeover; that expectation now verifies the secure resume contract. Mixed legacy suites invoking excluded operations are not manually executed here. Final CI/deployment outcomes must be read from actual runs, not inferred from local checks.

## Scope

**POS and Inventory: EXCLUDED_BY_OWNER, NOT ASSESSED.** Dedicated implementations, operations and tests remain outside manual verification. Stock-coupled product workflows use labeled metadata adapters where needed and remain unverified end to end. Provider handlers use synthetic adapters for local checks. No live campaign, marketplace write or payment activation belongs to this pass.
