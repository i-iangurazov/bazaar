# Bazaar hardening master issue ledger

Baseline: `4d7c9b33218b584334ca62f7a816f8997f144a10`

Phase: B0 — runtime P0 verification complete; domain implementation not started

All 46 P0 hypotheses now have runtime evidence and classifications. `HARD-A4-010` is resolved by the approved B0 test-infrastructure guard; the other 45 P0s remain `OPEN` and none is implementation-complete. Browser reproduction, post-fix regression tests, desktop/mobile and theme checks where relevant, runtime-error checks, durable post-fix evidence, and independent Agent 4 verification are still required. The linked agent audit remains the canonical Phase A record; [the Phase B0 summary](./PHASE_B0_SUMMARY.md) is the canonical runtime classification and execution plan.

## Summary

| Owner | P0 | P1 | P2 | P3 | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Agent 1 — POS & Cash | 9 | 3 | 7 | 0 | 19 |
| Agent 2 — Products & Inventory | 11 | 3 | 3 | 0 | 17 |
| Agent 3 — Orders, APIs & Integrations | 15 | 7 | 5 | 0 | 27 |
| Agent 4 — Platform QA & Release Gate | 11 | 4 | 4 | 0 | 19 |
| **Total** | **46** | **17** | **19** | **0** | **82** |

## P0 — release and data-safety blockers

Phase B0 classification total: **46 CONFIRMED, 0 DUPLICATE, 0 DOWNGRADED, 0 FALSE_POSITIVE, 0 BLOCKED_BY_ENVIRONMENT**. `HARD-A4-010` is `B0_RESOLVED`; the remaining 45 are open. Runtime details are in the four `B0_AGENT_*_P0_VERIFICATION.md` reports.

| ID | Owner | Defect | Canonical evidence |
| --- | --- | --- | --- |
| HARD-A1-001 | Agent 1 | POS reads, receipt APIs, and SSE can cross an assigned-store boundary. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-001) |
| HARD-A1-002 | Agent 1 | POS mutations can target another store in the same organization. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-002) |
| HARD-A1-003 | Agent 1 | Register administration, shift close, and refund approval do not match the documented role policy. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-003) |
| HARD-A1-004 | Agent 1 | Active and held drafts can bypass cashier ownership and corrupt attribution. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-004) |
| HARD-A1-005 | Agent 1 | Concurrent returns can exceed sold quantity and restore excess stock. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-005) |
| HARD-A1-006 | Agent 1 | A shift can close while it still owns active sale drafts. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-006) |
| HARD-A1-007 | Agent 1 | Live registers can be deactivated without safely resolving operational state. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-007) |
| HARD-A1-008 | Agent 1 | Sale and completed-sale edit paths can bypass the store negative-stock policy. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-008) |
| HARD-A1-009 | Agent 1 | Concurrent KKM retries can duplicate an external fiscalization side effect. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-009) |
| HARD-A2-001 | Agent 2 | Stock counts, lots, and snapshot resolution lack assigned-store authorization. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-001) |
| HARD-A2-002 | Agent 2 | Manager product and price mutations lack source/target store scope. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-002) |
| HARD-A2-003 | Agent 2 | Store-limited users can read product cost and pricing outside their scope. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-003) |
| HARD-A2-004 | Agent 2 | Managers can bypass Admin-only initial inventory through variant stock. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-004) |
| HARD-A2-005 | Agent 2 | Product create/duplicate/import and bulk-price mutations lack safe replay protection. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-005) |
| HARD-A2-006 | Agent 2 | Retried stock-count scanner mutations can increment inventory repeatedly. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-006) |
| HARD-A2-007 | Agent 2 | Bulk stock correction can partially commit instead of remaining atomic. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-007) |
| HARD-A2-008 | Agent 2 | Category deletion can remove preferences outside the selected store. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-008) |
| HARD-A2-009 | Agent 2 | Price-tag PDF and connector printing do not enforce assigned-store access. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-009) |
| HARD-A2-010 | Agent 2 | Image-export download tokens are not bound to an authenticated owner. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-010) |
| HARD-A2-017 | Agent 2 | Receiving drafts can leak across users sharing one browser profile. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-017) |
| HARD-A3-001 | Agent 3 | Completing an API-created order deducts its stock a second time. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-001--api-order-stock-is-deducted-again-on-completion) |
| HARD-A3-002 | Agent 3 | A revoked Bazaar API credential remains usable from cache. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-002--revoked-bazaar-api-credentials-remain-valid-from-cache) |
| HARD-A3-003 | Agent 3 | API order retries are unsafe when `externalId` is omitted. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-003--api-order-retries-are-unsafe-when-externalid-is-omitted) |
| HARD-A3-004 | Agent 3 | Internal sale and purchase-order creation are not idempotent. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-004--internal-sales-and-standard-purchase-order-creation-are-not-idempotent) |
| HARD-A3-005 | Agent 3 | Substring matching can collide external order identities. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-005--external-order-ids-can-collide-by-substring) |
| HARD-A3-006 | Agent 3 | Customer records, dedupe, metrics, and recent orders cross store boundaries. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-006--customer-records-dedupe-and-order-history-cross-store-boundaries) |
| HARD-A3-007 | Agent 3 | Purchase-order and supplier authorization is enforced only in navigation. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-007--purchase-order-and-supplier-authorization-is-only-enforced-in-navigation) |
| HARD-A3-008 | Agent 3 | Marketplace procedures and artifacts bypass integration/store permissions. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-008--marketplace-server-apis-and-artifacts-bypass-integrationstore-permissions) |
| HARD-A3-009 | Agent 3 | Manual sales orders accept products not assigned to the order store. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-009--manual-sales-orders-accept-products-not-assigned-to-the-order-store) |
| HARD-A3-010 | Agent 3 | Bazaar API product price/stock cache has no mutation invalidation. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-010--bazaar-api-product-pricestock-cache-has-no-mutation-invalidation) |
| HARD-A3-011 | Agent 3 | The advertised sales-order return mode creates an ordinary sale. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-011--the-advertised-return-mode-creates-an-ordinary-sale) |
| HARD-A3-012 | Agent 3 | Bulk purchase-order cancellation can irreversibly partially succeed. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-012--bulk-po-cancellation-can-irreversibly-partially-succeed) |
| HARD-A3-021 | Agent 3 | Public catalogue checkout can create duplicate confirmed orders and emails. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-021--public-catalogue-checkout-can-create-duplicate-confirmed-orders) |
| HARD-A3-022 | Agent 3 | A stale public catalogue can show one price while checkout creates an order at another. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-022--public-catalogue-can-display-one-price-and-create-the-order-at-another) |
| HARD-A3-026 | Agent 3 | The unauthenticated catalogue image proxy permits server-side requests to arbitrary hosts. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-026--public-catalogue-image-proxy-permits-server-side-requests-to-arbitrary-hosts) |
| HARD-A4-001 | Agent 4 | Dashboard and analytics procedures do not enforce feature-level RBAC. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-001) |
| HARD-A4-002 | Agent 4 | Any authenticated role can read organization billing and upgrade history. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-002) |
| HARD-A4-003 | Agent 4 | Limited roles can list, inspect, and download sensitive exports. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-003) |
| HARD-A4-004 | Agent 4 | Global search filters restricted result types only after the server responds. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-004) |
| HARD-A4-005 | Agent 4 | The shared SSE stream leaks same-organization events across assigned stores. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-005) |
| HARD-A4-006 | Agent 4 | Period-close list and close operations lack assigned-store checks. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-006) |
| HARD-A4-007 | Agent 4 | Period-close KGS totals are computed from item quantities. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-007) |
| HARD-A4-008 | Agent 4 | Dashboard and report date bounds use deployment-server time instead of Bishkek business days. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-008) |
| HARD-A4-009 | Agent 4 | Null-organization dead-letter jobs are visible and actionable across tenants. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-009) |
| HARD-A4-010 | Agent 4 | The test harness derives one shared DB and truncates it, unsafe for four agents. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-010) |
| HARD-A4-011 | Agent 4 | Store-group and category settings routes are absent from the route guard table. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-011) |

## Phase B0 root-cause consolidation

Root-cause groups guide implementation batching; they do not remove distinct verified acceptance contracts. No issue was classified `DUPLICATE`.

| Root Cause Group | Primary Issue | Duplicate Issues | Affected Routes | Owning Agent | Shared Files |
| --- | --- | --- | --- | --- | --- |
| RC-01 — effective-store authorization | HARD-A1-001 | None; related A1-002, A2-001/009, A3-006, A4-005/006 | POS APIs/artifacts/SSE, inventory counts/lots/printing, customers, period close | Agents 1–4 by domain; Agent 4 coordinates | store-access/auth helpers, SSE |
| RC-02 — route/procedure policy parity | HARD-A4-001 | None; related A1-003, A2-004, A3-007/008, A4-002/003/004/011 | POS admin, initial stock, PO/suppliers, integrations, dashboard/analytics, billing, exports, search, settings | Agents 1–4 by route; Agent 4 coordinates | global RBAC, middleware, export auth |
| RC-03 — sensitive capability/secret boundary | HARD-A3-002 | None; related A2-010, A3-026, A4-009 | API auth, export download, image proxy, dead letters | Agents 2–4 | auth/cache, provider/storage, jobs |
| RC-04 — product/store eligibility | HARD-A2-002 | None; related A2-003, A3-009 | products, store prices, manual sales orders | Agent 2 primary; Agent 3 order validation | product assignment/store access |
| RC-05 — durable operation identity | HARD-A3-003 | None; related A2-005/006, A3-004/021 | product/import/count, API/internal/public order and PO create | Agents 2 and 3 | idempotency service; possible schema/migration |
| RC-06 — atomic destructive batch | HARD-A2-007 | None; related A2-008, A3-012 | bulk inventory, category delete, bulk PO cancel | Agents 2 and 3 | transaction helpers, audit history |
| RC-07 — stock transition invariant | HARD-A3-001 | None; related A1-005/008 | API order completion, POS returns/sales | Agents 1 and 3; Agent 2 reviews | shared inventory mutation helpers |
| RC-08 — operational document lifecycle | HARD-A1-004 | None; related A1-006/007, A2-017, A3-011 | POS drafts/shifts/registers, receiving drafts, return mode | Agents 1–3 | scoped persistence, actor/audit attribution |
| RC-09 — external side-effect claim | HARD-A1-009 | None | POS fiscal retry/worker | Agent 1; Agent 4 job coordination | POS service, job framework |
| RC-10 — exact external identity | HARD-A3-005 | None | Bazaar API orders | Agent 3 | possible schema/migration |
| RC-11 — product cache consistency | HARD-A3-010 | None; related A3-022 | Bazaar API, public catalogue/checkout | Agent 3; Agent 2 reviews mutations | query/cache configuration |
| RC-12 — period money/business time | HARD-A4-007 | None; related A4-008 | dashboard, reports, period close/export | Agent 4 | report/export/time helpers |
| RC-13 — destructive test identity | HARD-A4-010 | None | test and CI infrastructure | Agent 4; Agent 1 approved | test harness, CI workflow |

## P1 — major workflow blockers

| ID | Owner | Defect | Canonical evidence |
| --- | --- | --- | --- |
| HARD-A1-010 | Agent 1 | Connector jobs abandoned in `PROCESSING` have no timeout recovery. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-010) |
| HARD-A1-011 | Agent 1 | Receipt CSV/XLSX export contains only the currently loaded 100 rows. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-011) |
| HARD-A1-012 | Agent 1 | Inactive registers disappear from required history and debt workflows. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-012) |
| HARD-A2-011 | Agent 2 | Image ZIP export uses process memory and is unreliable in production. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-011) |
| HARD-A2-012 | Agent 2 | Connector label printing cannot complete its intended workflow reliably. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-012) |
| HARD-A2-013 | Agent 2 | Attribute key/type edits can make current variant state stale or invalid. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-013) |
| HARD-A3-013 | Agent 3 | Marketplace and AI queued jobs are not durably dispatched or recovered. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-013--marketplace-and-ai-jobs-are-not-durably-dispatched-and-queued-jobs-can-stick) |
| HARD-A3-014 | Agent 3 | Partial marketplace exports are reported as full success. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-014--marketplace-partial-exports-are-reported-as-full-success) |
| HARD-A3-015 | Agent 3 | New email-campaign send is not idempotent. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-015--new-email-campaign-send-is-not-idempotent) |
| HARD-A3-016 | Agent 3 | Complaint webhooks do not suppress future marketing. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-016--complaint-webhooks-do-not-suppress-future-marketing) |
| HARD-A3-017 | Agent 3 | API order confirmation email is fire-and-forget with no recovery. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-017--api-order-confirmation-email-is-fire-and-forget) |
| HARD-A3-024 | Agent 3 | Product Image Studio can hang requests and leave jobs permanently processing. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-024--product-image-studio-can-hang-requests-and-leave-jobs-permanently-processing) |
| HARD-A3-025 | Agent 3 | Catalogue publication, branding, and logo mutations lack complete audit history. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-025--catalogue-publication-and-logosettings-mutations-lack-audit-history) |
| HARD-A4-012 | Agent 4 | Export jobs can remain queued/running forever after lock loss or process failure. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-012) |
| HARD-A4-013 | Agent 4 | The shared modal lacks focus trap, initial focus, inert background, and focus restoration. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-013) |
| HARD-A4-018 | Agent 4 | The baseline unit release gate has two failing tests. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-018) |
| HARD-A4-019 | Agent 4 | Released cash/income/expense routes are only placeholder cards. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-019) |

## P2 — operational UX and performance

| ID | Owner | Defect | Canonical evidence |
| --- | --- | --- | --- |
| HARD-A1-013 | Agent 1 | Large POS lists lack sufficient server pagination/discoverability. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-013) |
| HARD-A1-014 | Agent 1 | Several POS queries collapse API failures into empty/disabled UI without retry. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-014) |
| HARD-A1-015 | Agent 1 | Mobile POS forces a theme and does not validate light/dark operation. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-015) |
| HARD-A1-016 | Agent 1 | Global viewport policy disables user zoom. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-016) |
| HARD-A1-017 | Agent 1 | POS date filtering/export uses inconsistent local-day boundaries. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-017) |
| HARD-A1-018 | Agent 1 | Idempotent database replay can duplicate non-database side effects/events. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-018) |
| HARD-A1-019 | Agent 1 | POS filter state is lost across detail/action navigation. | [detail](./AGENT_1_POS_AUDIT.md#hard-a1-019) |
| HARD-A2-014 | Agent 2 | Product/inventory pages exceed large-list and performance expectations. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-014) |
| HARD-A2-015 | Agent 2 | Desktop Products lacks the mobile readiness filters. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-015) |
| HARD-A2-016 | Agent 2 | The mobile Products regression source test fails on baseline. | [detail](./AGENT_2_INVENTORY_AUDIT.md#hard-a2-016) |
| HARD-A3-018 | Agent 3 | Invalid custom email button URLs are silently omitted instead of rejected. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-018--invalid-custom-button-urls-can-be-sent-with-the-button-silently-omitted) |
| HARD-A3-019 | Agent 3 | Commerce tables do not consistently preserve filters or paginate server-side. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-019--owned-tables-do-not-meet-filter-persistencepagination-contracts) |
| HARD-A3-020 | Agent 3 | Bazaar API can expose unexpected internal error messages. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-020--bazaar-api-exposes-unexpected-internal-error-messages) |
| HARD-A3-023 | Agent 3 | Public catalogue sends every product and variant to every client without pagination. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-023--public-catalogue-sends-the-full-product-catalogue-to-every-client) |
| HARD-A3-027 | Agent 3 | `/retails/` catalogue images are sent to a proxy that rejects them. | [detail](./AGENT_3_COMMERCE_AUDIT.md#hard-a3-027--retails-catalogue-images-are-routed-into-a-proxy-that-rejects-them) |
| HARD-A4-014 | Agent 4 | Mobile viewport configuration disables accessible zoom. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-014) |
| HARD-A4-015 | Agent 4 | Platform routes omit explicit API-error and retry states. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-015) |
| HARD-A4-016 | Agent 4 | Reports and period-close history load unbounded data. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-016) |
| HARD-A4-017 | Agent 4 | Large route bundles and globally loaded font families threaten performance budgets. | [detail](./AGENT_4_PLATFORM_QA_AUDIT.md#hard-a4-017) |

## Release posture

- No P0/P1 is unowned; implementation ownership follows the agent column and the shared-file lock document.
- `HARD-A4-010` is verified resolved in B0. The other 45 confirmed P0s remain open, and there are no P3-only batches to start ahead of P0/P1.
- DB-backed execution is ready on four positively identified databases with explicit reset guards; agents must continue using only their assigned database/Redis/storage identities.
- Browser, responsive, theme, Preview, production, and warmed performance evidence remain `NOT_RUN`; they are post-fix acceptance gates.
- External marketplace and email APIs must be mocked in automated tests.
