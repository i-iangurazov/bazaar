# iOS billing migration preflight and rollout

Coordinator verification: the owned disposable baseline139-to143 exercise passed
on 2026-11-11. All 43 seeded financial/access/usage/auth/bank-refund/audit rows
were preserved exactly; ten checks passed, and the extra database/temporary
files were removed. The before/after hashes match; the final read-only audit
reports `POST_TEMPORARY_UPGRADES`, zero blockers, zero warnings and no skipped
checks. Detailed aggregate evidence is kept outside Git at
`.local/ios-release-20261111/migration-preservation-evidence.json`. This is
synthetic migration evidence, not permission to inspect or migrate customers.

This playbook covers exactly these four named Apple migrations, in this order.
It prepares a reviewable operational procedure; it does not authorize a
production deployment.

| Purpose | Migration | SHA-256 |
| --- | --- | --- |
| Privacy/source separation | `20261111120000_ios_apple_billing_privacy` | `734e62c89a76aaedb153eb0b8029021f7713074b4526ca5501dac9abd41e2f38` |
| Lifecycle recovery | `20261111130000_apple_lifecycle_recovery` | `4d43cb3a27d30016fde92eb2465ff9f6ec8f148faf8d41495be89063fde2dc10` |
| Native attempt recovery | `20261111140000_apple_native_attempt_recovery` | `1b3d22538c669d7f940e45dc14127842c25fe14accbe753c8a2b7e3efed32d0b` |
| Dependent temporary upgrades | `20261111150000_apple_temporary_upgrades` | `a13faf83ce11ad2c39480fbce1791299b82fd4fa58971bf3548f905c629a714f` |

The merged-main prerequisite is
`20261111020000_manual_subscription_refunds`, SHA-256
`800cd487fb2d4b0ecd5501e5edc7182c4a06b851f68b0b02c18e40d795370b87`.
It remains separate GoPay bank-transfer accounting and is included in the
pre-Apple baseline. Migration names, rather than changing ordinal positions,
define this audit. The current reviewed manifest has 139 baseline migrations
and 143 total migrations.

All four contain explicit transactions. The privacy migration adds the separate Apple
financial journal, immutable organization/token/intent bindings, Apple source
references, account tombstones and consent fields, and private asset erasure
queue. It makes gateway invoice references nullable only alongside exactly one
Apple source. Web WhatsApp lots retain a required expiry; Apple lots have no
expiry. The lifecycle migration adds sticky same-chain superseding and signed future plan
preferences, then updates the affected access and financial guards. The native
attempt migration adds an immutable UUID bound atomically to first sheet
authorization. A terminal native cancellation must match that UUID; a missing
historical UUID cannot be retroactively claimed by another device.
The temporary-upgrade migration adds an immutable same-organization parent for
new C grants, derived dependency revocation, per-purchase token isolation and
signed storefront/price binding. It updates shared access/capacity/feature guards
without reinterpreting old grants. Its dependency triggers preserve a child's
own refund while propagating ancestor revocation/reversal.

The SQL files, including the applied 143rd migration, must remain unchanged
after application. Remedial work belongs in a new reviewed migration. There is
no down migration for this chain.

## Current rollout boundary

The Apple chain is not in `approvedProductionMigrations` in
`scripts/deployment/migrations.ts`. The production prebuild therefore refuses a
deployment when an Apple migration is pending. This playbook does not change that allowlist
or the existing requirement for explicit human authorization before production.
The branch must also be verified against the then-current main branch before
an eventual merge.

Keep `APPLE_BILLING_MODE=off`, `APPLE_BILLING_TERMS_APPROVED=false`,
`APPLE_BILLING_SALES_APPROVED=false` and
`APPLE_BILLING_TEMPORARY_UPGRADES_APPROVED=false`, with no unreviewed catalog or
temporary-upgrade policy enabled. These gates prevent new Apple sales. They do
**not** make the new application compatible with a database
at the pre-Apple baseline: authentication, privacy and existing billing/access paths
already reference the new fields and tables. Apply the complete chain before
serving this application version. This compatibility requirement does not
authorize applying migrations to customer or production databases. Never serve
the final application from an intermediate privacy, lifecycle or native-attempt
schema; it expects temporary-upgrade fields and guards as well.

Commercial choices for all plan/store/reserve combinations, Apple-specific
non-expiring WhatsApp terms, and C's actual price bands, storefront valuations,
discounts and below-minimum/zero policy remain release gates;
see [the server billing scope](APPLE_SERVER_BILLING.md) and
[the catalog proposal](APPLE_CATALOG_PROPOSAL.md). C is a reviewable implementation
with sales off; its proposed BLOCK policy is not approval or complete commercial
parity. See [temporary upgrades](APPLE_TEMPORARY_UPGRADES.md). Passing a database audit does
not approve a product mapping or establish real Apple purchase validation.

## Read-only preflight

The reusable entry point is `scripts/deployment/ios-billing-preflight.ts`, with
its fixed SQL in `scripts/deployment/ios-billing-preflight.sql`. It does not load
`.env`, import Prisma, select a default `DATABASE_URL`, run migrations or contact
a payment provider. Supply a dedicated named connection environment variable
through the operator's existing secret mechanism; do not put credentials in a
command, report or chat. Prefer a role limited to the audited tables and system
metadata, with no DDL/write privileges.

All five target arguments are mandatory. The connection URL must match their
host, port, database and role exactly. External targets require explicit TLS
`sslmode=require`, `verify-ca` or `verify-full` in the URL. The script rejects
connection redirection/startup options and non-public schemas, ignores inherited
libpq defaults, disables startup files and password prompts, and starts one
repeatable-read, read-only transaction with bounded statement/lock timeouts.

An operator supplies the fingerprint independently from the URL. Example
invocation, with non-secret fingerprint variables already set explicitly:

```sh
pnpm exec tsx scripts/deployment/ios-billing-preflight.ts \
  --url-env IOS_BILLING_AUDIT_DATABASE_URL \
  --expect-host "$IOS_AUDIT_EXPECTED_HOST" \
  --expect-port "$IOS_AUDIT_EXPECTED_PORT" \
  --expect-database "$IOS_AUDIT_EXPECTED_DATABASE" \
  --expect-user "$IOS_AUDIT_EXPECTED_USER" \
  --expect-stage PRE_APPLE
```

The optional `--psql /absolute/path/to/psql` pins the operator's approved binary;
otherwise the existing PATH selection applies. After the complete chain, run
the same audit with `--expect-stage POST_TEMPORARY_UPGRADES`.
The tool retains historical stage support:

| Stage | Reviewed boundary | Use with this application version |
| --- | --- | --- |
| `PRE_APPLE` | 139 baseline migrations | Before/after audit baseline; cannot serve final code |
| `POST_PRIVACY` | 140 migrations | Diagnostic intermediate only |
| `POST_LIFECYCLE` | 141 migrations | Diagnostic intermediate only |
| `POST_NATIVE_ATTEMPT` | 142 migrations | Diagnostic intermediate only |
| `POST_TEMPORARY_UPGRADES` | All four Apple migrations; 143 total | Required final schema; other release gates still apply |

An intermediate stage is not an approved application serving state. `PARTIAL`
and `UNBASELINED` are blockers. The script
also refuses altered local migration checksums.

The report contains static check names, counts, severity, skip indicators and
SQLSTATE codes only. It emits no target URL, identifiers, names, addresses,
invoice amounts, signed payloads, keys or raw database error messages. Exit 0
means no blocking check was found; exit 2 means a blocker or audit failure.
Retain the report with the release evidence. Do not interpret skipped checks
as passing: Apple checks are expected to be skipped at `PRE_APPLE`, while a fully
applied `POST_TEMPORARY_UPGRADES` should have none skipped.

The audit checks these assumptions:

- Existing manual, legacy, current and lifetime contract populations; future
  gateway prepayments; and historical invoices without purchase snapshots.
- Gateway KGS money constraints, immutable purchase binding, paid-period dates,
  invoice tenant ownership, credit counters and web expiry.
- Exactly one financial source per grant and per credit lot, Apple-only
  revocation, Apple lot non-expiry, immutable organization/token/intent/chain
  binding, and a separate signed Apple currency/price pair.
- Auto-renewing signed term dates, frozen subscription purchase terms, pack
  quantity binding, duplicate non-auto fulfillment, sticky superseded grants,
  the shape of signed pending changes, and immutable one-use native attempt
  authorization/cancellation binding. Historical authorized intents without a
  UUID remain recoverable through signed receipts and are reported separately.
- Temporary purchase tokens must be unique within the account/purchase token
  namespace and bind the exact original C quote. Each C period must depend on
  its same-organization parent, end with it and preserve the authorized dates,
  cycle and frozen storefront/currency/price. It cannot become standalone
  coverage. Ancestor chains, dependency state and still-unserved blocked-money
  review must agree; an independent GoPay grant or child's own refund remains
  separate. The aggregate checks do not verify actual Apple product registration
  or approve commercial configuration.
- Exact named migration history/checksums; unfinished migrations; new validated
  constraints and valid unique indexes; enabled financial/privacy triggers;
  and all 15 reviewed guard-function bodies across the named Apple chain.

Historical missing snapshots and overdrawn credit counters are warnings for
explicit review, not an instruction to rewrite accounting. Review/unbound Apple
receipts are also warnings: they are retained money obligations and must be
resolved through receipt/reconciliation/refund handling. A warning does not
authorize a charge or an entitlement. Structural source/tenant/guard failures,
malformed values that cannot be safely inspected, history drift and multiple
non-auto grants for one intent block rollout. Resolve their cause in a separate
reviewed change; never disable the guard to make the report green.

This is a point-in-time audit. It cannot prove provider state, absence of future
concurrent writes, capacity under production load, or the completeness of
backups. Repeat it immediately before an authorized rollout under the chosen
maintenance/write-control procedure and again after application.

## Authorized rollout sequence

1. Confirm the disposable preservation evidence below for the exact migration
   chain and record the final application checks, SQL digests and compatible
   recovery build. Verify
   backups and a restore exercise using the hosting operator's established
   procedure. Do not test a restore against a customer database.
2. Keep Apple sales off, both foundation approvals and the separate temporary-
   upgrade approval false, and all unreviewed catalog/policy configuration disabled.
   Confirm the deployed web GoPay merchant configuration separately. Freeze
   deployment and financial writes for the brief audited migration window, or
   document another reviewed procedure that closes the preflight/write race.
3. On the independently verified target, collect the `PRE_APPLE` report. If the
   chain is already applied, require `POST_TEMPORARY_UPGRADES` and matching history instead of
   replaying SQL. Stop on blockers, unfinished history or unexpected skips.
4. Only after production authorization and separate migration review may the
   exact named Apple chain be added to the production allowlist. Apply through the normal
   guarded deployment path in migration order. Do not manually mark a failed
   migration applied, bypass checksum checks, or remove transaction statements.
5. Before traffic reaches the new code, require `POST_TEMPORARY_UPGRADES`, zero blockers and no
   skipped checks. Check auth, existing approved/manual/lifetime access, GoPay
   history and callbacks, future prepayment timing, quota continuity, and web
   lot expiry. Check C token/parent bindings, dependency/refund propagation,
   unchanged future prepayments and legacy quota origins as well. Verify that
   no synthetic journal or invoice was created in the target during deployment.
   These checks use existing state; provider test
   transactions belong only to dedicated test environments.
6. Enable approved Apple mappings only after actual Apple keys, products,
   notifications, sandbox/device recovery and storefront materials have been
   verified, and commercial terms approved. Enable C separately only after its
   actual band prices, valuation/discount/minimum policy and device recovery
   evidence are approved; passing migration checks does not turn that gate on.
   Allowlist only dedicated synthetic review/test organizations for Sandbox,
   including App Review on a live
   deployment. Never add a real customer's organization as a test workaround.
7. Observe durable notification/reconciliation jobs and retained receipt review
   counts, with existing operational monitoring. Audit again if a recovery
   anomaly or an unexpected grant appears. Do not use the audit as a recurring
   customer-data export.

Each migration is a separate transaction. If a later step fails after privacy,
lifecycle or native-attempt recovery completes, the database may be at
`POST_PRIVACY`, `POST_LIFECYCLE` or `POST_NATIVE_ATTEMPT`. Keep the final
application unserved, inspect the failed migration through the established
operator procedure, and recover forward to
the exact reviewed temporary-upgrade stage. An application deployment failure
after commit does not roll back database state.

## Recovery and rollback

**Prefer a forward fix or a previously tested compatibility build with the new
schema. Preserve every financial record and every original organization
binding.** Stop *new* Apple purchase intents when necessary. Once Apple billing
has been used, sales-off does not cancel an existing subscription, stop Apple
renewals, revoke access or remove obligations to process notifications,
unfinished transactions, receipts, refunds and reconciliation. Keep the required
credentials and lifecycle processing available while repairing the application.

Before Apple/account deletion features have been used, an older build may be
compatible with additive columns, but that requires the preservation and
rollback exercise; it is not guaranteed. Once any Apple grant or tombstone
exists, old code assumptions become unsafe:

- A paid period can have `invoiceId=null`, and an Apple WhatsApp lot has
  `expiresAt=null`. Older joins or non-null assumptions can hide access, crash,
  or mix provider accounting.
- Apple periods can be revoked/superseded while independent current or future
  GoPay periods remain. An older latest-period query can resurrect revoked
  access, grant a future period early or reset a quota window.
- C periods additionally require a valid ancestor and an unexpired temporary
  interval. Older code can treat a full target snapshot as unconditional access,
  ignore a per-purchase token, or reset a legacy quota origin. Its compatibility
  must not be inferred from support for ordinary Apple periods alone.
- Deleted users remain irreversible financial-reference tombstones. An older
  auth/reset/invite path that ignores `deletedAt` must not serve them.
- Signed review receipts, pending changes and auto-renewing chains remain
  payable/recoverable even if the purchase UI is disabled.

Do not drop the journal or new columns, fabricate gateway invoices for Apple
money, move an original transaction to another organization, restore deleted
identity, null a token binding, delete a review receipt, or edit an applied
migration/checksum as a rollback. Do not restore an older database backup over
post-backup charges: it would lose receipts and grants. A disaster restore must
use the established recovery plan and replay/reconcile external obligations in
a compatible environment before serving customers.

Saved external GoPay checkout URLs cannot be atomically withdrawn by this
application without a supported provider cancellation mechanism. Server
`payments.resume` rechecks the current organization, admin, frozen quote and
Apple obligations before every in-app redirect; callbacks and reconciliation
must still retain and review any late external charge.

## Coordinator-run disposable preservation exercise

The 139-to143 run described at the start of this document is complete and its
ten checks passed. The following procedure remains the repeatable template;
changed migration inputs, guards or preservation logic require fresh evidence.
That result proves the schema transition and original-row preservation. A
compatible recovery build, backup/restore rehearsal and actual Apple/device
acceptance need separate evidence. No customer/production migration or
production audit is authorized or claimed by that result.

Provisioning/running this exercise is reserved for the coordinating agent or an
authorized operator. It requires an **additional explicitly owned disposable
database**. Do not point reset, seed, migration or fixture tooling at the audit
target by default. The existing test safety allowlist/fingerprint applies; do
not broaden it to include customer databases.

1. Create the separately owned local test database and least-privilege test
   role. Record its host/port/name/role and label it disposable. Use a temporary
   migration directory containing the repository's unchanged migrations preceding
   the first named Apple migration, preserving their checksums. This current
   baseline has 139 migrations and includes the manual bank refund prerequisite. Do not remove migrations from the working
   tree or production history to simulate an older schema.
2. Apply only that baseline. Seed synthetic data using that baseline schema (raw
   parameterized SQL or a separately generated baseline client). The current Prisma
   client already expects temporary-upgrade fields and must not be used to claim baseline
   compatibility. Include manual/free approval, legacy terms, current terms,
   lifetime, active and expired periods, future GoPay prepayments, unpaid/review/
   paid invoices, used/reserved/expired web WhatsApp lots, quotas, and financial
   user references. No real provider calls or copied customer records.
3. Capture canonical, ordered snapshots/hashes of the original financial rows,
   periods, contract snapshots, entitlement timing, user references, credit
   counters/expiries and quota operation identities. Keep only synthetic output.
   Require `PRE_APPLE` with the expected populations and reviewed warnings.
4. Apply the exact four named Apple migrations. Require `POST_TEMPORARY_UPGRADES`, matching digests/history,
   valid guards, zero blockers and no skipped checks. Compare all original
   rows with the before snapshot: no invoice amount/currency/source, grant
   interval, contract, approval, expiry, counter or quota identity may change.
5. Run the owned-DB Apple/lifecycle/GoPay/privacy regression suites. Exercise
   duplicate/out-of-order receipts, revoked base plus future GoPay coverage,
   same-chain replacement, manual/lifetime access, non-expiring Apple lots,
   unchanged web expiry, preserved manual bank refund records, tombstone auth,
   wrong-device/legacy/lost-response native attempt recovery and stale unpaid
   checkout recovery. Include current-term C upgrades from GoPay/non-renewing
   Apple, unchanged future prepay, ancestor/own-refund independence, per-intent
   token replay, expired C fallback and snapshot-free legacy quota continuity.
   Attempt forbidden tenant/money/source rewrites and require
   real database rejections.
6. Run the proposed compatibility recovery build against this synthetic final
   database both before and after Apple grants/tombstones exist. Verify auth,
   approved access, current/future periods, quotas, history and lifecycle work.
   A failed old-build scenario disqualifies that build as a rollback target;
   keep a compatible build or fix forward. Do not weaken guards.
7. Record results and remaining gates. Remove only the separately owned
   disposable resources when the coordinating operator is finished. No part of
   this procedure substitutes for the specific coordinator evidence or claims
   that a production audit has passed.

Regression tests for the coordinating runner are
`tests/unit/ios-billing-migration-preflight.test.ts` (target isolation, redaction,
CLI/process policy and report validation) and
`tests/integration/ios-billing-migration-preflight.test.ts` (real read-only audit,
unchanged synthetic accounting, historical warnings and duplicate fulfillment
detection). The integration runner uses the explicitly guarded
`DATABASE_TEST_URL`; set `IOS_MIGRATION_PREFLIGHT_PSQL` when a non-PATH binary is
needed. `tests/integration/apple-temporary-upgrades.test.ts` also runs the real
read-only preflight against a legitimate per-intent C purchase and checks
aggregate-only output and unchanged token/parent/financial rows. These checks
do not replace the separate baseline-to-temporary-upgrade preservation run,
actual Apple Sandbox/device evidence, or production authorization.
