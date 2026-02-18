# Production Readiness Runbook

This checklist is the minimum release gate for a customer-facing deployment.

## 1) Environment and startup checks

Required for production:

- `NODE_ENV=production`
- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `REDIS_URL`
- `JOBS_SECRET`
- `EMAIL_PROVIDER` (`resend`)
- `EMAIL_FROM`
- `RESEND_API_KEY`
- `ALLOW_LOG_EMAIL_IN_PRODUCTION` (`0` in normal production; temporary `1` only before external email provider is live)
- If `IMAGE_STORAGE_PROVIDER=r2`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL` (and optional `R2_ENDPOINT`)

Run preflight:

```bash
NODE_ENV=production pnpm ops:preflight
```

Expected result:

- Database connectivity check passed
- Startup configuration checks passed
- Redis ping check passed
- Exit code `0`

## 2) Email flow verification

Run delivery flow verification (signup verify/reset/invite):

```bash
pnpm ops:email-check
```

Expected result:

- Email verification flow passed
- Password reset email delivery passed
- Verification resend delivery passed
- Invite email delivery passed
- Exit code `0`

Notes:

- In local or CI with `EMAIL_PROVIDER=log`, this checks flow orchestration and token lifecycle.
- In production with `EMAIL_PROVIDER=resend`, this confirms external delivery calls are configured.
- Temporary rollout mode is supported with `EMAIL_PROVIDER=log` + `ALLOW_LOG_EMAIL_IN_PRODUCTION=1`, but this should only be used for controlled pilot environments.

## 3) Core quality gates

Run before each release:

```bash
pnpm lint
pnpm typecheck
pnpm i18n:check
CI=1 DATABASE_TEST_URL="postgresql://inventory:inventory@localhost:5432/inventory_test?schema=public" pnpm test:ci
pnpm build
```

## 4) Database safety

Deploy migrations:

```bash
pnpm prisma:migrate
```

Operational requirements:

- Automated backup policy configured
- Restore rehearsal validated on staging
- Migration rollback procedure documented

## 5) Runtime monitoring

Confirm endpoints and signals:

- `GET /api/health` (internal mode with `x-health-secret`)
- `GET /api/preflight` (must return `200` before deployment switch)
- `GET /api/metrics` (with `x-metrics-secret`)
- Dead-letter queue monitored (`/admin/jobs`)

Alert rules should cover:

- Redis down/degraded
- Database down
- Failed jobs increasing
- Elevated auth/rate-limit failures

## 6) Release acceptance

Release is accepted only when:

- Preflight and email checks pass
- All quality gates pass
- Health endpoint reports `status=ok`
- Preflight endpoint reports `status=ready` with HTTP `200`
- Manual smoke flow passes:
  - signup/invite/verify
  - register business
  - login and core inventory flow

## 7) CI gate

GitHub Actions `release-gate` job validates production-like startup constraints:

- `NODE_ENV=production`
- Postgres + Redis services up
- `pnpm ops:preflight` passes
- `pnpm build` passes

## 8) Vercel Connectivity Checklist

For Vercel runtime incidents (`ETIMEDOUT`, `Command timed out`, random 500 on all API routes), verify in this order:

1. Database URL
- `DATABASE_URL` must be reachable from Vercel (public host or VPC/private link via supported setup).
- Do not use localhost/private LAN hostnames.
- Ensure SSL is enabled on provider side (typical managed Postgres requirement).

2. Redis URL
- `REDIS_URL` must use `redis://` or `rediss://` (REST endpoint is invalid for ioredis here).
- Provider must allow connections from Vercel regions used by the project.

2.1 Product image payload size (Vercel)
- Keep client upload target below serverless body limits; set `NEXT_PUBLIC_PRODUCT_IMAGE_MAX_BYTES=4000000` for Vercel deployments.
- Align `PRODUCT_IMAGE_MAX_BYTES` with your operational limit (same or slightly higher than client target).

3. Runtime preflight
- Call `GET /api/preflight` with `x-health-secret`.
- Expect `status=ready`, checks all `ok`, HTTP `200`.
- If `503`, read `errors[]` and fix env/connectivity before retry.

4. Health endpoint
- Call `GET /api/health` with `x-health-secret`.
- Expect `status=ok`, `db=up`, `redis=up`.

5. Email provider
- For production, set `EMAIL_PROVIDER=resend`, valid `EMAIL_FROM`, and `RESEND_API_KEY`.
- Validate flow with `pnpm ops:email-check` on the same env values.
