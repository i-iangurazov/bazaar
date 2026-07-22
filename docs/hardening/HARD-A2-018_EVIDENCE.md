# HARD-A2-018 — receiving edit and rollback cost consistency

## Reproduction before the fix

- Post a receiving document with `10 × 5 KGS`. `ProductCost` is `avgCostKgs=5`, `costBasisQty=10`.
- Edit the effective line to `7 × 6 KGS`. Stock becomes 7 and the document value becomes 42 KGS, but the prior implementation only added positive quantity deltas to `ProductCost`; it left the cost row at `5 / 10`.
- Receive an imported purchase order with `4 × 5 KGS`, then roll the import back. Stock returned to zero while `ProductCost` remained `5 / 4`.

Root cause: receiving edits and import rollback wrote stock compensation without replacing the corresponding weighted-cost contribution. Reconstructing the aggregate from `avgCostKgs × costBasisQty` alone is also unsafe because the stored average is rounded and some legitimate manual/import/legacy bases have no valued movement provenance.

## Implemented invariant

- New cost-bearing stock receipts persist signed unit and line values.
- Receiving edits replace the effective quantity/value contribution under a product row lock.
- Fully valued movement histories use their exact Decimal totals, avoiding repeated-edit rounding drift.
- Manual/import/legacy bases retain the existing incremental weighted-average policy rather than being silently rebuilt.
- Import rollback retains its established `ADJUSTMENT` movement type, writes signed cost metadata, and subtracts the received contribution in the same transaction.
- The read-only detector reports `INDETERMINATE_UNVALUED_STREAM` when provenance cannot support an exact comparison.

## Database evidence

Focused suite (isolated database `bazaar_hardening_agent2_inventory`):

```text
pnpm exec vitest run tests/integration/hardening-agent2-b2-cost.test.ts
Test Files  1 passed (1)
Tests       8 passed (8)
```

Machine-readable assertions captured by the suite:

```json
{
  "receivingReversal": {
    "beforeArchive": { "avgCostKgs": 0, "costBasisQty": 0 },
    "afterArchive": { "avgCostKgs": 0, "costBasisQty": 0 },
    "onHand": 0,
    "movementQty": [10, -3, -7],
    "movementValueKgs": [50, -8, -42],
    "detector": "MATCH"
  },
  "purchaseOrderImportRollback": {
    "before": { "avgCostKgs": 5, "costBasisQty": 4 },
    "after": { "avgCostKgs": 0, "costBasisQty": 0 },
    "compensation": { "type": "ADJUSTMENT", "qtyDelta": -4, "lineTotalKgs": -20 },
    "retryMovementCounts": [1, 1],
    "purchaseOrderStatus": "CANCELLED"
  },
  "detectorStates": {
    "clean": {
      "status": "MATCH",
      "actual": { "avgCostKgs": 0, "costBasisQty": 0 },
      "expected": { "avgCostKgs": 0, "costBasisQty": 0, "totalValueKgs": 0 }
    },
    "staleDocument": {
      "status": "MISMATCH",
      "actual": { "avgCostKgs": 5, "costBasisQty": 10 },
      "expected": { "avgCostKgs": 6, "costBasisQty": 7, "totalValueKgs": 42 },
      "affectedStoreIds": ["<test-store-id>"],
      "stockReceivingReferenceIds": ["<test-receiving-id>"],
      "supersededReceivingReferenceId": "<test-receiving-id>"
    },
    "externalBasis": {
      "status": "INDETERMINATE_UNVALUED_STREAM",
      "actual": { "avgCostKgs": 6.49, "costBasisQty": 8 },
      "valuedStream": { "quantity": 7, "totalValueKgs": 42 }
    }
  }
}
```

The live read-only detector was also exercised against the isolated database:

```text
node --import tsx scripts/product-cost-mismatch-report.ts --organization-id <test-org-id> --limit 100 [--cursor <product-id>]
```

The CLI is read-only, scans at most 500 products per page, returns `nextCursor`, includes affected store and receiving-document identifiers, and exits with status 2 when a row needs review. A live bounded scan of the legacy PO fixture returned one `INDETERMINATE_UNVALUED_STREAM` row and no writes.

## Covered regression matrix

- retry of the same edit key;
- multi-receipt Decimal rounding and a second edit;
- effective line removal (`7 × 6 → -7 / -42`);
- archive marker leaves stock and cost unchanged;
- variant isolation and organization-wide multi-store aggregation;
- manual/import prior cost basis preservation;
- determinate mismatch and forced transaction rollback;
- purchase-order receipt cost update;
- import rollback, already-rolled-back retry, and stock-failure atomicity.
