import { CustomerOrderStatus } from "@prisma/client";

export const salesOrderLifecycleViews = ["ACTIVE", "HISTORY", "ALL"] as const;

export type SalesOrderLifecycleView = (typeof salesOrderLifecycleViews)[number];

export const isSalesOrderActionRequired = (order: {
  status: CustomerOrderStatus;
  trackingAddedAt?: Date | string | null;
}) => order.status !== CustomerOrderStatus.CANCELED && !order.trackingAddedAt;

export const isSalesOrderInLifecycleView = (
  order: {
    status: CustomerOrderStatus;
    trackingAddedAt?: Date | string | null;
  },
  view: SalesOrderLifecycleView,
) =>
  view === "ALL"
    ? true
    : view === "ACTIVE"
      ? isSalesOrderActionRequired(order)
      : !isSalesOrderActionRequired(order);
