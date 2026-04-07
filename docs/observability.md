# Observability

See also:
- [Deployment Rollout Checklist](/Users/ilias_iangurazov/Commercial/bazaar/docs/deployment-rollout-checklist.md)

## Deep Profiling

Use deep profiling only in development or a controlled one-off environment.

```bash
LOG_LEVEL=error BAZAAR_PROFILE=1 node --import tsx scripts/profile-hot-paths.ts
```

What it does:
- runs the current hot read paths against the configured database
- records tRPC timings, section timings, and Prisma query fingerprints
- prints a small network-audit summary for `/dashboard`, `/products`, and `/inventory`

Current hot paths:
- `dashboard.bootstrap`
- `dashboard.activity`
- `products.bootstrap`
- `products.list`
- `inventory.list`
- `search.global`
- `products.previewImportCsv`

## Reading The Output

Start with:
- `Measured hot procedure timings`
- `Top profiled sections`
- `Top Prisma query fingerprints`

Interpretation:
- If warm runs are fast but user-facing latency is still high, the remaining issue is likely infrastructure or cold starts rather than app code.
- If `queryGroups` dominates `search.global`, check whether the workload is exact-match heavy or fuzzy text heavy.
- If `dashboard.summary:secondaryReads` grows, recent activity or related secondary reads are likely the first place to inspect.
- If `products.bootstrap:bootstrapReads` grows, store/category bootstrap data or connection setup is the likely source.

## Production Logs

Production now emits lightweight slow-path logs without enabling full profiling:
- `slow hot path timing`
- `slow section timing`

Covered top-level procedures:
- `dashboard.bootstrap`
- `dashboard.activity`
- `products.bootstrap`
- `search.global`

Default threshold:
- `HOT_PATH_LOG_THRESHOLD_MS=250`

Raise or lower it with:

```bash
HOT_PATH_LOG_THRESHOLD_MS=400
```

## Latency Spike Checklist

1. Check whether spikes affect cold starts only or also warmed requests.
2. Look for `slow hot path timing` by `path`.
3. Look for `slow section timing` inside:
   - `dashboard.bootstrap`
   - `dashboard.activity`
   - `dashboard.summary`
   - `products.bootstrap`
   - `search.global`
4. Compare app timings with database and Redis latency in your platform metrics.
5. Verify region colocation:
   - app runtime
   - Postgres
   - Redis
6. Confirm connection pooling is healthy on the database side.
7. If warm app timings stay low but end-user latency is high, treat it as an infra boundary issue first:
   - serverless cold starts
   - region mismatch
   - overloaded DB pooler
   - Redis reachability / TLS / DNS latency

## Build-Time Redis Behavior

During `next build`, Redis is intentionally bypassed.

Reason:
- build/static generation should not try to open Redis sockets
- Redis-backed caches fall back to direct reads during build
- this prevents non-fatal `Redis connection error` noise from the build process

Runtime production behavior is unchanged:
- Redis is still required by startup checks
- runtime health/preflight still validates Redis connectivity
