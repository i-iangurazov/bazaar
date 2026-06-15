# POS State Machine Release - 2026-06-14

## Release Record

- Status: accepted
- Commit: `9573325059b87bfa3c92d0a2458ddab03c1efb79`
- Production deployment: `dpl_5kxgARuUqjd6dGnvrUFVjjSEmuCp`
- Migration: `20260614143000_pos_active_draft_held_scope`
- Production URL: `https://www.bazaar.kg`
- Health after deploy: `ok`, `db up`, `migrations ok`, `redis up`

## Scope

This release hardens POS checkout state integrity across the cashier lifecycle. It treats the server active draft as the source of truth and prevents silent divergence between:

- visible cart UI
- server draft
- payment draft
- register and shift
- held receipt
- completed or cancelled receipt
- local runtime state
- idempotency behavior

No further POS changes should be made under this accepted task. New POS behavior changes should be handled as separate work.

## State Machine Coverage

- No active draft: POS can start a clean sale.
- Draft created: active server draft becomes the source of truth.
- Cart editing: visible cart is reconciled with the active server draft.
- Held receipt: held drafts are excluded from the active draft uniqueness rule.
- Resumed receipt: resumed held receipts do not poison a new active sale.
- Submitting: checkout is guarded against repeat submit.
- Completed: stale runtime cart/payment/order state is cleared.
- Cancelled: cancelled drafts cannot leak into the next sale.
- Failed submit: the active draft is refetched and restored safely.
- Refresh/recovery: server draft is restored into UI instead of showing an empty cart over a stale backend draft.
- Double submit: backend idempotency and frontend in-flight guards prevent duplicate checkout.
- Offline/API failure: cashier sees a safe user-facing error and the POS refetches state.

## Production Smoke Result

Production smoke passed after deployment:

- POS opens.
- Receipt journal opens.
- Held receipt UI loads.
- Shift/held blocking area loads.
- Product Movement opens.
- Sale edit action opens.
- Large Sale edit modal with 25 lines renders and scrolls correctly.
- No console/runtime errors observed.
- No unexpected API errors observed.

Evidence paths from the release machine:

- `tmp/prod-pos-held-release-smoke/`
- `tmp/prod-product-movement-edit-smoke/`

## Monitoring Window

For the next 24 hours after acceptance, monitor production logs and user reports for:

- payment mismatch
- duplicate record errors
- stale or empty cart while an active draft exists
- failed checkout
- held or resumed receipt issues

If any POS checkout error occurs, retrieve the structured checkout log for the exact event.

Required fields:

- `storeId`
- `registerId`
- `shiftId`
- `draftId` or `orderId`
- `userId`
- visible cart line count
- server draft line count
- payment sum
- cart total
- difference
- payment method
- idempotency key
- error code
- backend stack/code when available

Do not log or export sensitive customer or payment data.

## Release Safety Notes

- Production migration was applied with `prisma migrate deploy`.
- `db push` was not used.
- Seed scripts were not run.
- Cleanup scripts were not run.
- No destructive database changes were made.

