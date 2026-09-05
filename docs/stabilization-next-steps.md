# Stabilization: what remains next

The focused local pass fixed and verified the nine confirmed audit findings and two newly discovered security defects. The remaining work below is mostly **verification still to complete**, not a list of demonstrated failures. Overall production readiness remains **UNVERIFIED**. The original **14/100 readiness and 23% coverage are historical**; this focused pass did not rescore the original 430-feature inventory, so there is no new global score.

Use the isolated environment in [stabilization.md](stabilization.md). Continue on `main`; use local capture or authorized provider sandboxes for the workflows below.

## Already fixed locally

| Confirmed findings | Completed correction |
| --- | --- |
| `API-ANALYTICS-001`, `API-ANALYTICS-002` | Recorded monetary sales, historical line revenue/cost, correct metric ranking before the top-ten limit |
| `PERF-SIGNUP-001`, `A11Y-SIGNUP-001` | Stable signup loading area and an associated localized language label |
| `VIS-LOCAL-EMAIL-001`, `RESP-ANALYTICS-001`, `VIS-DASHBOARD-001` | Email toolbar, tablet report filters, and KPI label/badge containment |
| `VIS-LOCAL-BILLING-001`, `VIS-HELP-RU-001` | Capacity wording and locale-aware help count forms |
| New: `SEC-STORE-001` | Fresh store-grant authorization for restricted managers updating store metadata |
| New: `SEC-SESSION-001` | Authoritative security claims on session update and server cookie revalidation |

The session finding concerns signed-session/client/middleware claims and verification integrity. Existing server ownership revalidation prevented the tested backend escalation; no backend administrator takeover was demonstrated. Previously issued raw sessions were not globally invalidated, so their lifecycle remains part of the next auth work.

Basic customer and supplier browser journeys each passed **10 checks**. The final supplier result includes real create/edit surviving reload, canceled deletion without a write, and permanent deletion of the unused synthetic supplier; an earlier review predating that journey is superseded. Failed-save cases use explicit browser response fixtures. These results do not establish every role, bulk action, import, or related-record workflow. Customer long-name selector containment and recoverable signup-mode lookup errors were also corrected.

Historical local evidence: `artifacts/bazaar-stabilization/20260905/reassessment.json`, `evidence/customer-browser.json`, and `evidence/supplier-browser.json`; the original audit is under `artifacts/bazaar-assessment/20260905T114424Z/`. These local artifacts are evidence descriptors, not required dependencies of this guide in a remote checkout.

## Prioritized backlog

Priority indicates execution order, not a newly assigned defect severity. Complete release checks for the current fixes alongside the next development task; do not wait for Stripe or ORDO.

### 1. Complete authentication and access revocation — immediate

Add local email capture and exercise real signup, verification, login, logout, recovery, and session transitions with synthetic users. Extend the existing unit/router checks through HTTP and browser boundaries.

**Acceptance:** registration persists once; verification and recovery links are captured locally with no external delivery; valid, expired, reused, malformed, and wrong-user tokens have the documented outcomes. Invalid/retried requests do not duplicate accounts or lose form values. Logout, reset, account disablement, role changes, and store-grant revocation have an explicit session policy verified against already-open sessions as well as fresh login. Client-supplied ownership, role, tenant, and verification flags cannot expand access. ADMIN, MANAGER, STAFF, and CASHIER each receive their intended route and API behavior across two organizations and assigned/unassigned stores. Revoked protected requests fail without writing data; hidden controls alone are insufficient evidence. Keep captured tokens and synthetic credentials out of tracked reports.

### 2. Finish management UI persistence and bulk coverage

Extend proven customer/supplier basics to supported bulk operations and the product/store metadata browser paths. Reuse narrow routers and the existing fixtures; do not repeat settled basic tests merely to increase totals.

**Acceptance:** product create/edit/archive/restore survive reload and reopening; duplicate metadata produces the documented distinct identity where the caller can be isolated safely. Store metadata changes persist. Search, sort, pagination, selection across pages, canceled confirmation, double submission, partial failure, retry, and downloaded exports have deterministic outcomes. Mixed-tenant/store IDs cannot read or mutate other records, including within bulk input; test each operation's declared atomicity. Check long RU/KG names, keyboard focus, mobile sheets, and action recovery after closing dialogs. Run import/duplication only after proving the in-scope caller can avoid stock initialization; otherwise use a labeled boundary adapter and retain `BLOCKED_BY_SCOPE` for the end-to-end path.

### 3. Certify the current report metrics and consumers

Reconcile the modern reporting endpoints and displayed/exported values separately from the two corrected older APIs. Review consumers of the changed older contracts before release; movement counts no longer appear as invented monetary revenue.

**Acceptance:** publish one versioned definition per metric covering source, organization/store scope, completion date, timezone, currency, discounts, returns, cost provenance, missing data, and freshness. Use allowed synthetic reporting projections and deterministic expected totals to verify filters, cache isolation, chart/table/export agreement, and ties/ranking. Reconcile only equivalent definitions: older gross completed-order/line metrics and a net sales view need an explicit bridge for their differences. Historical missing cost must remain unknown, not current catalog cost or zero. Record unsupported producers and excluded dependencies; no receipt or stock operation is needed to certify the reporting read contract. The exact existing change is documented in [stabilization.md](stabilization.md#changed-analytics-reporting-contract).

### 4. Verify provider jobs, failure recovery, and retries

Start with local provider adapters, then use an explicitly authorized sandbox for one in-scope integration at a time. The current stripped-credential environment has not established real provider delivery or completion.

**Acceptance:** timeout, throttling, authentication failure, invalid response, duplicate/out-of-order callback, worker restart, and uncertain provider success produce a durable, observable state. Retry/reconciliation must not duplicate a delivery, export, or provider object; permanent failures remain visible and recoverable. Validate tenant-bound callbacks, secret redaction, bounded retries, and cancellation where supported. State exactly which scenarios used mocks versus the provider sandbox. No live campaign, marketplace write, or excluded operation is part of acceptance.

### 5. Resolve Stripe prerequisites, then implement the approved new-business cohort

First establish the actual legal seller, account country/readiness, authorized sandbox, currencies/payment methods, and approved pricing. Recheck current official documentation against that account. The owner must approve a rollout cutoff and treatment of ambiguous businesses; the audit date is not an automatic cutoff.

**Acceptance before implementation:** approve a server-controlled, durable `LEGACY_FREE` versus new paid-business classification and a protected entitlement snapshot. Existing businesses retain their current plans, limits, features, and access for free; they receive no payment-method prompt, subscription, trial, invoice, or charge. New staff, stores, devices, and logins do not reclassify a business. Missing/ambiguous records prevent automatic charging while preserving existing access.

**Acceptance before activation:** prove exact before/after legacy entitlements through provider outage, webhook replay, and rollback. In the authorized sandbox, verify owner-only organization-bound Checkout/Portal, server-selected prices, duplicate requests, signed duplicate/out-of-order webhooks, reconciliation, abandoned Checkout, failed payment/authentication required, renewal, cancellation, and upgrade/downgrade policy. A browser redirect never grants paid access. Legacy entitlements remain independent of Stripe. No operational restrictions inside POS or Inventory are introduced.

### 6. Build the ORDO read-only MVP after metric certification

Start with an internal dashboard, deterministic period comparisons, and an assistant explaining certified metrics. Operational records remain authoritative; derived projections and simulations are separate and are not a second editable business database.

**Acceptance:** every factual answer identifies tenant/store scope, period, currency, metric version, source evidence, and freshness; missing/stale data causes an explicit limitation. Authorization is enforced before retrieval and again for each tool call. Imported text cannot override instructions or cause cross-tenant access. Test answers against fixed expected calculations and adversarial documents. No arbitrary SQL, unrestricted mutation tools, or operational writes are exposed. Forecasts, anomaly detection, and what-if results need their own data-quality gates, baseline evaluation, and uncertainty; an approval centre and external connectors remain later work.

### 7. Run release smoke checks and targeted performance verification

Before release, rerun the focused regressions and inspect the actual commit/build. After a separately authorized deployment, observe the deployed application using read-only accounts and in-scope pages.

**Acceptance:** record the deployed SHA, environment, roles, and exact routes tested; login/session, visible management lists, corrected layouts, and report reads work without unexpected errors or unauthorized data. Include 390/414/768/1440 widths, supported locale samples, and light/dark states. Measure usable content markers on a production build, separating cold and warm observations; collect at least five warmed samples for important routes and check signup CLS against 0.1. Development timings and a small laboratory sample do not establish field Core Web Vitals. Do not create production records, send email, change billing, or load-test production during smoke checks.

## Scope and completion rules

Sales-order transitions, purchase receipts, stock-coupled product paths, and real public checkout remain `BLOCKED_BY_SCOPE` wherever completion would execute excluded operations. Test only their in-scope caller through explicit adapters; do not convert a mock pass into an end-to-end pass.

**POS: EXCLUDED_BY_OWNER, NOT ASSESSED.**

**Inventory: EXCLUDED_BY_OWNER, NOT ASSESSED.**

Close each task with the executed scenario, persisted/read evidence, role and environment, expected failures, and remaining limits. Recalculate global readiness only after rerunning the corresponding original criteria; completed fixes alone do not fill untested denominators.
