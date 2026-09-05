# Email callback and reconciliation reliability

The September 2026 reliability pass verifies local persistence with synthetic campaign/customer records, real disposable PostgreSQL transactions, and a fully mocked email provider module. It does not send campaigns or email, call Resend, or certify production delivery.

## Callback contract

The webhook route verifies the signature against the raw request body before processing. Recipient correlation uses the unique provider/message identity. Supplied campaign/store tags must match the stored campaign, and recipient/campaign organization ownership must agree. Reusing one provider event ID for another recipient, message, event type, or occurrence time is rejected as an identity conflict; an exact duplicate has no additional delivery effect.

Callbacks lock the campaign before the recipient. Recipient changes, immutable event insertion, suppression and campaign counters share one transaction. A failed commit rolls them all back, allowing the provider to replay the same event safely. Campaign completion time remains the first recorded completion instead of moving on every later engagement callback.

A signed callback with matching tags for a known campaign can arrive while its recipient is still `SENDING` and the send response's message identity has not been persisted. That case returns `503` with `Retry-After: 5`; replay can correlate after persistence. Unknown messages without a matching campaign/pending identity are acknowledged and ignored, including unrelated transactional email callbacks.

Resend documents retries when webhook processing does not return HTTP 200 and supports manual replay. It also distinguishes delivery to a recipient mail server from a complaint. The implementation retains those distinctions. [Retries and replays](https://resend.com/docs/webhooks/retries-and-replays), [event types](https://resend.com/docs/webhooks/event-types).

## Reconciliation contract

Provider lookups run outside database transactions. Before persisting a result, the service checks the scanned recipient's timestamp, lifecycle state, message identity, attempt count, latest event identity and lease token. If a callback, sender or another reconciler changed the record, that stale result is discarded. Status, retry metadata and campaign counters commit together. Database errors propagate as database errors; they are not caught and reclassified as provider failures.

The returned provider message ID must match the requested ID. Unknown events, identity mismatches and transient lookup failures retain the unresolved status with an explicit reason and retry time. Retry delays start at five minutes, double up to six hours and honor a larger provider `Retry-After`. Every unresolved lookup consumes an attempt, including repeated `sent`/accepted results and duplicate lookup event identities. The existing thirty-minute staleness gate still applies, so these delays are lower bounds rather than exact scheduling promises. Concurrent lookups can both make their mocked/read-only request, but only one can commit an attempt for the same scanned version.

Eight attempts or seventy-two hours since acceptance/operation start stop unresolved lookups. The row becomes `FAILED` with an explicit local reason and `lastProviderEvent = reconciliation.failed`. This means delivery is unknown after local reconciliation stopped; it does not assert that the provider reported failure. A later authoritative terminal callback may correct this local state. It cannot automatically queue another send. Actual provider terminal failures remain protected against contradictory delivery events. A complaint after observed delivery remains authoritative even when an open/click with a later timestamp was processed first.

Resend's retrieval response includes `id` and `last_event`, but no occurrence timestamp for that last event. Accordingly, polling time is an observation timestamp: it is retained in the reconciliation event row and `reconcileAt`, and it does not replace `lastProviderEventAt` used for webhook ordering. Delivery/terminal timestamps first learned by polling remain observation times; a `reconcile:` event identity and reason identify that provenance. [Retrieve sent email](https://resend.com/docs/api-reference/emails/retrieve-email).

Expired send leases without a persisted message identity retain the existing conservative rule: recover the same durable operation only within its twenty-three-hour window; afterward record unknown failure instead of creating an automatic replay. The recovery update now checks the scanned version and commits its campaign summary atomically.

## Evidence and limits

`tests/stabilization/email-delivery-reliability.test.ts` creates and removes only its own UUID-scoped organizations, users, stores, customers, campaign recipients, callback events and suppression records. The entire provider module is mocked; the shared stabilization setup rejects unexpected network fetches. No reset, seed, migration, scheduler, campaign sender, POS or inventory workflow is run.

The initial nine-case evidence contains seven application behavior failures, one existing passing protection, and one test instrumentation failure caused by spying on a Prisma delegate. That spy was replaced with a scoped middleware barrier. The final expanded suite also covers transaction rollback/retry, early callback replay, inconsistent tenant ownership, rate limits and concurrent reconcilers. Results are recorded under `artifacts/bazaar-reliability/20260905/email-delivery-*.json`.

Remaining limits: live signature/configuration delivery and provider retry timing require a real sandbox; missing callbacks and an unpersisted provider message identity can still exhaust the conservative recovery window; no new durable inbox for unmatched events was added. Existing historical local failures are not backfilled into the new explicit local-failure marker. Existing lookup-created timestamps are not rewritten. These checks certify the tested local state transitions, not end-to-end email arrival or inbox placement.
