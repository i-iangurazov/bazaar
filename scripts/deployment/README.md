# Subscription release recovery rehearsal

The October `prepare-rollback.ts` and `rehearse-rollback.ts` are intentionally
unchanged and remain pinned to their original release. They do not certify the
November subscription changes.

The November strategy restores an **already built, explicitly identified old
application deployment**, while retaining the entire upgraded database and its
migration history. It never runs a down migration, deletes new tables, restores
an old production database backup, changes production aliases or sets provider
environment variables. A plain Git revert which removes applied migration
files is **not** this recovery strategy.

## Preparation, after the release is committed and SQL is frozen

The baseline is the previously published commit
`0ffb69a1692d07f30d7696f6bdae29e370b34827`. The preparer requires ancestry,
unchanged old SQL and eight exact reviewed migration additions: signup
attribution plus the seven subscription migrations through transactional reminders.
Every digest must already be in `approvedProductionMigrations`; the preparer
cannot approve current working SQL on its own.

Run from the repository root, replacing `RELEASE_SHA` with the final committed
release SHA and choosing a new output directory:

```sh
node --import tsx scripts/deployment/prepare-subscription-rollback.ts --release RELEASE_SHA --output artifacts/subscription-recovery-20261107
```

This creates immutable source archives, separate baseline/release trees and a
manifest. It does not alter the index, refs, application working tree or any
database. Preparation is explicitly marked `prepared-not-rehearsed`.

The native rehearsal is a separate, heavier command. Run it only when the root
agent has released the shared machine's testing slot:

```sh
node --import tsx scripts/deployment/rehearse-subscription-rollback.ts --package artifacts/subscription-recovery-20261107
```

Optional `--build` also compiles both production bundles sequentially. Local
compilation has `VERCEL=0`, matching the fact that a real alias restoration uses
an existing deployment and performs no build or build-time migration. It does
not claim that rebuilding an unmodified old Git tree on Vercel would accept a
newer production migration ledger.

## Resource and isolation boundaries

- Native PostgreSQL 16 on `127.0.0.1:55981`, Redis on `127.0.0.1:55982`; no Docker
  Desktop, no reuse of application ports `55971/55972`.
- A new temporary directory with a private owner marker and a new database
  `bazaar_hardening_subscription_rollback_<timestamp>` for every invocation.
  Backup verification restores into a second empty `<name>_restore` database in
  that same disposable cluster.
- Occupied ports abort preparation of the runtime. Existing services are never
  stopped. Before any application SQL, PostgreSQL's actual data directory and
  Redis's actual directory must match the owned runtime.
- PostgreSQL uses 32 MB shared buffers, at most two worker processes and no
  parallel query workers. Redis has a 32 MB memory limit. Application commands
  run one at a time, at low scheduling priority, with a two-worker thread budget
  and a 2 GB Node heap. This controls process concurrency; macOS does not provide
  a hard two-core affinity guarantee through these settings.
- Child environments inherit only basic executable/temporary-directory paths.
  Customer database URLs, Vercel flags, provider keys and developer `.env` files
  are not inherited. Package verification rejects extra files, including an
  injected `.env.local`, before executing package code.
- Payments stay disabled. A separate in-process negative test temporarily uses
  synthetic sandbox readiness, with a fetch tripwire, to prove the old checkout
  fails at the new SQL guard **before** making a provider request.
- Owned command groups, Redis and PostgreSQL are stopped on success, failure or
  interruption. `subscription-cleanup.json` records cleanup. Temporary fixture
  data is retained after shutdown for inspection; no customer data is present.
  Do not remove that directory until its marker and stopped state are checked.

## What the executable rehearsal verifies

1. Use the baseline's own Prisma client and POS services to create a normal
   legacy sale and a sale in a synthetic organization carrying one protected
   lifetime ID. This is an empty disposable fixture, not the real organization.
2. Apply all release SQL. Compare every original column's row hash and count;
   additive columns are allowed, preexisting business values cannot change.
3. Confirm legacy contract version and the actual migration's lifetime backfill;
   changing a protected organization's plan must fail.
4. Use the new quote/settlement services to save a six-month paid subscription
   and a twelve-month pending subscription with their immutable purchase data.
5. Run the baseline service code against the upgraded schema. A paid callback
   replays without changes; trying to settle the twelve-month purchase using
   the old one-month implementation must fail atomically, leaving all tables,
   payment events and balances unchanged.
6. New checkout is disabled. Even with synthetic sandbox readiness, the old
   snapshot-less invoice creation must fail before a provider call. The
   rejected operation must leave no rows behind.
7. Replay the old sale idempotently, then complete new cash sales for both
   legacy and lifetime fixtures with the baseline services after upgrade.
8. Return to new service code: preserve the rollback-period sales and stock,
   then settle the pending invoice for all twelve agreed months.
9. Dump the complete resulting database and restore into another empty owned
   database; verify every table hash and row count.

Only after service checks **and cleanup** succeed is
`subscription-verification.json` written with `status: passed`. The report
records exact base/release SHA and SQL digests. A prepared manifest or passing
unit tests alone is not DB or runtime evidence.

## Boundary before any real production alias restoration

The root operator must independently identify the exact old deployment, verify
its `/api/version` SHA, confirm that **that deployment** has payment collection
disabled, and obtain authorization to change production aliases. This tool does
not inspect or modify deployment secrets or provider settings. If the old
deployment could collect new payments, do not restore its alias until a safe,
reviewed payment stop is in place.

This rehearsal exercises actual versioned application services and PostgreSQL
transactions. It does not switch production traffic or certify browser
hydration, native devices, KKM, AI, email, marketplace or FreedomPay behavior.
Pending subscription payments are intentionally blocked during the old-version
window and must be reconciled by the new application after recovery. Existing
captured money is not silently converted into a shorter subscription.

## Actual CI and production ordering, checked 2026-11-07

A read-only request to Vercel's dedicated project-checks endpoint confirmed the
existing production check named `release-gate`, sourced from GitHub's exact
`release-gate` check name. Its configuration is
`requires: deployment-url`, `blocks: deployment-alias`, `targets: [production]`,
with a 7,200-second timeout. The list contained no native checks. No project
settings, secrets or deployments were changed to obtain this evidence.

This protects **production-domain assignment**, not build start. As documented
by [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks), the
production build can run before the GitHub checks finish, but its custom
production domains wait for the required checks. In this repository,
`package.json` runs `scripts/deployment/migrations.ts` during `prebuild`; that
runner applies only reviewed migrations inside a Vercel production build.
Consequently, the old application can be serving customers against the new
database while CI is still running. The disposable old-application/new-schema
rehearsal above is therefore a release prerequisite, even when the CI alias
gate is configured correctly.

The minimal release procedure preserves the existing check configuration:

1. Freeze and review SQL, record exact approved digests, commit the complete
   release, and finish local application, browser and recovery verification.
2. Recheck the read-only Vercel project-checks result before pushing. Keep the
   GitHub job name unique and equal to `release-gate`; that job explicitly
   fails when any prerequisite was skipped, cancelled or failed.
3. Push the reviewed `main` commit once. Observe the GitHub CI run and Vercel
   deployment for **that same SHA** until they finish. Do not use Force Promote
   or bypass a check. If the check fails, production domains must remain on
   the old deployment; applied additive SQL remains in place.
4. After all checks pass and Vercel assigns the domains, verify the public
   `/api/version` SHA, production smoke results, closed unapproved legal
   routes and unavailable payment collection. Keep the identified old
   deployment and recovery evidence available.

This is CI-before-new-traffic, not CI-before-production-SQL. The project has no
verified existing build-start blocker. Adding one or changing promotion
settings would require a separate review; it is not performed by these tools.
GitHub branch-protection settings were not verified because its read-only API
was unavailable during the audit. Neither that limitation nor a green older
commit is evidence that the current release has passed CI.
