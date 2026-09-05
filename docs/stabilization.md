# Local stabilization verification

This guide reproduces the focused stabilization checks on `main`, using disposable local PostgreSQL and Redis. It covers selected application metadata, authorization, signup, and reporting behavior. It does not certify the whole application or production performance. Keep the original readiness audit as its historical baseline; record subsequent fixes and executed checks under `artifacts/bazaar-stabilization/`.

The prioritized remaining work and acceptance criteria are in [stabilization-next-steps.md](stabilization-next-steps.md).

## Prerequisites and resources

Run commands from the repository root on `main`. The verified local toolchain uses Node.js 22.18.0 and the repository's pinned pnpm 10.13.1. Install dependencies with `pnpm install --frozen-lockfile` if needed. Docker Desktop must be running, with Docker Compose available.

The runner uses `--pull never`. Make these images available locally before starting it; these explicit preparation commands need registry access:

```sh
docker pull postgres:16-alpine
docker pull redis:7-alpine
```

The image tags are version-family tags, not immutable digests. Record the local image IDs when comparing executions across machines.

| Resource | Dedicated identity | Storage or binding |
| --- | --- | --- |
| Compose project | `bazaar-stabilization` | [docker-compose.stabilization.yml](../docker-compose.stabilization.yml) |
| PostgreSQL | Database `bazaar_hardening_ci`, role `bazaar_test` | `127.0.0.1:55432`; data on container tmpfs |
| Redis | Database `0`, key prefix `bazaar-stabilization` | `127.0.0.1:56379`; tmpfs; persistence disabled |
| Development app | `http://localhost:3108` | Binds `127.0.0.1:3108`; Node heap limit 8 GiB |

Leave ports 55432, 56379, and 3108 available. The existing developer services on PostgreSQL 5432 and Redis 6379 are outside this workflow. Stopping or replacing the disposable containers can discard their data.

## Run the checks

```sh
git branch --show-current
pnpm test:stabilization:unit
pnpm test:stabilization
```

The first command should report `main`. The standalone unit command is useful for a quick check; the combined command runs those unit tests again, then starts and verifies the disposable services and runs the database suite. The `pretest:stabilization:unit` package hook generates the Prisma client before unit execution. No database is required for that unit-only configuration.

For a database-only rerun after reviewing a particular failure:

```sh
node --import tsx scripts/stabilization/run.ts test
```

Both `test` and `pnpm test:stabilization:up` perform the same guarded preparation before database tests or browser work:

1. Set the fixed database and Redis URLs, `RUN_DB_TESTS=1`, and `ALLOW_TEST_DB_RESET=0`.
2. Start the fixed Compose project with health checks and `--pull never`.
3. Inspect both containers for the expected project/purpose labels and reject volume or bind mounts.
4. Generate the Prisma client, then connect and verify `current_database()` and `current_user()` against the dedicated identity.
5. Apply existing migrations with `prisma migrate deploy` to that verified database.

These commands do not run a reset, schema push, default application seed, or migration against an inherited `DATABASE_URL`. Do not substitute the general `db:reset`, `prisma:reset`, or `prisma:seed` commands for this workflow. A failed guard stops execution; resolve the mismatch before continuing.

The [database configuration](../vitest.stabilization.config.ts) runs files sequentially and uses [setup guards](../tests/stabilization/setup.ts). The [unit configuration](../vitest.stabilization-unit.config.ts) has no database setup hooks. The default Vitest configuration excludes `tests/stabilization/**`, so the dedicated database suite must be requested explicitly. Avoid running multiple copies of the database suite concurrently against this one disposable project.

For static verification of implementation and harness changes:

```sh
pnpm typecheck
pnpm lint
```

Type checking includes the stabilization scripts, tests, and Vitest configurations. These commands are separate from the focused test runner; a test pass alone does not imply that they passed.

## Seed and open the isolated app

```sh
pnpm test:stabilization:up
pnpm test:stabilization:seed
pnpm dev:stabilization
```

Open `http://localhost:3108/login`. Read the generated synthetic role emails and password from `artifacts/bazaar-stabilization/browser-fixture.json`; use those credentials only with this disposable environment. The file also identifies the database, organization, and store IDs. No real user credentials are needed.

The shared [fixture helper](../tests/stabilization/fixtures.ts) creates two uniquely named organizations, two stores per organization, and ADMIN, MANAGER, STAFF, and CASHIER users in each organization. Users receive an explicit grant to their organization's first store and are not organization owners. The browser seed adds, in the first organization, a unit, supplier, customers, and thirty products with long synthetic names plus store-product assignments. These are metadata fixtures: no stock balances, stock movements, receipts, or provider transactions are created.

Each seed invocation creates fresh UUID-prefixed fixtures and replaces the browser credential file. Earlier synthetic fixtures remain in the disposable database until teardown. The file becomes stale after teardown; run `up` and `seed` again before using it with a new container.

The development launcher loads local configuration, applies the isolated overrides, updates Next.js's captured initial environment, and rechecks the environment and actual database identity after `app.prepare()` and before listening. This prevents Next's development environment reload from silently restoring the normal database URL.

## Provider and scope guards

[environment.ts](../scripts/stabilization/environment.ts) clears credentials/settings with the prefixes `RESEND_`, `OPENAI_`, `R2_`, `STRIPE_`, `SMTP_`, `BAKAI_`, `M_MARKET_`, and `O_MARKET_`, then selects local/log storage and email behavior and the configured market mock flag. The isolated test setup rejects every `fetch` call and makes the excluded inventory operation throw if reached.

The development server rejects server-side `fetch` destinations other than `localhost` or `127.0.0.1`, and rejects redirects. These application-level controls, combined with stripped provider credentials, are not a general network sandbox: they do not intercept every socket, HTTP library, subprocess, or browser request. Browser checks must stay within the approved local metadata and reporting workflows. Do not use live payment, email delivery, marketplace, POS, or inventory operations as part of this guide.

## What the focused tests establish

| Area | Executed boundary | Limits |
| --- | --- | --- |
| Signup | Component behavior, reserved loading space, language control accessibility | Unit fixtures; no external verification email or production signup certification |
| Session claims | Actual NextAuth callbacks and signed-token handling with synthetic database responses; security claims are refreshed from authoritative user data | Unit database adapter; not a full browser authentication matrix |
| Customers | Actual narrow router and real disposable Prisma persistence; create/update/archive, fresh-caller reads, scoped export rows, validation/conflict rollback, role and tenant/store denial | Archive is the application removal behavior; successful customer detail/order history and a downloaded CSV are not established by these tests |
| Suppliers | Actual narrow router create/update/list/delete, fresh-caller persistence, rollback, role and organization isolation | Supplier metadata only |
| Stores | Create/list/update metadata, duplicate-code rollback, role restrictions, organization isolation, fresh store-grant checks including revocation | No store-delete endpoint is claimed; no clone, stock initialization, or dedicated inventory workflow |
| Product metadata | Actual narrow router create/update/archive/restore and fresh reads, idempotency, validation/uniqueness rollback, organization/role boundaries | No store-scoped creation, stock, variants, image upload, import, or cost workflow; guarded inventory writes must remain absent |
| Reporting | Actual PostgreSQL aggregation over synthetic transaction-local reporting projections, plus narrow unit checks | No operational order creation, receipts, stock mutations, or historical ingestion certification |
| Environment | Fixed resource identity, rejected unsafe overrides, provider-setting sanitization | Local harness behavior, not deployment configuration certification |

The commerce suite imports the named customer, supplier, and store routers directly instead of the aggregate application router. It uses real authorization middleware and database grants. In particular, store metadata updates now apply the existing store-access policy on every request: a MANAGER with an unassigned or revoked store grant cannot update that store. Existing ADMIN/organization-owner access behavior is retained. See [store-access-model.md](store-access-model.md).

Fixture cleanup validates the unique `stabilization-` prefix and exact owned organization IDs before deleting only fixture-owned metadata and dependencies. It does not truncate tables or delete other organizations. Unexpected dependencies can make targeted cleanup fail; tearing down the verified disposable project is the final cleanup boundary. Browser fixtures deliberately remain available until teardown.

## Changed analytics reporting contract

The changes apply to `getSalesTrend` and `getTopProducts` in [analytics.ts](../src/server/services/analytics.ts), exposed by `analytics.salesTrend` and `analytics.topProducts`. The separate `salesAnalytics.ts` reporting endpoints used by the modern analytics page retain their existing computation. The page's responsive filter layout is a separate presentation fix.

Both changed functions require the organization and resolved store scope. The router resolves the caller's allowed stores; an empty allowed-store list returns an empty result. Records must have `status = COMPLETED` and `completedAt` between the current time minus `rangeDays × 24 hours` and the current time, inclusive. `createdAt` is not the reporting date. No `isPosSale` filter is added: these read-only aggregations include qualifying stored orders of either origin, without invoking or certifying POS workflows.

| Output | Contract |
| --- | --- |
| Sales trend | Sum recorded `CustomerOrder.totalKgs`, after recorded discounts and before returns, grouped by `date_trunc(day/week, completedAt)` and ordered by bucket. Return `{ series: [{ date, salesKgs }], usesFallback: false }`. Empty ranges stay empty; there is no movement-count substitute or invented zero-filled series. |
| Product units | Sum recorded order-line `qty` for each product. |
| Product revenue | Sum recorded `lineTotalKgs`; current catalog prices do not substitute for historical revenue. |
| Product profit | Sum `lineTotalKgs - COALESCE(lineCostTotalKgs, unitCostKgs × qty)` using historical line cost. Known zero cost remains valid and negative profit remains negative. Current product cost does not fill missing history. |
| Top-ten ranking | Sort the requested metric descending, nulls last, before `LIMIT 10`; use SKU and product ID ascending as deterministic tie breakers. |
| Profit availability | `canProfit` is true only for a nonempty result when every sold line across all products in the requested scope has historical cost, including products below the top ten. If any cost is missing, a profit request returns `{ items: [], canProfit: false }`; revenue and units remain available with `canProfit: false`. |

Top-product results retain `{ items: [{ sku, name, value }], canProfit }`. Product revenue and profit use recorded line amounts before returns or separately recorded order-wide adjustments; they can differ from order-total sales. This change does not allocate order-wide discounts across lines, process returns, backfill missing historical costs, or certify historical ingestion completeness. Date buckets follow the database timestamp semantics; the local projections verify UTC day/week examples, not configurable business-timezone behavior.

The cache namespaces advance to `analytics:sales:v2` and `analytics:top:v2` with a 180-second TTL, avoiding reuse of cached results computed under the prior contract.

The database reporting tests create `CustomerOrder`, `CustomerOrderLine`, and `Product` as TEMP reporting projections on one transaction connection, with `ON COMMIT DROP`. A query adapter directs the service's SQL to that connection. They establish monetary sums, completion-time and tenant/store filtering, metric-specific ranking, unknown-cost handling, and losses against PostgreSQL. They do not insert into the operational order tables or exercise their write paths. ORDO and live Stripe subscription implementation remain outside this stabilization work.

## Teardown and evidence

Stop `dev:stabilization` with Ctrl-C, then run:

```sh
pnpm test:stabilization:down
```

This stops/removes only the fixed `bazaar-stabilization` Compose project. Its tmpfs data is discarded; other developer services are not reset. The runner leaves services running after tests so failures can be investigated, so teardown is an explicit final step.

Keep executed logs, screenshots, browser fixtures, and before/after findings under `artifacts/bazaar-stabilization/`. Record whether a check used unit adapters, real disposable persistence, temporary reporting projections, or a browser. Development timings are observations only and provide no production speed acceptance credit. Report coverage and remaining limitations alongside any pass result; no fixed test totals are maintained in this guide.
