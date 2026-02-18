# POS + MKassa (KKM) Approach

## POS core
- `Register` -> cashier terminal per store.
- `Shift` -> open/close lifecycle (`OPEN` / `CLOSED`), X/Z numbers from shift scope.
- `Sale` -> draft -> complete, split payments supported.
- `Return` -> linked to original sale, partial lines supported.
- `CashDrawerMovement` -> `PAY_IN` / `PAY_OUT` during open shift.

## KKM modes
- `OFF`: fiscalization disabled.
- `EXPORT_ONLY`: receipts are queued for export and external fiscal workflow.
- `CONNECTOR`: receipts are queued and consumed by a local connector device.
- `ADAPTER`: direct adapter call; failed receipts go to retry queue.

## MKassa constraints (implemented)
- Card refund is allowed only in the currently open shift that matches original sale shift.
- QR-like refund (`TRANSFER` in POS payment methods) is treated as manual flow:
  - system creates `RefundRequest`,
  - return is not financially completed in POS ledger,
  - operator continues outside POS/manual-support process.

## Queue, retry, idempotency
- `FiscalReceipt` stores payload, status, attempts, provider refs, last error.
- Sale completion writes immutable inventory/payment state first, then queues fiscal receipt.
- `CONNECTOR` flow:
  - admin issues one-time pairing code,
  - connector pairs and receives token,
  - connector heartbeats, pulls queue, pushes result.
- `ADAPTER` flow:
  - immediate attempt on complete,
  - failed receipts are retried by `kkm-retry-receipts` background job.

## Failure modes and recovery
- Connector offline: receipts remain `QUEUED`/`FAILED`; no data loss.
- Adapter failure: receipt is marked `FAILED`, `nextAttemptAt` is set, retry job can recover.
- Duplicate completion/retry calls are protected by idempotency keys and unique queue keys.
