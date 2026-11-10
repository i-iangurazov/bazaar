# Transactional email reliability

## Shared email presentation

New account verification, password reset, organization invitation, loyalty-code,
subscription-payment and subscription-reminder messages use
`src/server/services/emailTemplate.ts`. It follows the account-verification design:
a fluid bordered card, Bazaar logo, shared typography and blue action buttons.
HTML uses inline styles and presentation tables; a plain-text alternative remains
part of every message. Russian, Kyrgyz and English account/billing content remains
localized. Customer-order content retains its existing languages and store identity.

The design is applied when content is generated, never in the delivery transport.
Stored subscription outbox HTML, text, sender and operation keys are sent verbatim
on retry. This matters because a provider idempotency key cannot safely be reused
with a different request body merely to change its appearance.

Customer-order delivery logs have an optional `templateVersion`. New queued
deliveries explicitly select `branded-v1`; existing null values retain the original
renderer for retries. The additive migration only adds a nullable column and does
not rewrite orders, stock, subscriptions or historical delivery logs. Direct sends
retain the version of their previous delivery log. Do not remove the legacy renderer
while older delivery operations remain recoverable.

An older direct send can have reached the provider before its local log was saved.
Only the provider's typed `409 invalid_idempotent_request` permits recovery with
the original renderer and the same key; concurrent requests and other failures do
not trigger that compatibility path. No replacement key is generated. The provider
must return an accepted message ID before the local delivery is marked sent.
This follows the provider's distinct [idempotency error contracts](https://resend.com/docs/api-reference/errors).
When rolling back unrelated UI work, retain these renderer-version compatibility
paths while deliveries from the newer version remain recoverable.

Campaigns and automations reuse their existing `contentVersion`: new content uses
version 2 and the shared presentation shell, while persisted version 1 keeps its
original rendering. Merchant blocks, logos, colors, product links and unsubscribe
links remain part of the merchant's message. A design upgrade must not silently
change the body of an already-started campaign batch.

The preview and regression fixtures contain synthetic data only. They do not send
mail or contact payment providers. Browser previews verify HTML presentation,
not every mail client's rendering or inbox delivery. Actual provider acceptance
and delivery remain separate lifecycle states.

Single Resend sends now have a 15-second total budget, a 5-second deadline per attempt (including response body reading), and at most three attempts. Rate limits, server failures and network interruptions can retry; permanent HTTP failures and malformed successful responses cannot. The same serialized payload and idempotency key are used throughout one call. A successful result requires a nonempty provider message ID. It confirms provider acceptance, not inbox delivery.

Caller-supplied idempotency keys are preserved. Calls without a key generate a random key once for their internal retries. That fallback does not deduplicate a later independent invocation. Resend retains keys for 24 hours and requires the same request payload for reuse; callers that retry durable operations must preserve their operation identity and payload within that window. [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys), [send-email API](https://resend.com/docs/api-reference/emails/send-email).

Numeric and HTTP-date `Retry-After` values are honored. If the requested delay cannot fit within the remaining budget, the typed failure is returned without retrying early. A final timeout or lost response does not prove the email was unsent. Provider reconciliation is still required for uncertain durable sends; the transport does not promise exactly-once delivery.

`EmailProviderError.message` contains only a safe status marker. `status` and `retryAfterMs` remain public metadata; `providerMessage` and `responseText` remain directly readable for existing classifiers but are non-enumerable so ordinary JSON/error logging does not emit echoed recipients or token-bearing links. Callers must not explicitly log those raw fields. Batch and domain/retrieval HTTP behavior was not changed by this transport work, apart from this shared error serialization policy.

Password-reset requests preserve their uniform public response for unknown accounts and delivery failures. A failed send logs only the error name and user ID. A later request can generate a usable reset link; successfully resetting invalidates sibling links and revokes earlier sessions. Verification resend reports the safe `emailDeliveryFailed` error, so the user can retry without altering the unverified account or exposing a verification link in the error.

## Safe checks

```sh
pnpm ops:email-check
pnpm exec vitest run --config vitest.stabilization.config.ts tests/stabilization/transactional-email-recovery.test.ts
```

The first command is now offline-only. It executes the focused transport tests with synthetic payloads and mocked fetch calls. It does not import Prisma, create businesses, change passwords or send email. It rejects options such as `--send` and makes no delivery claim. The previous script performed account/database mutations in the configured environment and reported delivery success even for the log provider; that unsafe diagnostic behavior was replaced, not executed against a real service.

The second command requires the existing verified disposable PostgreSQL/Redis environment from `pnpm test:stabilization:up`. It uses only narrow auth routers, unique owned fixtures and mocked email delivery; it performs no reset or migration itself.

The transport baseline had 1 passing and 11 failing assertions. The final transport suite has 14 passing cases, including two additional network/exhaustion regressions. Both auth recovery cases fail against a saved pre-fix router and pass against the corrected source. Evidence is private under `artifacts/bazaar-reliability/20260905/` and can contain synthetic tokens. No actual recipient or production secret was used.

## Provider verification still required

No authorized real recipient was supplied for this pass. Sender/domain configuration, SPF/DKIM/DMARC state, provider acceptance in the real account, delivery callbacks, inbox/spam arrival and link usability from a real mailbox remain unverified. Once an intended recipient is authorized, validate these separately with a purpose-specific test account, inspect the corresponding provider message ID/status, and record acceptance and inbox arrival as distinct outcomes. Never infer delivered status from log-mode output, a successful mock, or an HTTP acceptance response alone.
