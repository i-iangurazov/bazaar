# Deployment Rollout Checklist

Use this checklist after the observability and performance changes in `dashboard.bootstrap`, `dashboard.activity`, `products.bootstrap`, `search.global`, and import preview.

The goal is to verify two things safely:
- the deploy preserved expected behavior
- any remaining latency is infrastructure-bound rather than app-code-bound

## Staging Verification Checklist

Run these checks against a staging environment with production-like region placement and real Postgres/Redis connectivity.

### 1. `dashboard.bootstrap`

- Open `/dashboard` with a store that has real inventory and purchase order data.
- Confirm the first load renders KPI cards, low-stock, and pending purchase orders without waiting for recent activity.
- Confirm the browser settles through one above-the-fold request path for dashboard bootstrap.
- Check logs:
  - no persistent `slow hot path timing` for `dashboard.bootstrap`
  - if present, inspect matching `slow section timing` entries for `dashboard.summary` or `dashboard.bootstrap`
- Pass criteria:
  - first content renders correctly
  - request succeeds on first load
  - no repeated dashboard bootstrap requests from a single page open

### 2. `dashboard.activity`

- Stay on `/dashboard` until recent activity loads.
- Confirm recent activity appears after the initial dashboard content, not as a blocker for first paint.
- Check logs:
  - `dashboard.activity` may arrive slightly later than bootstrap
  - if slow, inspect `dashboard.activity` section timing before changing application code
- Pass criteria:
  - recent activity resolves successfully
  - no UI error state
  - deferred activity load does not retrigger dashboard bootstrap

### 3. `products.bootstrap`

- Open `/products` in:
  - a single-store org
  - a multi-store org
- Confirm the first page of products, store selector state, and category/filter bootstrap data all load together.
- In the single-store case, verify there is no follow-up `products.list` fetch caused only by implicit store selection.
- Change sort/filter once and confirm behavior is unchanged from before the rollout.
- Check logs:
  - no persistent `slow hot path timing` for `products.bootstrap`
  - if slow, inspect `products.bootstrap:bootstrapReads`
- Pass criteria:
  - first load succeeds
  - no duplicate bootstrap/list chatter on initial page open
  - product results match the selected or resolved store

### 4. `search.global`

- Open the command palette.
- Test an exact barcode or SKU-like query first.
- Test a fuzzy text query with at least 3 characters.
- Confirm exact-match searches return the expected entity immediately and fuzzy results remain grouped and relevant.
- Check logs:
  - exact-match input should not produce broad slow grouped-search timing repeatedly
  - if slow, inspect `search.global:exactLookup` vs `search.global:queryGroups`
- Pass criteria:
  - exact matches rank first
  - fuzzy results remain useful
  - no obvious request storm while typing

### 5. Import Preview

- Open the import flow in `/settings/import`.
- Use a CSV that contains:
  - new rows
  - update rows
  - skipped rows
  - one validation error
  - one duplicate/conflict warning
- Confirm preview output clearly separates creates, updates, skipped rows, errors, and warnings.
- If deeper measurement is needed, run the one-off profiling script in the staging shell:

```bash
LOG_LEVEL=error BAZAAR_PROFILE=1 node --import tsx scripts/profile-hot-paths.ts
```

- Pass criteria:
  - preview completes without timeout
  - row-level feedback matches the sample file
  - no unexpected write occurs before confirmation

### 6. Redis-Dependent Paths

- Run `GET /api/health` with the health secret and confirm `redis=up`.
- Run `GET /api/preflight` and confirm startup checks report Redis ready.
- Perform a login smoke test and confirm auth does not fail with `redisUnavailable`.
- Trigger one job-backed flow and confirm it completes without Redis lock warnings.
- If realtime is used in staging, confirm there is no repeated `redis event bus degraded` log spam.
- Pass criteria:
  - Redis-dependent paths succeed without fallback behavior in production-like staging
  - no repeated Redis connection, lock, or event bus degradation warnings

## Production Rollout Checklist

### Environment Variables

Required:
- `NODE_ENV=production`
- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `REDIS_URL`
- `JOBS_SECRET`
- `EMAIL_PROVIDER`
- `EMAIL_FROM` when `EMAIL_PROVIDER=resend`
- `RESEND_API_KEY` when `EMAIL_PROVIDER=resend`

Recommended:
- `HOT_PATH_LOG_THRESHOLD_MS=250`
- `AUTH_TRUSTED_PROXY_HOPS=1` unless the deployment topology requires a different value

Before switching traffic:
- run `NODE_ENV=production pnpm ops:preflight`
- ensure build completes without Redis connection warnings
- ensure `/api/health` returns `db=up` and `redis=up`

### Log Expectations After Deploy

Expected:
- no `Redis connection error.` loop
- no `Using in-memory rate limiter; Redis unavailable.` in production runtime
- no `Redis rate limiter unavailable in production.`
- occasional slow-path entries are acceptable during cold starts

Watch specifically for:
- `slow hot path timing`
- `slow section timing`
- repeated Redis warnings
- repeated DB connection failures

### Smoke Tests After Deploy

Run in this order:
1. Open `/dashboard` and confirm above-the-fold content appears before recent activity.
2. Open `/products` and confirm the first load resolves correctly in the current store context.
3. Open command palette and run:
   - one exact barcode/SKU search
   - one fuzzy query
4. Run one import preview and confirm preview categories are correct.
5. Call `/api/health` and `/api/preflight`.
6. Run one login flow and one job-backed operational flow.

### Rollback Triggers

Rollback immediately if any of these occur after deploy:
- `dashboard.bootstrap`, `dashboard.activity`, `products.bootstrap`, or `search.global` shows sustained slow-path warnings on warm traffic, not just cold starts
- `/api/health` reports `redis=down` or `db=down`
- `/api/preflight` is not ready after envs and migrations are expected to be live
- login or job-backed flows fail with Redis-related runtime errors
- `/products` regresses back to duplicate initial fetch behavior
- import preview becomes materially slower or incorrect on representative files

## Runbook: Interpreting Slow Timing Logs

### `slow hot path timing`

Interpret this as the end-to-end timing for a top-level procedure.

Use it first to answer:
- which path is slow
- whether the slowdown is isolated or broad
- whether the issue is warm-runtime or cold-start dominated

First actions:
1. Compare the affected path against platform request duration and cold-start metrics.
2. Check whether the slowdown is specific to one store, org, or query shape.
3. If the same path is fast in warm profiling but slow in production, suspect infrastructure first.

### `slow section timing`

Interpret this as a deeper hint inside a hot path.

Use it to answer:
- which part of the procedure expanded
- whether the issue is DB reads, secondary reads, or search grouping

Useful examples:
- `dashboard.summary:secondaryReads`
- `dashboard.activity:activityReads`
- `products.bootstrap:bootstrapReads`
- `search.global:exactLookup`
- `search.global:queryGroups`

First actions:
1. If one section dominates, compare it with DB/Redis metrics before changing code.
2. If the same section spikes only on cold traffic, treat connection setup as a likely cause.
3. If section timing stays low while user latency is high, the issue is outside the measured application path.

## Infra Investigation Priority List

If staging or production latency remains high after this rollout, check these first:

1. Region colocation
- verify app runtime, Postgres, and Redis are in the same region or nearest supported region pair
- region mismatch is the fastest way to turn single-digit app timings into slow user requests

2. Database pooler and connection warm-up
- inspect connection establishment time, pool saturation, queueing, and TLS handshake cost
- compare cold-start requests with warm requests before changing app code

3. Redis reachability and serverless cold-start overhead
- verify Redis TLS/DNS/connect latency from the app runtime region
- check whether cold starts or suspended instances correlate with the slow hot-path warnings
