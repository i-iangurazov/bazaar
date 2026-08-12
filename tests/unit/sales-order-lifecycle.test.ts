import { CustomerOrderStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isSalesOrderActionRequired, isSalesOrderInLifecycleView } from "@/lib/salesOrderLifecycle";

describe("sales order lifecycle views", () => {
  const trackedAt = new Date("2026-08-12T00:00:00.000Z");

  it.each([
    [CustomerOrderStatus.DRAFT, null, true],
    [CustomerOrderStatus.CONFIRMED, null, true],
    [CustomerOrderStatus.READY, null, true],
    [CustomerOrderStatus.COMPLETED, null, true],
    [CustomerOrderStatus.DRAFT, trackedAt, false],
    [CustomerOrderStatus.COMPLETED, trackedAt, false],
    [CustomerOrderStatus.CANCELED, null, false],
    [CustomerOrderStatus.CANCELED, trackedAt, false],
  ])(
    "classifies %s with tracking %s as action-required=%s",
    (status, trackingAddedAt, expected) => {
      expect(isSalesOrderActionRequired({ status, trackingAddedAt })).toBe(expected);
    },
  );

  it("partitions active and history while ALL preserves every ordinary order", () => {
    const active = { status: CustomerOrderStatus.READY, trackingAddedAt: null };
    const tracked = { status: CustomerOrderStatus.DRAFT, trackingAddedAt: trackedAt };
    const canceled = { status: CustomerOrderStatus.CANCELED, trackingAddedAt: null };

    expect(isSalesOrderInLifecycleView(active, "ACTIVE")).toBe(true);
    expect(isSalesOrderInLifecycleView(active, "HISTORY")).toBe(false);
    expect(isSalesOrderInLifecycleView(tracked, "ACTIVE")).toBe(false);
    expect(isSalesOrderInLifecycleView(tracked, "HISTORY")).toBe(true);
    expect(isSalesOrderInLifecycleView(canceled, "ACTIVE")).toBe(false);
    expect(isSalesOrderInLifecycleView(canceled, "HISTORY")).toBe(true);
    expect(isSalesOrderInLifecycleView(canceled, "ALL")).toBe(true);
  });
});
