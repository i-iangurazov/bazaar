# Stripe preparation — inactive

This phase adds a pure versioned policy/snapshot module and deterministic fixtures. **It is not a Stripe integration and cannot activate payments.** No application page, production entitlement resolver, provider handler or database migration imports it. Existing businesses receive no enrollment, payment-method requirement, invoice or charge from this preparation.

The owner's proposed account country is the UK (`GB`). The legal seller is not confirmed; no approved Stripe account, authorized sandbox, approved pricing or cohort cutoff has been supplied. `prospectiveUkStripePreparation` records those facts explicitly. It does not use the audit date, signup date, an environment flag or an example price as approval. Even a preflight input claiming every prerequisite is ready still returns `INACTIVE_PREPARATION` and forbids payment objects.

The UK appears in Stripe's supported-country list. That list does not establish that this prospective seller/account is eligible or approved; complete the actual seller/account checks before activation. Country availability was checked on 5 September 2026. [Stripe global availability](https://stripe.com/global).

## Implemented policy contract

`src/server/billing/stripePreparation.ts` can capture an explicitly identified existing business's supplied plan, limits, feature grants and access values in a `LEGACY_FREE` snapshot with schema version 1. It clones and freezes nested JSON values, preserves explicit unlimited values as `null`, and rejects values that JSON storage would silently lose. The caller must provide the authoritative entitlement state; no database snapshot or backfill is performed here.

Resolution uses a matching versioned snapshot independently of later catalog changes or Stripe observations. Provider failures, cancellation observations, duplicate events and old events cannot impose payment requirements or remove the saved grants. Added staff, stores, devices and logins do not establish a new business cohort. A missing, malformed, foreign-business or unsupported-version snapshot preserves the supplied current entitlement state, blocks payments and requests cohort review. It does not borrow another business's grants.

These contracts are tested as pure functions. They do not yet protect production through durable cohort records, signed-webhook processing or a wired entitlement resolver. The existing application billing/trial behavior is untouched.

Run the seven policy tests with:

```sh
pnpm exec vitest run --config vitest.stabilization-unit.config.ts tests/unit/stripe-preparation.test.ts
```

## Remaining work before integration and activation

1. Confirm the actual legal seller, account country, business model, account approval and applicable currency/payment/tax requirements. The prospective UK plan is not an eligibility determination. Obtain an explicitly authorized sandbox; none was provisioned in this phase. Stripe sandboxes isolate test activity from live payments. [Stripe sandboxes](https://docs.stripe.com/sandboxes).
2. Approve the paid new-business policy, server-selected prices and an explicit cohort cutoff. Capture every existing business's complete authoritative entitlements and permanently classify it free. Review missing/ambiguous historical records without charging them. Staff/store/device creation cannot create a paid cohort.
3. Design and review additive database storage for durable cohort assignment, immutable entitlement snapshots, organization-bound provider customer/subscription IDs, idempotent operations, webhook event deduplication and reconciliation state. Verify exact entitlement equality before/after migration and rollback. No such billing migration is included here.
4. Implement owner-authorized, organization-bound Checkout and Portal endpoints with server-selected prices and validated return URLs. Existing free businesses must never receive provider objects or payment prompts. Use durable application idempotency alongside Stripe request idempotency. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions), [Customer Portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal).
5. Implement raw-body signature verification, durable event deduplication, tenant/customer mapping and reconciliation. Stripe does not guarantee event delivery order; a browser redirect or event timestamp alone cannot grant access. Prove replay, out-of-order events, crashes and uncertain provider outcomes preserve existing free entitlements. [Stripe webhooks](https://docs.stripe.com/webhooks).
6. In the authorized sandbox, verify abandoned Checkout, authentication required, failed payment, renewal, cancellation, changes of plan, retries and provider outages. Review the recorded result and rollout/rollback controls before separate activation approval. No live subscription lifecycle has been tested.

Do not wire this preparation into production or describe it as complete billing. All Stripe account operations, provider objects, payment UI, billing migrations, durable cohort assignments and runtime activation remain outstanding.
