# Inventory correctness audit and release

Baseline: `ac9408b` on `main`. Scope: inventory across the application, including the shared double-click editor. Zero-cost receiving and selling through zero into negative quantities are preserved.

## Accounting model

- PostgreSQL `InventorySnapshot` is the current book aggregate, uniquely identified by store, product and `variantKey` (`BASE` or variant ID). Store and product must belong to the same organization. Store is the stock location; no separate Warehouse model exists. `StoreProduct` controls assignment, not quantity.
- `onHand` is physical book stock. `onOrder` is the remaining incoming quantity on `SUBMITTED`, `APPROVED` and `PARTIALLY_RECEIVED` purchase orders. There is no independent reservation or available-stock balance. POS drafts and parked receipts do not reserve stock. API customer orders are an exception: they deduct at creation, and completion must not deduct again.
- Snapshot quantities and signed `StockMovement.qtyDelta` use integer base units. Fractional pack input is accepted by the existing conversion paths only when multiplication produces a whole base quantity. The quick editor addresses base units, not packs.
- Product lists/public catalog totals sum BASE and variants within selected/accessible stores. Inventory rows and product-detail stock controls address BASE or one variant in one store. External base-product feeds (MMarket/Bakai/OMarket) intentionally select BASE. These numbers need not equal a variant-inclusive total.
- Expiry tracking is optional per store. `StockLot` is a supplemental expiry allocation; unallocated quantities use a null expiry. There is no FEFO allocation engine. Unallocated lots may be negative while dated receipts remain in their buckets. No historical expiry dates are inferred.
- All updates to existing physical stock now pass through `applyStockMovement`: snapshot row lock, signed movement and optional lot adjustment in the same transaction. New-store cloning initializes snapshots, movements and unallocated lots together in batches inside its creation transaction; it cannot overwrite existing store stock. Zero initialization, incoming-PO aggregates, guarded recomputation and deletion of unused products remain separate. The database increments `InventorySnapshot.version` whenever `onHand` changes, including change-and-change-back (ABA).
- Quick editing means **new absolute quantity**. The request includes original quantity and revision; the server locks and compares both before writing an `ADJUSTMENT/INLINE_STOCK` movement plus audit record. A stale editor receives a conflict. A lost-response retry keeps the same idempotency key and material payload.
- Import/bulk absolute operations are serialized at execution time. Counts instead apply the discrepancy from the captured counting baseline, preserving later sales/receipts.

## Write-path matrix

“Pass” refers to the named regression/integration suites plus code review, not a claim that every historical source document exists. Tests are under `tests/integration/` unless marked otherwise.

| Path / statuses | Expected accounting | Evidence and result | Defect / change |
| --- | --- | --- | --- |
| Create product BASE/variants | Opening stock has a signed movement and optional lot | Product/variant integration suites; core ledger/lot checks: pass | Opening writes unified through movement service |
| Duplicate product / clone store | New opening history; no foreign purchase commitments | `inventory-correctness`: copy stock/lot/history, 2,000-position clone, source PO remains source-only: pass | Clone no longer copies `onOrder`; copied physical stock creates lots; batched initialization avoids per-row timeouts |
| Assign catalog/store; archive/restore product | Zero initialization or visibility change; preserve history | Product/catalog/import suites: pass | No quantity rewrite; hard delete remains blocked by history/nonzero stock |
| Import set/add/ignore | Set computes delta under lock; add is signed delta; ignore leaves stock | `imports`, `inventory-correctness`: PostgreSQL lock-wait overlap with sale: pass | Absolute import previously derived delta before locking |
| Import retry/rollback | Once-only transaction; reverse recorded delta, preserve later operations | `imports`, `inventory-correctness`: 10→import20→sale17→rollback7; replay blocked: pass | Direct product-import stock was omitted from rollback; imported POs now locked before rollback |
| Fractional packs / conversion | Exact whole base quantity without binary floating-point rejection | `inventory-correctness`: 0.5×10=5, 0.29×100=29; 0.15×10 rejected: pass | Decimal multiplication replaces floating-point multiplication |
| Manual receiving / receiving document | Positive delta; zero cost valid; idempotent | `inventory`, `inventory-correctness`: pass | Core lot coverage and positive receipt into remaining negative stock fixed |
| PO draft / submit / approve | Draft none; submitted/approved remaining `onOrder` | `purchase-orders`, `purchase-order-line-concurrency`: pass | Preserve negative snapshot policy when changing incoming aggregate |
| PO partial/full receiving, line changes, cancel | Receive onHand; reduce onOrder; canceled remainder zero | Same suites + new partial-PO recompute regression: pass | Recompute previously omitted partially received POs |
| POS draft/park/resume/cancel draft | No movement until completion | `pos`, `pos-p0-verification`, browser isolated draft: pass | Existing semantics preserved |
| POS completion/retry/concurrent sale | One deduction per posted receipt, negative sales allowed | `pos`, `pos-idempotent-events`, `inventory-correctness`, real two-session browser: pass | All sale paths preserve negative-stock policy and lots |
| Completed POS receipt edit | Signed difference for quantity/product changes | `pos`: replacement, quantities, payment-only edit: pass | Core now also updates lots |
| Customer order lifecycle | Ordinary draft has no stock; completion deducts once | `sales-orders`, `sales-orders-pos-boundary`: pass | Existing document locks/status boundaries retained |
| Already-deducted API order edit/cancel | Lines agree with net SALE movements; cancel reverses signed net | `inventory-correctness`: qty4→2→6→remove→cancel: pass | Edits previously did not update stock; cancel ignored positive SALE corrections |
| API order replay/webhook boundary | One stock deduction and one post-commit event set | `bazaar-api-operation-request`, API/catalog integration suites: pass | Added inventory refresh event; asserts one order event and one inventory event, no replay duplication |
| Customer return / completed-return edit | Restore posted quantity, edits apply signed difference | `pos`, `inventory-correctness`: pass | Central lot coverage; original lot retained on order cancellation |
| Supplier return | No dedicated implementation found | Not applicable | No new feature introduced |
| Transfer / retry | Paired movement in one transaction; conserve cross-store total | `inventory`, `inventory-correctness`: pass | Lots updated centrally; edited transfers retain expiry bucket across quantity/store changes |
| Write-off | Negative signed movement; existing negative permission retained | `inventory`: documents, edits, negative quantity outcome: pass | Central lot coverage |
| Manual delta / bulk absolute correction | Locked arithmetic; no lost update | `inventory`, `inventory-correctness`: concurrent bulk/sale and rollback: pass | Bulk delta moved inside snapshot lock |
| Count scan/set/remove/apply/cancel | Captured baseline; serialized line/status transitions; apply once | `stock-counts`, `inventory-correctness`: six concurrent scans; two apply keys; intervening sale: pass | Parent count locks added; apply no longer replaces baseline with live quantity |
| Receiving/transfer/write-off edit | Difference movements; replacement/store change atomic | `inventory` tests for each document, line removal and corrected stores: pass | Expiry allocation preserved for transfer edits |
| Archive document | Hide from active history; **does not cancel physical stock** | `inventory` + new stale-tab archive/edit regression: pass | Archived document cannot be edited from an already-open tab |
| Bundle assembly | Consume components, receive output atomically | `bundles`, full scenario in `inventory-correctness`: pass | Both sides now update optional lots |
| Separate workshops / manufacturing orders | No additional module/schema found | Not applicable | Bundle assembly is the implemented production operation |
| Enable/re-enable expiry tracking | Unallocated lot opening equals verified book stock; preserve dated lots and physical history | `inventory-correctness`: enable, disable, sale and re-enable: pass | Added audited unallocated baseline under serializable isolation; refuses incomplete journal |
| Recompute / maintenance | Validate ledger completeness; consistent transaction; rebuild incoming correctly | `inventory`, `inventory-correctness`: pass | Serializable transaction; reject onHand/journal disagreement instead of destructive overwrite |
| Exports, forecasts, reorder, recovery/background integration jobs | Read stock or call existing posting services; no independent physical writer | Whole-repository search for snapshot SQL/Prisma writes and movement creation; existing suites: pass | No additional direct stock-changing background implementation found |

## Read/UI matrix

| View | Definition / verification | Result |
| --- | --- | --- |
| Product table/grid/mobile cards | Selected-store BASE+variant total; shared editor only when unambiguous | Catalog aggregate can no longer be written into BASE; touch-capable double-click verified |
| Inventory table | One store/product/variant snapshot | Shared absolute editor; selected identity verified after filtering |
| Product detail: current store, all stores, variants | Individual BASE/variant stock and revision | All old stock inputs replaced by the same guarded editor; real browser round trip agrees with inventory and product total |
| POS catalog | Stock for selected register store | Inventory SSE invalidates catalog/bootstrap; sale at 3 with qty5 produces -2 and conflicts with another open editor |
| Documents and movement history | Signed/effective document lines, not current stock | Receiving/transfer/write-off/receipt/return edit suites verify effective quantities and history |
| Dashboard / low-stock / exports / reorder | Current snapshots with accessible-store scope | Existing read-model/report suites pass; inventory events refresh dashboard |
| Historical stockout report | Reconstruct boundary using end-of-period stock | Fixed later receipts incorrectly shifting historical crossings; new regression passes |
| Public catalog / Bazaar API | Current source-backed totals/explicit variant quantities | Reviewed database reads; no stale product-stock response cache remains in these services |
| MMarket / Bakai / OMarket | BASE quantities scoped to configured organization/store | Definition difference documented; no aggregation overwrite introduced |

The browser harness tests focus/select-all, Escape, Enter+blur single flight, slow response, invalid/empty/fractional/unchanged input, zero/negative quantities, two independent authenticated sessions, a concurrent isolated POS sale, response loss after commit with exact-key retry, pre-commit network loss, reload/relogin, sorting/search/pagination, variant addressing and role restrictions. The tables use server pagination rather than row virtualization; actual React cell remounts are additionally exercised by `tests/unit/inline-edit-cell.test.tsx`.

ADMIN/MANAGER can correct accessible stock. STAFF cannot open the product/inventory management routes. CASHIER can view products but cannot correct stock. Both restricted roles are rejected by the server. Cross-organization store and variant identities are checked independently of UI permissions.

## Reproducible reconciliation and existing data

Run `node --import tsx scripts/inventory-audit/reconcile.ts` for the dedicated local fixture, or add `--production` to use the **already configured** `.vercel/.env.production.local` connection in memory. The script does not pull/copy credentials. PostgreSQL enforces a READ ONLY, REPEATABLE READ transaction with timeouts. Reports go to ignored, permission-restricted `artifacts/bazaar-stock-audit/` files, with a printed SHA-256 digest.

The reconciliation compares the full identity union of snapshots, signed journal, incoming PO lines and lots. It independently projects PO receipts, customer-order deductions/cancellations, completed returns and applied counts against their document movements. Opening/import/adjustment source counts are included. Movement-only documents cannot independently prove their own historical completeness; equality with a journal is not evidence of a physical stock count.

Production read-only result before release: **15 organizations, 30 stores, 35,910 stock identities, 53,246 movements**. Incoming discrepancies: **0**; enabled-lot sum discrepancies: **0**; store/product tenant discrepancies: **0**; projected-document mismatches: **0**. One snapshot/journal discrepancy was found in organization `test`, SKU `URGENT-QA-msq8bz5g`: snapshot **99**, journal **-1**. Investigation found two sales of one unit and cancellation of one sale, but no independently evidenced opening 100-unit movement. This is an ambiguous old QA fixture, not a proven quantity to replace. Its stock and history were left unchanged.

Pre-release report digest: `78933c7dee6e3c350b46b884392a3e817c1967aafce88fb88020547dadbf884b`.

No provable production correction was found and no historical data repair was applied. The diagnostic emits a precise dry-run plan only for source-proven incoming aggregate differences (before/after, quantity/version/timestamp and source fingerprint); this production plan is empty. There is deliberately no generic physical-balance overwrite/apply switch. The ambiguous QA record requires independent opening/count evidence before a compensating, audited correction can be authorized and designed. Existing expiry coverage gaps cannot be assigned invented dates.

## Running isolated checks

Dedicated disposable PostgreSQL: port **55439**, user/password `bazaar_test` / `bazaar_test_only`; browser database `bazaar_hardening_agent2_inventory`. Dedicated Redis: **56389**. Destructive integration suites use a separate database, `bazaar_hardening_ci`, and never reset browser fixtures. These are synthetic local/CI credentials.

- `node --import tsx scripts/inventory-audit/run.ts`: migrate an empty dedicated browser DB, seed fixtures, run isolated Next and real Chromium scenarios. Requires `pnpm exec playwright install chromium`; set `QA_BROWSER_CHANNEL=chrome` to use local Chrome. External browser requests are blocked and server-side provider calls are intercepted by the existing stabilization transport.
- `node --import tsx scripts/inventory-audit/test.ts`: complete unit/integration suite with the dedicated reset-safe DB.
- `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check`.
- Stop the local development server, then `node --import tsx scripts/inventory-audit/build.ts` for a production build using disposable services and sanitized configuration.

The full document scenario has predetermined expected BASE stock: receive20 → sell5=15 → return2=17 → transfer4=13 (destination4) → absolute14 → edit receipt20→22=16 → assemble2 consuming3 each=10 (bundle output2). Every checkpoint compares snapshot, movement sum and lot sum; product reads agree.

## Rollout and production verification

Migration `20260910000000_inventory_stock_version` adds a default-zero revision and a trigger without changing any quantities. Its reviewed SQL checksum is registered in the existing production migration guard; unknown or changed migrations remain blocked. Old writers remain compatible because PostgreSQL maintains the revision. App rollback may leave this additive schema in place; do not drop history or rewrite quantities.

CI includes an `inventory-browser` job using separate disposable services, and `release-gate` requires it alongside all pre-existing checks. Production verification must use `/api/version` for the exact pushed SHA, migration history/trigger, Vercel alias and build logs, anonymous release smoke and `production-smoke.ts --sha=<40-character SHA>`. Authenticated smoke creates its own QA organization, performs only stock adjustments, checks a second-session conflict and zero final journal/lot balance, then disables test users and archives the zero-stock QA product. No customer sale, payment or fiscal operation is created.

Final SHA, CI/deployment URLs and post-release evidence are recorded in the release report after verification.
