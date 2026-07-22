# B0 Agent 3 P0 runtime verification

## Outcome

- Runtime baseline: `81170113088e20b793d56c4b37575ca3cb1a64a0` on `hardening/b0-agent-3-commerce`.
- Evidence-test commit: `3bcb9485eec4ddd6c33666ea3b55d9d3b7d680b7`.
- Scope: the 15 Agent 3 P0 findings `HARD-A3-001` through `HARD-A3-012`, plus `HARD-A3-021`, `HARD-A3-022`, and `HARD-A3-026`.
- Result: 15 `CONFIRMED`; 0 `DUPLICATE`; 0 `DOWNGRADED`; 0 `FALSE_POSITIVE`; 0 `BLOCKED_BY_ENVIRONMENT`.
- No application, schema, migration, package, shared-platform, or provider configuration was changed. B0 added focused evidence tests and this report only.
- These classifications confirm pre-fix defects. They do not mark any issue fixed or release-ready.

The only permitted B0 classifications are `CONFIRMED`, `DUPLICATE`, `DOWNGRADED`, `FALSE_POSITIVE`, and `BLOCKED_BY_ENVIRONMENT`. Every issue below has exactly one classification.

## Runtime isolation and safety

| Control | Runtime evidence |
| --- | --- |
| Database | Local PostgreSQL database `bazaar_hardening_agent3_commerce`; destructive setup guarded by `EXPECTED_TEST_DB_NAME`; 87 migrations applied and no pending migration. |
| Reset ownership | Agent 3 isolated worktree and database only; test file parallelism disabled by the repository harness. |
| Redis | Dedicated local Redis database 13 for warmed-cache cases; no shared-instance flush. |
| Email | Provider key absent; confirmation mail mocked and call-counted. |
| Marketplace/AI | Provider access disabled; permission tests make zero external fetches. |
| Image proxy | Global `fetch` replaced with a deterministic spy; no socket or DNS request occurred. |
| Schema changes | None; `db push` was not used. |

All DB-backed executions used the checked-in `.env.hardening` identity through this exact prefix:

```bash
set -a; source .env.hardening; set +a; pnpm exec vitest run <focused files>
```

The final combined run was:

```bash
set -a; source .env.hardening; set +a; pnpm exec vitest run \
  tests/integration/b0-agent-3-orders-p0.test.ts \
  tests/integration/b0-agent-3-access-cache-p0.test.ts \
  tests/integration/b0-agent-3-catalog-p0.test.ts \
  tests/unit/b0-agent-3-return-mode.test.tsx \
  tests/unit/b0-agent-3-public-image-proxy.test.ts \
  --reporter=verbose
```

Result: 5 test files passed, 17 tests passed, 0 failed, in 23.25 seconds. Each focused case emits one `[B0-EVIDENCE]` JSON record containing the stable before-fix facts summarized below.

## Classification and runtime evidence

| ID | Classification | Root group | Focused evidence test | Stable pre-fix runtime evidence |
| --- | --- | --- | --- | --- |
| HARD-A3-001 | CONFIRMED | G2 | `orders-p0` | One API order changed stock `10 -> 9`; completing the same order changed it `9 -> 8`; two `SALE` deltas of `-1` exist for one order. |
| HARD-A3-002 | CONFIRMED | G3-S | `access-cache-p0` | After a GET warmed the API-key cache, database `revokedAt` was set, but the same credential still authenticated to the same key ID through the memory/Redis cache. |
| HARD-A3-003 | CONFIRMED | G1 | `orders-p0` | Four equivalent requests without `externalId`—two sequential and two concurrent—created four distinct orders and changed stock `10 -> 6`. |
| HARD-A3-004 | CONFIRMED | G1 | `orders-p0` | Two identical sales draft creates produced two IDs. Two identical submitted PO creates produced two POs and `onOrder=10` for an intended quantity of 5. |
| HARD-A3-005 | CONFIRMED | G1-E | `orders-p0` | Creating `EXT-10` then `EXT-1` returned the same order ID; exact lookup/list for `EXT-1` resolved to `EXT-10`; only one row existed. |
| HARD-A3-006 | CONFIRMED | G4-D | `access-cache-p0` | A Store A manager listed and opened a Store B customer. A Store A order then updated that Store B customer; the customer remained assigned only to Store B and its order count increased. |
| HARD-A3-007 | CONFIRMED | G4 | `access-cache-p0` | Staff read a Store B PO, Cashier read suppliers, and a Store-A-only Manager canceled a Store B PO. Its status became `CANCELLED` and `onOrder` changed `5 -> 0`. |
| HARD-A3-008 | CONFIRMED | G4 | `access-cache-p0` | Staff/Cashier read protected Bazaar Catalogue, M-Market, Bakai, O! Market, and Image Studio procedures. A Store-A-only Manager persisted a Store B M-Market selection. Provider fetch count was zero. |
| HARD-A3-009 | CONFIRMED | G2-E | `orders-p0` | Initial-line and add-line mutations accepted a product assigned only to another store. Completion created a Store A `SALE -1` movement and `onHand=-1`. |
| HARD-A3-010 | CONFIRMED | G3 | `access-cache-p0` | A warmed Bazaar API response continued returning price 100 and stock 10 after committed database values became price 200 and stock 7. Memory and dedicated Redis cache participated. |
| HARD-A3-011 | CONFIRMED | G2-R | `return-mode` + `orders-p0` | `/sales/orders/new?mode=return` displayed return copy but invoked `salesOrders.createDraft` without an original-sale/return identity. The resulting domain path completed as `MANUAL`, created one `SALE`, reduced stock to 9, and created no return relation. |
| HARD-A3-012 | CONFIRMED | G5 | `orders-p0` | The two bulk cancel promises settled `[fulfilled,rejected]`; one PO was permanently `CANCELLED`, the other remained `APPROVED`, and total `onOrder` changed `10 -> 5`. |
| HARD-A3-021 | CONFIRMED | G1-P | `catalog-p0` | Two checkouts with the same ignored `Idempotency-Key` returned 200 with distinct confirmed order IDs. Two rows, two customer-count increments, two event calls, and two mocked email calls resulted. |
| HARD-A3-022 | CONFIRMED | G3-P | `catalog-p0` | The warmed public catalogue showed price 100 before and after a committed change to 120; checkout silently created the order at 120. Email was mocked; no live provider call occurred. |
| HARD-A3-026 | CONFIRMED | G6 | `public-image-proxy` | A loopback URL with a managed-looking path reached the mocked fetch and the public route returned synthetic `internal-secret` bytes with status 200. Live network count was zero. |

Focused evidence filenames:

- `tests/integration/b0-agent-3-orders-p0.test.ts`: A3-001, A3-003, both A3-004 create paths, A3-005, A3-009, A3-011 domain effect, and A3-012.
- `tests/integration/b0-agent-3-access-cache-p0.test.ts`: A3-002, A3-006, A3-007, A3-008, and A3-010.
- `tests/integration/b0-agent-3-catalog-p0.test.ts`: A3-021 and A3-022 with mocked email/event delivery.
- `tests/unit/b0-agent-3-return-mode.test.tsx`: rendered return-mode UI and captured mutation contract for A3-011.
- `tests/unit/b0-agent-3-public-image-proxy.test.ts`: A3-026 with mocked global fetch.

## Confirmed root-cause groups and primary issues

The groups below identify likely shared implementation seams. They do not erase independently confirmed acceptance cases.

| Group | Primary issue | Other confirmed members | Runtime-supported common cause | Duplicate disposition |
| --- | --- | --- | --- | --- |
| G1 — durable operation identity | HARD-A3-003 | HARD-A3-004, HARD-A3-021 | Create contracts do not require, persist, and replay a durable operation key across API, tRPC, and public checkout. | No duplicates. Different callers and stock/customer/email effects require separate regressions. |
| G1-E — exact external identity | HARD-A3-005 | — | External identity is embedded in searchable text and matched by substring rather than stored/queried as an exact constrained field. | Primary standalone acceptance case; likely shares a migration batch with G1. |
| G2 — stock transition ownership | HARD-A3-001 | — | API creation and ordinary completion both own a stock-decrement transition for the same order. | Primary standalone stock-accounting case. |
| G2-E — store eligibility | HARD-A3-009 | — | Server mutations trust product IDs without enforcing active product assignment to the order store. | Primary standalone mutation-boundary case. |
| G2-R — return state machine | HARD-A3-011 | — | Return presentation is only a query/UI mode; the mutation and persisted document remain an ordinary sale. | Primary standalone domain-contract case; coordinate with Agent 1. |
| G3 — product cache invalidation | HARD-A3-010 | HARD-A3-022 | Product/price/stock mutations do not invalidate or version commerce response caches. | No duplicates. Public price acceptance in A3-022 is an additional contract even if invalidation is shared. |
| G3-S — credential invalidation | HARD-A3-002 | — | Revocation writes the database but does not invalidate warmed credential cache entries. | Primary security case; not a duplicate of product caching. |
| G4 — procedure policy parity | HARD-A3-007 | HARD-A3-008 | Navigation permissions and store access are not consistently enforced at tRPC/service boundaries. | No duplicates. PO/supplier and integration surfaces have different effects and route matrices. |
| G4-D — customer data ownership | HARD-A3-006 | — | Customer lookup/upsert operates at organization scope where the user and order are store-scoped. | Primary data-isolation case. |
| G5 — reconcilable batch mutation | HARD-A3-012 | — | Client-side `Promise.all` composes independent destructive commits without an atomic or durable partial-result contract. | Primary standalone batch case. |
| G6 — outbound origin validation | HARD-A3-026 | — | A managed-looking path is accepted without validating the destination origin/network boundary. | Primary standalone security case. |

Accordingly, no issue is classified `DUPLICATE`. Grouping is implementation guidance only.

## Confirmed root causes and likely files

- A3-001: API-created orders already deduct stock before entering the ordinary sales completion state machine, whose completion path deducts again. Likely order API route/service and sales-order completion service.
- A3-002: credential cache entries outlive `revokedAt` changes. Likely Bazaar API authentication/key service and shared cache invalidation.
- A3-003/A3-004/A3-021: create endpoints have no durable operation-key record with payload fingerprint and replay result. Likely API checkout/order routes, sales/PO routers and services, plus a coordinated Prisma migration.
- A3-005: external identity is inferred from notes/searchable text with substring matching. Likely Bazaar API order service/query and a coordinated exact-identity schema change.
- A3-006: customer lookup, recent-order visibility, and order-driven upsert are organization-wide instead of effective-store scoped. Likely customer service/router and all commerce customer-upsert entry points.
- A3-007/A3-008: domain procedures use broad authentication/organization checks where route policy requires role and effective-store checks. Likely PO/supplier routers, integration routers/services, and artifact routes; shared RBAC helper changes require Agent 4 coordination.
- A3-009: sales-order line creation resolves organization products without requiring an active assignment for the target store. Likely sales-order create/add-line service validation.
- A3-010/A3-022: product, price, stock, archive, and assignment writes do not fan out cache invalidation/version changes to Bazaar API/public catalogue keys. Likely product/store-price/inventory mutation services and commerce cache configuration; coordinate with Agent 2.
- A3-011: return mode changes labels only and still submits the ordinary sales-draft mutation. Likely new-sales-order page and sales/returns domain; coordinate with Agent 1.
- A3-012: the UI fires independent cancel mutations under `Promise.all`; the server has no batch transaction or durable per-item result. Likely purchase-order list UI and router/service.
- A3-026: the public proxy checks a path pattern but not an exact trusted origin, resolved address, or redirect chain. Likely public catalogue image proxy and reviewed storage-fetch helpers; coordinate with Agent 2 for shared image code.

## Test gaps retained for implementation and release verification

B0 used the smallest deterministic layer able to prove each defect. The following are post-fix acceptance or release-gate gaps, not blockers to the classifications:

1. Agent 4 browser harness coverage for duplicate submit/retry UX, direct-route RBAC denial, partial-batch reconciliation, catalogue price reconfirmation, and the end-to-end return decision.
2. Multi-process cache invalidation checks after fixes. B0 proved warmed memory plus dedicated Redis behavior in one process; implementation acceptance must prove another process cannot serve a revoked key or stale product.
3. A complete role/procedure/artifact matrix for every marketplace endpoint. B0 exercised representative reads across all five named integration surfaces and a cross-store write without invoking providers.
4. The full SSRF negative matrix: IPv4/IPv6 private and link-local ranges, credentials/ports, non-HTTP schemes, redirects, DNS rebinding, MIME, and byte limits. B0 safely confirmed the primary loopback exploit with a fetch spy.
5. Concurrent same-key post-fix tests with mismatched-payload conflicts and exact side-effect cardinality for each create surface.
6. Independent Agent 4 verification on the integration Preview after fixes; no source-string-only test can satisfy these P0 acceptance cases.

## Post-fix acceptance invariant

Each issue remains open after B0. Its implementation batch must preserve this pre-fix reproduction, add a post-fix regression at the same or stronger runtime layer, verify transactionality/idempotency/scoping and duplicate-side-effect prevention, and receive independent Agent 4 verification. Application fixes must be committed separately from these evidence tests and this report.
