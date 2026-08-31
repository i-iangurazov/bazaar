# Bazaar precise inventory-value rollout

Status: **release candidate; production execution remains blocked until local/CI/Preview gates and production PITR confirmation pass.**

This release uses expand → deploy → drain → bounded backfill → reconcile. It does not deploy a
contract migration and does not drop, rename, reinterpret, or make legacy columns mandatory.

## Release artifacts

- `20260831120000_product_cost_precise_basis_value`: nullable precise ProductCost columns only.
- `20260831121000_stock_movement_inventory_value`: nullable movement-value columns, a UTC
  database watermark default for new rows, and a `NOT VALID` compatibility sign check that permits
  `inventoryValueDeltaKgs IS NULL` while old writers exist.
- `20260831121500_stock_movement_valuation_cursor_index`: one standalone
  `CREATE INDEX CONCURRENTLY`; it is separate because PostgreSQL forbids that command inside the
  transaction used by ordinary migration DDL.
- `20260831122000_allow_zero_cost_stock_movement`: new checkpoint and issue tables for the
  operational backfill. It performs no historical data update.
- `scripts/inventory-valuation-backfill.ts`: bounded operational backfill. It is not schema DDL.
- `future-inventory-valuation-contract-2026-08-31.sql`: review-only future contract template. It
  is deliberately outside `prisma/migrations` and must not be deployed in this release.

## Preconditions and recorded evidence

Before touching production, record all of the following in the release ticket:

1. exact release and rollback commits;
2. database identity and PostgreSQL version;
3. verified PITR/backup identifier, recovery timestamp, retention window, restore owner, and the
   latest successful restore-test reference;
4. current migration status and row counts for `ProductCost`, `StockMovement`, and
   `InventorySnapshot`;
5. current application instance count and a named operator able to drain inventory writers;
6. an approved maintenance boundary for the bounded write-mode backfill.

If any item is unavailable, stop before production migration. Never place a credential or database
URL in evidence.

## Stage 1 — expand while the old application remains live

1. Preserve the pre-expand PITR point and exact old application commit.
2. Apply the four release migrations using the repository's normal migration deploy command.
3. Confirm all four rows are successful in `_prisma_migrations`.
4. Confirm the cursor index is ready and valid:

   ```sql
   SELECT indexrelid::regclass, indisready, indisvalid
   FROM pg_index
   WHERE indexrelid = '"StockMovement_valuation_backfill_cursor_idx"'::regclass;
   ```

5. If the concurrent index step is interrupted and leaves an invalid index, stop application
   rollout. After confirming no index build is active, drop only that named invalid index with
   `DROP INDEX CONCURRENTLY IF EXISTS "StockMovement_valuation_backfill_cursor_idx"`, repair the
   failed migration record through the normal Prisma recovery procedure, and rerun the standalone
   index migration. Never continue with `indisvalid = false`.
6. With the old application still running, execute the retained 129-case compatibility suite and
   representative receiving, adjustment, write-off, transfer, sale, return, order, and report
   operations. Any old-writer constraint rejection blocks the rollout.

The expand DDL has a 5-second lock timeout and 30-second statement timeout. Existing movement rows
remain NULL because the column is first added without a default; the UTC default is installed only
for later inserts. There is no table-wide historical update.

## Stage 2 — rolling application deployment

1. Deploy the qualified new application while the expanded schema remains in place.
2. During the rolling window, the new application dual-writes legacy compatibility fields and the
   precise basis/value fields. Old instances continue writing only fields they know.
3. New readers must tolerate old-created NULL movement values and label them unreconciled; they must
   not coerce them to zero.
4. Run alternating old/new acceptance writes and reconcile physical quantity, legacy projection,
   precise quantity/value, frozen COGS, reports, and exports.
5. Drain all old application instances and confirm the exact new release commit is the only running
   inventory writer. Record the instance/drain evidence; a verbal assertion is insufficient.

Application rollback remains available while this release's nullable expanded schema is retained.
Do not roll back the schema. If the old application writes after rollback, the precise projection
is intentionally stale; on redeploy, the new application reconciles later UTC-watermarked rows from
durable receipt/document evidence and fails closed when evidence is insufficient.

## Stage 3 — bounded operational backfill

Run one organization at a time where practical. Write mode is forbidden until old writers are
drained. Begin with a dry run:

```sh
pnpm ops:inventory-valuation-backfill -- \
  --dry-run \
  --run-id=<release-and-organization-id> \
  --organization-id=<organization-id> \
  --batch-size=100 \
  --max-batches=1
```

Review the JSON result and every proposed `REVIEW_REQUIRED` row. The dry run uses a repeatable-read,
read-only transaction and creates no run record. It never guesses an unsupported value.

For write mode, set `ALLOW_INVENTORY_VALUATION_BACKFILL_WRITE=1` only in the approved maintenance
session, then run:

```sh
pnpm ops:inventory-valuation-backfill -- \
  --write \
  --run-id=<stable-release-and-organization-id> \
  --organization-id=<organization-id> \
  --batch-size=100 \
  --max-batches=1 \
  --confirm-write=BACKFILL_INVENTORY_VALUATION \
  --confirm-writers-drained \
  --writer-drain-evidence=<approved-ticket-or-instance-drain-reference>
```

Repeat the same run ID to resume from its durable composite cursor. Transactions are bounded, batch
size is capped at 500, lock/statement timeouts are local to each transaction, the source high-water
is frozen, and every run records scanned/updated/review counts plus before/after reconciliation.
`COMPLETED_WITH_REVIEW` or process exit code 2 is not release success. Resolve or formally restrict
every review row; do not change it to zero merely to complete the run. A new second run must scan and
change zero already reconciled rows.

## Stage 4 — reconciliation and reopening writers

Before reopening writers, require all of the following:

- zero unclassified movements and zero `REVIEW_REQUIRED` movements in the approved scope;
- zero incomplete/review ProductCost scopes;
- physical stock equals precise basis quantity at organization/product/variant scope;
- current inventory value, frozen historical COGS, margin, UI, receipt detail, CSV, and XLSX agree;
- inventory, POS, order, and report acceptance suites pass on the deployed release;
- the exact run IDs, elapsed time, batches, affected rows, issues, and zero-change rerun are retained.

Reopen writers only after this reconciliation is signed off. Fiscal/KKM, billing, production email,
and live provider integrations remain disabled until their independent provider evidence exists.

## Application rollback procedure

1. Stop new deployments and drain inventory writers.
2. Leave all four expand migrations and all nullable columns in place.
3. Roll application code back to `7db455397eb38e9bcaa09bda5acc951964df5ab2`.
4. Run old-version product, inventory, POS, order, and report smoke tests against the expanded schema.
5. If old writes must reopen, record the interval and do not run write-mode backfill concurrently.
6. To recover forward, drain old writers again, deploy the qualified new application, run the same
   alternating-write reconciliation, resume/new-run the bounded backfill as appropriate, require a
   zero-change reconciliation, then reopen writers.

Database rollback is not `DROP COLUMN`. Restore from PITR only under the incident procedure when the
business explicitly accepts discarding every write after the chosen recovery point.

## Future contract release

The future contract template may be turned into a real migration only after all old instances are
drained, the new writer is stable, backfill is complete, current reconciliation has zero unexplained
NULL/review rows, PITR is reconfirmed, and the application rollback window is formally closed. That
later release may validate strict value/status constraints and set precise fields NOT NULL using
prevalidated checks. It must be separately timed and qualified. It must not be copied into this
release's migration directory.
