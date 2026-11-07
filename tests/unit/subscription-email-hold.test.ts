import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  rows: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    $queryRaw: mock.query,
    subscriptionUsageReservation: { findMany: mock.rows, update: mock.update },
    $transaction: mock.transaction,
  },
}));
import { holdUncertainSubscriptionUsageBatch } from "@/server/billing/subscriptionUsage";
beforeEach(() => {
  vi.clearAllMocks();
  mock.transaction.mockImplementation(async (run) =>
    run({
      $queryRaw: mock.query,
      subscriptionUsageReservation: { findMany: mock.rows, update: mock.update },
    }),
  );
  mock.update.mockResolvedValue({});
});
describe("uncertain email allowance retention", () => {
  it("holds started reservations beyond the bucket and grace, without touching used/other resources", async () => {
    const end = new Date(Date.now() + 30 * 86400000);
    mock.rows.mockResolvedValue([
      { id: "reservation", expiresAt: new Date(0), bucket: { endsAt: end } },
    ]);
    await holdUncertainSubscriptionUsageBatch({
      organizationId: "org",
      operationKeys: ["email:recipient"],
    });
    expect(mock.query).toHaveBeenCalledTimes(1);
    expect(mock.rows).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org",
          resource: "marketingEmails",
          state: "RESERVED",
          startedAt: { not: null },
        }),
      }),
    );
    expect(mock.update).toHaveBeenCalledWith({
      where: { id: "reservation" },
      data: { expiresAt: new Date(end.getTime() + 7 * 86400000) },
    });
  });
  it("does not shorten an existing later hold", async () => {
    const later = new Date(Date.now() + 60 * 86400000);
    mock.rows.mockResolvedValue([
      { id: "reservation", expiresAt: later, bucket: { endsAt: new Date(0) } },
    ]);
    await holdUncertainSubscriptionUsageBatch({
      organizationId: "org",
      operationKeys: ["email:recipient"],
    });
    expect(mock.update).toHaveBeenCalledWith({
      where: { id: "reservation" },
      data: { expiresAt: later },
    });
  });
  it("does nothing for an empty ownership set", async () => {
    await holdUncertainSubscriptionUsageBatch({ organizationId: "org", operationKeys: [] });
    expect(mock.transaction).not.toHaveBeenCalled();
  });
});
