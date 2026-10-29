# Sales Orders (Customer Orders)

## Purpose
- Split order flows into two clear modules:
- `Sales Orders` for customer-facing fulfillment (`/sales/orders`).
- `Purchase Orders` for supplier procurement (`/purchase-orders`).

## Workflow
1. Create draft sales order.
2. Add line items (product/variant or bundle, quantity, price snapshot).
3. Confirm order.
4. Mark ready.
5. Complete order.

On completion, the system writes immutable `SALE` stock movements and updates inventory snapshots through the ledger path.

## Statuses
- `DRAFT`
- `CONFIRMED`
- `READY`
- `COMPLETED`
- `CANCELED`

## RBAC
- `ADMIN`, `MANAGER`, `STAFF`: create/edit drafts and move through non-final steps.
- `ADMIN`, `MANAGER`: complete and cancel.
- RBAC is enforced server-side in `salesOrders` tRPC router.

## Idempotency
- Completing an order requires `idempotencyKey`.
- Repeated completion with the same key does not duplicate stock movements.

## Reversible archive
- `ADMIN` and assigned `MANAGER` users can archive and restore customer orders
  through the existing row actions on desktop and mobile. POS sales are excluded.
- Archiving sets `archivedAt`; it does not introduce an order status or change
  stock, payments, currency snapshots, tracking, totals, or reporting eligibility.
- The default active/history lists omit archived orders. The separate Archive tab
  includes all manually archived statuses. Restore returns an order to the regular
  active/history view selected by its existing status and tracking state.
- `salesOrders.list.archiveFilter` accepts `VISIBLE` (default), `ARCHIVED`, or
  `ALL`. Organization, store, plan and role restrictions continue to apply.
- Repeating the same archive/restore request is a no-op. A row lock serializes
  competing requests and audit entries identify each effective change.
- Archive does not cancel email automations or fulfillment. Use the existing
  cancellation workflow when a business operation must actually be canceled.

## Order Emails And Tracking
- Confirmation emails are sent automatically when an order is confirmed or submitted through catalogue/API checkout, and managers can resend them from the order detail page.
- Tracking fields live on the customer order: tracking number, carrier, tracking URL, tracking status, added timestamp, and sent timestamp.
- Adding or changing tracking details sends a tracking email when a tracking number is present. Saving unchanged tracking details does not send a duplicate email.
- Email delivery attempts are logged in `CustomerOrderEmailLog` with type, status, recipient, provider metadata, error message, and triggering user when available.
- Follow-up emails are sent by the `customer-order-follow-up` job after seven days. The job uses `completedAt` when present, otherwise falls back to `createdAt`, and skips orders that already have `followUpEmailSentAt`.
- Run the follow-up job through `POST /api/jobs/run?job=customer-order-follow-up` with the `x-job-secret: JOBS_SECRET` header. The job is idempotent and safe to rerun.

## Metrics
- `/sales/orders/metrics` includes:
- revenue/cost/profit trends (day/week)
- totals and margin
- top products by revenue
- top bundles by revenue

## Navigation
- Sidebar uses explicit labels:
- `Sales Orders` (`Клиенты` / `Кардарлар`)
- `Purchase Orders` (`Поставки` / `Жеткирүүлөр`)
- Legacy `/orders` redirects to `/purchase-orders`.
