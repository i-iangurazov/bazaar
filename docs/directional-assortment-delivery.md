# Directional assortment, sale channel, and customer reports

## Baseline and plan

- Started on `main`, clean working tree, HEAD and fetched `origin/main` both
  `f2e9e86a4437ade3095aa3632918a1d061af20cf`; remote is
  `https://github.com/i-iangurazov/bazaar.git`. No applicable AGENTS.md found.
- Existing group UI: `/settings/store-groups`; server: `storeAssortments.ts`,
  `productCatalogs.ts`, `storeAccess.ts`, `products.ts`, `stores.ts`.
  Groups materialize StoreProduct assignments and zero inventory rows. Group
  synchronization currently unions visible products and renames the source group.
- Readers use active StoreProduct identities: products, POS, inventory, barcode
  search, public catalogue/API, integrations, BAAM and reporting stock cohorts.
  Writers include product creation/duplication/import, store setup/copy/group
  changes, inventory receipts/transfers and BAAM through product services.
- POS sales are CustomerOrder records; source MANUAL/CATALOG/API is order origin,
  and isPosSale separates checkout systems. Neither is a commercial channel.
  Draft/hold/resume/return paths are server based. PWA has no offline sales queue.
- `/reports/analytics` already aggregates products, customers and documents on
  the server. Its channel filter means POS/orders. Customer grouping currently
  uses contact strings; CustomerOrder lacks a customer ID. Refunds use their
  completion date. Amounts are recorded KGS snapshots. Business timezone is
  globally Asia/Bishkek; there is no per-organization timezone configuration.
- Docker Desktop initially was not running. It was started using its installed
  application path. GitHub CLI works with the permitted keychain/network access.
  Tests use identified disposable databases only. No merchant settings changed.

### Work sequence

1. Capture baseline tests and desktop/mobile POS evidence using isolated data.
2. Add durable direct/historical/share provenance and opt-in directed policy.
   Replace group editor with store overview, source review, atomic preview/apply,
   pause/resume and history. Keep existing group behavior until explicit conversion.
3. Add nullable commercial sale channel, POS checkbox and lifecycle persistence.
4. Extend existing reports with commercial channel, quantity ranking, real customer
   identity filtering, product/receipt navigation and matching exports.
5. Run schema, localization, lint, types, regression, browser and production gates;
   review changes; make focused commits on main; fetch/push and verify exact-SHA CI.

## Delivered behavior

### Assortments

`/settings/store-groups` now shows each store's directions, direct assignments,
unresolved historical access, received products and distinct visible total. The
existing product-list link includes `storeId`. Only an administrator or organization
owner can preview/apply rules; all referenced IDs are checked within the organization.

`StoreProduct` remains the visibility reader used by product pages, POS, inventory,
barcode lookup, imports, public catalogue/API and assistant tools. New provenance is
additive: existing assignments default to historical, never inferred ownership.
Creating a product or explicitly assigning a previously unavailable product establishes
direct eligibility. Receiving shared products, inventory operations, copying legacy
stores, and reactivating existing access do not promote received/historical products
into a new source assortment. Duplication carries the selected store context; ambiguous
duplication involving a directed store requires a store.

Rules materialize the same product IDs and retain per-rule grants. ALL shares direct
products and defaults to future inclusion; SELECTED grants only reviewed IDs. Targets
leave their legacy group in the same transaction. Mutual sharing is explicit and also
converts its reverse target. Other legacy peers keep their behavior. No inventory,
movements, prices, cost basis or product fields are copied by sharing. Existing store
prices apply, otherwise the global base price applies. Pausing or narrowing scope
retains earlier grants; historical cleanup is a separate task. To make a store fully
independent, leave its legacy group and pause every active incoming/outgoing rule.

Preview uses a signed, actor-bound, 15-minute token and fingerprints assignment,
product/barcode, group and rule state. Apply is idempotent and serializable, checks
the fingerprint again, commits every target and audit record atomically, then emits
authorized SSE invalidations. Creation/import/duplication also invalidate receiving
catalogues after commit. A database trigger grants future direct assignments within
the writer transaction; received assignments cannot cascade. Product creation reads
group policy under the same organization lock as configuration changes. Converted
stores have no legacy catalog ID and a database guard prevents legacy rejoining.

Different product IDs are retained. A historical collision between a product barcode
and a pack barcode returns both candidates to the existing scanner chooser.
Receiving access alone cannot authorize global product edits, bulk barcode changes,
description jobs or saving generated images. Existing local store-price permissions
remain in force. Assistant product mutations use the same protected router/services.

### POS

`/pos/sell` has the small **Онлайн-продажа** checkbox in the payment summary on
desktop/tablet and above the existing properties section on mobile. `SaleChannel`
is separate from MANUAL/CATALOG/API origin and POS/order report scope.

New POS drafts default to IN_STORE, including older payloads. Toggles are local until
the existing create/hold/complete request; keys include user, register and receipt.
Reload and failed submissions retain the choice. Successful completion/cancellation/
hold clear the finished cart's local choice. Resume reads the saved channel. The
control cannot change while checkout/hold or receipt recovery is pending. Historical
null stays “not recorded”; no historical backfill runs. New catalogue orders are
ONLINE. Existing code rejects order-to-POS conversion; this task adds no new integration
or offline transaction queue. Returns report the original sale's channel. The existing
receipt preview shows the saved value.

### Customer and best-seller reports

The existing `/reports/analytics` is extended, not duplicated. It has commercial-channel
filters, quantity ranking, a paginated real-customer selector and customer product/
document views. `/customers` detail links to the filtered report and to the existing
`/reports/receipts?receiptId=...` detail. Existing report-hub links remain available.
CSV/XLSX exports use the same server aggregation and access checks as visible rows;
document exports include time, store, status and saved channel. The existing 10,000-row
export guard still requires narrower filters when exceeded.

New purchases persist customerId while retaining contact snapshots. IDs survive
contact changes. Historical null-ID orders match only a unique normalized email or,
when the order has no email, unique phone across the organization (including deleted
customer records to avoid reused identities). Names and anonymous purchases never
establish a link. Ambiguous old contacts require data review. Existing customer list/
detail tenancy is store scoped; this task does not rewrite it. Report rows always use
permitted stores. A customer linked to a permitted receipt is selectable even if their
home store is elsewhere; unrelated inaccessible customer contacts are not exposed.

Accounting follows existing completed, non-held sales and completed refunds. Header
discounts are allocated over recorded lines; split payments cannot multiply amounts.
Refunds follow their completion date, independently of the original sale date. Gross,
returns and net spend are shown separately. Currency amounts are recorded KGS
snapshots; product quantities keep their units and are not presented as a meaningful
cross-unit total. Current prices/costs and catalogue sharing do not change history.

Business time is the application's existing **Asia/Bishkek** configuration; no per-org
timezone field exists. Inclusive end dates become an exclusive next-day boundary.
UTC timestamp comparison is now explicit, avoiding PostgreSQL-session timezone shifts.
Custom intervals including 50 days and multiple years work (100-year safety bound).
For periods over 366 days the series contains activity days instead of thousands of
synthetic empty days. Other existing BAAM link validation retains its prior limit.

## Merchant transition

No verified production organization/store IDs or merchant data snapshot were available.
Names and the supplied 3364/3366 screenshot were not used to infer source ownership.
No live sharing rule, store membership, product or inventory record was changed.

Tested path for **Баткен базар → Курулуш Гранд**:

1. An administrator opens `/settings/store-groups` in the correct organization.
2. Select Баткен базар as source and only Курулуш Гранд as recipient. Keep the reverse
   checkbox off. Review existing outgoing rules and legacy-group exit in the preview.
3. Historical group access is unresolved. Choose **Selected products**, search/page
   through the actual source IDs, and select the verified Batken assortment. Preview
   distinct overlap/new totals, conflicts and retained products, then Apply.
4. The recipient is detached from its old group. Pause any separately configured
   outgoing rules if it must export nothing. Existing leaked visibility elsewhere is
   retained; new recipient products remain private.
5. If future direct Batken products should also arrive, edit A → B to **All eligible
   source products**, leave future inclusion on, review and Apply. Earlier reviewed
   historical grants remain. A fixed selection alone intentionally excludes future IDs.

The two extra inventory rows need a read-only audit using verified organization and
store IDs. Count distinct product IDs separately from rows/variants and classify rows
with archived products, inactive/missing assignments, non-base variants, nonzero
quantity and on-order quantities. Compare actual IDs, not counts. The schema permits
these legitimate differences; no diagnosis or deletion of those two rows is claimed.

## Verification and release

- Baseline: 221 non-DB suites / 1539 tests passed; desktop 1440×1000 and mobile
  390×844 POS screenshots captured in ignored `artifacts/directional/baseline`.
- Final full `pnpm test:ci` on Docker PostgreSQL 16 / Redis 7: **301 suites, 2107 tests**
  passed, including lint, TypeScript and localization. Schema validation and diff
  whitespace checks passed. Focused concurrent sharing and customer report fixtures
  include non-UTC DB sessions, cross-tenant access and full transaction rollback.
- `pnpm test:stabilization`: **603 unit + 134 integration tests** passed.
- `scripts/reporting/run.ts`: production build passed; reporting checks passed across
  **72 viewport/theme/locale combinations**, actual receipt drilldown, customer search,
  50-day customer totals, CSV export, roles, loading/error/empty states and 200% zoom.
- Additional browser checks passed for desktop/mobile completion, one-click online
  classification without a toggle request or scanner-focus change, reload, fresh-sale
  default, mobile hold/resume, and assortment preview/apply with private future recipient
  products. These checks now also run in the existing reporting-browser CI job.
  Final release details are recorded in the delivery response. Evidence is ignored under `artifacts/directional`
  and `artifacts/reporting`; no test fixtures run against production.
- Additive migration SQL is checksum-approved through the existing Vercel production
  build gate. Applying schema does not configure any merchant's sharing topology.
- Full migration/schema comparison has pre-existing differences: truncated index
  names, two `updatedAt` defaults and the SQL-only stock-movement index. Applying the
  unmodified baseline migrations to a separate disposable database and comparing both
  drift scripts verified they are identical: this release introduces no schema drift.

## Rollback

Set `NEXT_PUBLIC_POS_SALE_CHANNEL_ENABLED=0` and rebuild to hide the optional control.
Saved channels and old-client checkout remain valid. Reverting report UI/query changes
does not require dropping customer IDs or channel data.

For catalogue rollback, pause outgoing/incoming rules through preview/apply, or revert
the relevant UI/service commit while retaining additive schema, the directed-store
guard and null legacy catalogue IDs. **Never restore converted stores' old group IDs
or remove the guard.** An older writer must not reactivate unintended propagation.
Earlier assignments/history remain intact; no destructive down migration is proposed.
