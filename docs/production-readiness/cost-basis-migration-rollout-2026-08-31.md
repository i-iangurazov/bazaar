# Bazaar precise cost-basis migration rollout

Status: **BLOCKED — do not run the current three migrations in production.**

The qualification evidence is recorded in
`docs/production-readiness/evidence/release-mixed-version-migration-2026-08-31.json`.
The old application passed 129/129 representative checks on its 96-migration schema, then
failed 24/28 inventory checks after the three release migrations. The release migrations are
therefore not old-writer compatible and do not provide the required application rollback.

## Required corrected release shape

The current migrations must be replaced, before production use, by distinct expand, data, and
enforcement stages. This is a rollout requirement, not permission to alter production data.

1. Confirm a current production backup and point-in-time recovery, record the recovery timestamp,
   database identifier, backup identifier, restore owner, and a tested restore target.
2. Apply an **expand-only** migration with a short `lock_timeout`. It may add nullable/defaulted
   value columns and backfill bookkeeping only. It must not rewrite `ProductCost.costBasisQty`,
   scan/update all stock movements, validate large constraints, or install the positive-stock
   enforcement check while the old application can write.
3. Keep the old application online and rerun representative product, inventory, POS, order, and
   report reads/writes. The expected result is a clean pass on the expanded schema.
4. Deploy and qualify an intermediate compatibility application that preserves the legacy fields
   while writing the new precise basis separately. Do not mix the old snapshot-first lock order
   with the new ProductCost-first lock order for the same scope.
5. Drain every inventory and product-cost writer. Reads and unrelated workflows may remain online
   only if the maintenance boundary can enforce that separation. Confirm zero in-flight stock
   transactions before data conversion.
6. Run a preflight at organization, product, variant, and **store** scope. Stop on negative stock,
   store/product organization mismatch, positive stock without a positive reviewed cost, or an
   ambiguous historical sale/return/transfer value. Offsetting positive and negative stores must
   not hide an unsafe scope.
7. Run the semantic backfill in keyset batches of at most 500 scopes per transaction. Each batch
   must have bounded lock and statement timeouts, an idempotent completion marker, before/after
   counts, elapsed time, affected rows, last cursor, and a durable error ledger. A rerun must skip
   completed scopes and repeat the interrupted batch without changing already-completed values.
8. Never use `StockMovement.lineTotalKgs` as COGS for a sale without proving its immutable cost
   meaning. Pair transfer legs explicitly. Leave ambiguous history for reviewed reconciliation;
   do not manufacture a value.
9. Run a zero-delta reconciliation under the writer drain. Require physical quantity, precise
   basis quantity/value, movement value, UI, CSV/XLSX, COGS, margin, and inventory valuation to
   agree for the acceptance fixtures.
10. Atomically switch to the precise-basis application, run the targeted cost/inventory/POS/order/
    report smoke, then reopen inventory writers.
11. Only after the new application is stable may a separate enforcement migration install the
    fail-closed positive-value and deliberate-zero-cost-reason constraints. Validate constraints
    separately after measuring lock behavior.

## Rollback

Before the enforcement stage, an application rollback is allowed only under a complete inventory-
writer drain. Roll back the application, keep the expanded columns, verify old read-only and
unrelated workflows, and do not reopen stock writers. To return to the new application, rerun the
bounded reconciliation/backfill from its recorded cursor, require zero delta, switch applications,
and then reopen writers.

After enforcement or after any new precise-basis write, do **not** roll the application back to
`7db455397eb38e9bcaa09bda5acc951964df5ab2` for stock mutations. The safe recovery is roll-forward
to the qualified new build. A database restore is permitted only when the recorded PITR point is
acceptable and all post-backup writes are intentionally discarded under the incident procedure.

The current release cannot truthfully claim no mandatory writer drain, old-writer compatibility,
or application-only rollback. Those are release blockers, not operational caveats.
