# Signup + Billing Hardening (V1.6 -> V1.7)

## Current Behavior (Audit)
- `SIGNUP_MODE` controls public entry:
  - `invite_only`: `/signup` is request-access only.
  - `open`: `/signup` creates a pending account and sends verification email.
- Login is blocked until `User.emailVerifiedAt` is set.
- Invite acceptance creates user in inviter org but still requires email verification before login.
- Billing already exposes plan + usage; plan guards run in server mutations.

## Target Behavior

### Self-serve registration
- Open mode flow:
  1. `/signup` creates unverified account only.
  2. `/verify/[token]` marks email verified.
  3. If org has no store yet, user is routed to `/register-business/[token]`.
  4. `/register-business/[token]` sets org name + creates first store in one transaction.
  5. No placeholder organization is created before business registration.
- Invite flow in both modes:
  - Invite link creates account in inviter org.
  - User verifies email before app login.
- Invite-only mode:
  - Public signup is blocked by backend (`signupInviteOnly`).

### Subscription/limits activation
- Organization now includes:
  - `subscriptionStatus` (`ACTIVE | PAST_DUE | CANCELED`)
  - `currentPeriodEndsAt`
- Plan tiers:
  - `STARTER`: up to 1 store, 3 users, 1000 products
  - `BUSINESS`: up to 5 stores, 15 users, 50000 products
  - `ENTERPRISE`: up to 20 stores, 60 users, 200000 products
- Guard behavior:
  - mutation access requires active subscription/trial where enforced.
  - capacity guards for `stores`, `users`, `products` return specific error keys:
    - `planLimitStores`, `planLimitUsers`, `planLimitProducts`.
  - feature guards block unavailable modules with `planFeatureUnavailable` (imports/exports/analytics/compliance/support toolkit based on plan).

### Platform owner operations
- `/platform` provides owner-level controls:
  - organization list with usage counters
  - subscription/plan edit modal
  - summary cards (total organizations, active subscriptions, estimated MRR, active plan mix)

## Permissions Matrix
- Public:
  - `signupMode`, `requestAccess`, `signup`, `verifyEmail`, `registerBusiness`, `inviteDetails`, `acceptInvite`, `resendVerification`, `requestPasswordReset`, `resetPassword`.
- Authenticated org members:
  - `billing.get`.
- Admin only:
  - user/store/product creation under plan limits.
  - `billing.setPlanDev` (non-production only).

## Security Rules
- All protected reads/writes are scoped by `ctx.user.organizationId`.
- Email verification is mandatory for credentials login.
- `registerBusiness` requires one-time registration token and verified user.
- Public auth endpoints are rate-limited.
- Responses avoid direct account enumeration details.
- SSE stream requires authenticated users and filters events by organization.
- `/api/metrics` supports secret-gated access (`x-metrics-secret`) and falls back to ADMIN-only if no secret set.
- `/api/health` returns public liveness by default; detailed readiness requires `x-health-secret`.
- `/api/jobs/run` requires `x-job-secret` header (query-string secret disabled).
- Plan activity checks are enforced for `protected`, `manager`, and `admin` mutation procedures (billing mutations exempted).
- User snapshots written to audit logs are sanitized to avoid persisting `passwordHash`.

## Test Plan
- Integration:
  - open signup -> verify -> register business creates org/store/admin.
  - invite acceptance -> verify joins inviter org and routes to login.
  - cross-org access remains blocked for core entities.
- Plan limits:
  - users/stores creation rejects at limit with localized error keys.
  - billing summary returns subscription status + period dates + usage.

## Manual QA Checklist
1. `SIGNUP_MODE=open`
   - create account on `/signup`.
   - verify from `/verify/[token]`.
   - complete `/register-business/[token]`.
   - login succeeds and dashboard opens.
2. `SIGNUP_MODE=invite_only`
   - `/signup` stays in request-access mode.
   - create invite from `/settings/users`.
   - accept invite, verify email, login succeeds into inviter org.
3. Billing and limits
   - `/billing` shows plan, subscription status, trial/current period dates, usage counters.
   - exceeding user/store limits returns `planLimitUsers`/`planLimitStores` and blocks mutation.
4. Security probes
   - unauthenticated `GET /api/sse` returns `401`.
   - unauthenticated `GET /api/metrics` returns `401` when `METRICS_SECRET` is set.
   - unauthenticated `GET /api/health` returns only `{ status: "ok" }`.
   - `POST /api/jobs/run` without `x-job-secret` returns `401`.
