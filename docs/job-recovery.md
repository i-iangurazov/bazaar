# Shared job recovery

The shared runner and dead-letter service now serialize manual retries with normal runs. A dead-letter retry also owns a durable database claim. A skipped, unknown or failed result stays unresolved; only `status: "ok"` resolves it. Confirmed execution attempts are counted on both successful and failed retries.

Apply `20260905150000_dead_letter_retry_claim` before deploying this code. It adds nullable `DeadLetterJob.retryAttemptId` and `retryStartedAt`; existing rows remain unclaimed. It does not replay, resolve or delete existing failures.

## Lifecycle

1. A short transaction claims an unresolved, unclaimed row with a unique attempt ID and writes a start audit record. Tenant scope is part of the conditional update.
2. The runner acquires the same owner-checked Redis job lock as normal execution, then rechecks that the row still belongs to this attempt. Handlers and retry delays run outside a database transaction.
3. A short completion transaction requires the same attempt ID and an unresolved row. It records confirmed attempts, clears the claim, and resolves only explicit success. Skipped outcomes retain the failure and a readable reason. A locked or unknown job adds zero execution attempts.
4. A process interruption, unexpected runner exception, or failed completion commit leaves a durable claim. Claims have **no automatic expiry**. A timestamp cannot prove whether an external side effect occurred.

Manual resolution acquires the same Redis lock and fails while another runner owns it. It acknowledges the outcome without executing a handler. Completion cannot overwrite a different attempt owner or a concurrent completed resolution. The admin UI separately requires acknowledgement that the result was checked and active work completed or stopped.

## Reconciling uncertain work

Inspect the job's audit trail and the provider or destination's records using its stable business identity. Establish whether the intended effect happened, and complete or stop the old worker before acknowledging the outcome. An expired Redis lease alone is not proof that the worker stopped. If a worker is still active, do not resolve its claim even if it lost its lease.

When the outcome has been reconciled, an authorized administrator can mark the dead letter resolved. This clears the durable claim and records the acknowledgement. It does not enqueue a replacement. Any required new work must use that integration's reviewed recovery/idempotency procedure; do not clear database claim fields merely to make the Retry button available.

## Verification and limits

`tests/stabilization/job-recovery.test.ts` uses only registered synthetic handlers and actual disposable PostgreSQL/Redis services. Static email and order-job imports are mocked before loading the shared registry. No provider, scheduler, POS or Inventory handler executes. Fixtures, failure rows and Redis keys belong to each test; no reset, broad deletion or Redis flush occurs.

The baseline reproduced duplicate concurrent callbacks, retries bypassing normal locks, falsely resolved skipped/unknown results, and missing successful attempt counts. The final 16 checks cover durable failures, successful/failed retries, tenant denial, shared lock exclusion, committed claims outside handler transactions, claim/commit failure rollback, interrupted claims, active-resolution denial, dispatch-gap ownership checks and conditional completion.

This is not an exactly-once provider-delivery guarantee. A handler can perform an external effect and then throw; the existing handler retry policy can call it again. Redis leases can expire or lose ownership during a process stall or outage, and JavaScript cannot undo or forcibly stop an already-issued external request. Provider idempotency keys, destination reconciliation, and integration-specific recovery remain necessary. Unknown claims are intentionally conservative and can require manual work even when execution never began. Attempt counts include committed, confirmed outcomes; an interrupted attempt may not be reflected in the count, but its start remains recorded.

Provider credentials, callback/webhook contracts, live delivery and generic scheduler behavior were not certified by these shared synthetic tests.
