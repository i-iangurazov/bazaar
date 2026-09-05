# Transactional email reliability

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
