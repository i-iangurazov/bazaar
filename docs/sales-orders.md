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
