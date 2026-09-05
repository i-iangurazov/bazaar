# Authentication lifecycle and rollout

The continuation tests use the dedicated disposable PostgreSQL database and real narrow authentication/user routers. Email delivery is captured by a test adapter; no real provider delivery is implied. Run the authentication subset with:

```sh
pnpm test:stabilization:up
pnpm exec vitest run --config vitest.stabilization.config.ts tests/stabilization/auth-lifecycle.test.ts
pnpm exec vitest run --config vitest.stabilization-unit.config.ts tests/unit/auth-session-claims.test.ts
```

The first command verifies the dedicated container/database identity before applying migrations. Do not substitute the developer or production database. The final local run passed 26 lifecycle cases and seven isolated claim-provenance cases. Ignored evidence lives under `artifacts/bazaar-continuation/20260905/`; it includes synthetic credentials/token material and must remain private.

## Token and recovery contract

- Verification, reset and registration tokens bind both their user ID and current email address. Missing identities, changed addresses and wrong token purposes are rejected. Disabled users cannot consume tokens.
- Consumption and the resulting account/audit changes share a transaction. Invalid registration input or an audit-write failure leaves the token available for a corrected retry.
- Each token has one successful consumer. Account row locking also serializes different reset or registration tokens belonging to the same account. Password reset invalidates the account's other pending reset links.
- Existing-account invitation acceptance requires that account's password. The invite is claimed atomically; a failed password check rolls the claim back. Expired, malformed, reused, disabled-account and cross-organization invitations are rejected.
- Signup can resume an incomplete account only with its existing password. It does not replace credentials or profile details. Password recovery remains a separate flow.
- Verification is required for credentials login and server session access when `isEmailVerificationRequired()` is true. The existing explicit nonproduction bypass is retained. Administrator-created users are explicitly marked verified by the existing user-creation contract.
- An email delivery failure after successful business registration or invite acceptance does not undo the account. Public verification resend is available for active unverified accounts. Password reset requests use the same public response for unknown and disabled accounts.
- Password hashes are omitted from verification/reset audit payloads. Verification-delivery failure logs contain error names, not the exception's raw verification link.

## Session revocation

`User.sessionVersion` is captured in a signed JWT only at authenticated login. Every normal JWT read/update and server cookie revalidation compares it with the current database value. Client-supplied versions and security flags cannot refresh an invalid session. Locale/theme changes remain allowed for valid sessions; the version is not exposed in the client session response.

Public password reset, administrator password reset and account disablement increment the version atomically. A subsequent reactivation cannot revive earlier sessions. Server role/organization claims continue to come from current database state, and store grants remain checked by the relevant procedures.

Normal logout clears the NextAuth browser cookie. Per-token server invalidation on logout is not implemented by this change; global revocation is established for password reset and disablement.

## Deployment requirements and limits

Apply the additive `20260905140000_user_session_version` migration before starting application code that reads the new column. It adds an integer with default zero and does not backfill email verification or modify business billing.

Existing JWTs lack the new version and fail closed. **All existing users must log in once again after rollout. Existing unverified accounts must verify their email before access when verification is required.** Do not silently attach a current version to an old token or mark accounts verified during migration.

The migration first passed disposable-database verification, then applied successfully inside the authorized Vercel production build on 5 September 2026 at 14:05 UTC. See [release notes](continuation-2026-09-05.md) and the ignored release evidence for deployment and live smoke outcomes. No real email provider call was made during verification. The router suite does not establish browser hydration behavior, production email delivery, rate-limit behavior or a complete application security audit. The separate browser work covers its explicitly recorded scenarios.
