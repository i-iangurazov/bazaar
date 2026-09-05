import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SalesAnalytics from "@/server/services/salesAnalytics";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), readOnly: vi.fn(), user: vi.fn(), organization: vi.fn(), stores: vi.fn(), overview: vi.fn(),
}));
vi.mock("@/server/db/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/server/services/salesAnalytics", async (importOriginal) => ({
  ...await importOriginal<typeof SalesAnalytics>(),
  getSalesAnalyticsOverview: mocks.overview,
}));
import { getBaamSalesMetrics } from "@/server/services/baamMetrics";

const input = { actorId: "server-actor", dateFrom: "2026-09-01", dateTo: "2026-09-02" };
const actor = { id: input.actorId, organizationId: "org-a", role: "MANAGER", isActive: true, isOrgOwner: false };
const tx = { $executeRaw: mocks.readOnly, user: { findUnique: mocks.user }, organization: { findUnique: mocks.organization }, store: { findMany: mocks.stores } };
const report = (overrides = {}) => ({
  totals: { grossSalesKgs: 90, returnsKgs: 30, netSalesKgs: 60, discountKgs: 10, receiptCount: 2, returnCount: 1, averageReceiptKgs: 45,
    paymentBreakdown: { CASH: 30, CARD: 60, TRANSFER: 0, OTHER: 0 }, refundBreakdown: { CASH: 30, CARD: 0, TRANSFER: 0, OTHER: 0 }, ...overrides },
  series: [{ date: "2026-09-01", grossSalesKgs: 90, returnsKgs: 30, netSalesKgs: 60, discountKgs: 10, receiptCount: 2, returnCount: 1, averageReceiptKgs: 45 }],
});

describe("BAAM certified read-only metric boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async callback => callback(tx));
    mocks.user.mockResolvedValue(actor);
    mocks.organization.mockResolvedValue({ plan: "BUSINESS", subscriptionStatus: "ACTIVE", trialEndsAt: null, currentPeriodEndsAt: null });
    mocks.stores.mockResolvedValue([{ id: "store-a", name: "Store A" }, { id: "store-b", name: "Store B" }]);
    mocks.overview.mockResolvedValue(report());
  });

  it("uses one read-only repeatable snapshot, server organization and current manager grants", async () => {
    const result = await getBaamSalesMetrics({ ...input, storeId: "store-a" });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 15000 });
    expect(mocks.readOnly.mock.calls[0][0].join("")).toBe("SET TRANSACTION READ ONLY");
    expect(mocks.readOnly.mock.invocationCallOrder[0]).toBeLessThan(mocks.user.mock.invocationCallOrder[0]);
    expect(mocks.stores).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", userAccesses: { some: { userId: input.actorId, organizationId: "org-a" } } } }));
    expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-a", storeIds: ["store-a"] }), tx);
    expect(result.period).toEqual({ dateFrom: input.dateFrom, dateTo: input.dateTo, timeZone: "Asia/Bishkek", fromUtc: "2026-08-31T18:00:00.000Z", toUtcExclusive: "2026-09-02T18:00:00.000Z" });
    expect(result.totals).toMatchObject({ salesBeforeReturnsKgs: 90, returnsKgs: 30, netSalesKgs: 60, recordedDiscountKgs: 10 });
    expect(result.freshness).toMatchObject({ cache: "bypassed", sourceCompleteThrough: null, sourceCompleteness: "unknown" });
    expect(result.quality.paymentsReconcile).toBe(true);
    expect(result.policy.exclusions).toContain("profit");
  });

  it.each([null, { ...actor, isActive: false }, { ...actor, organizationId: null }])("rejects unavailable or disabled membership before data access: %j", async user => {
    mocks.user.mockResolvedValue(user);
    await expect(getBaamSalesMetrics(input)).rejects.toThrow("unauthorized");
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it.each(["STAFF", "CASHIER"]) ("rejects freshly downgraded %s even if an old client had manager access", async role => {
    mocks.user.mockResolvedValue({ ...actor, role });
    await expect(getBaamSalesMetrics(input)).rejects.toThrow("forbidden");
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it("rechecks grants each time and refuses foreign, removed or invented stores", async () => {
    await getBaamSalesMetrics({ ...input, storeId: "store-a" });
    mocks.stores.mockResolvedValue([{ id: "store-b", name: "Store B" }]);
    await expect(getBaamSalesMetrics({ ...input, storeId: "store-a" })).rejects.toThrow("storeAccessDenied");
    await expect(getBaamSalesMetrics({ ...input, storeId: "foreign-store" })).rejects.toThrow("storeAccessDenied");
    expect(mocks.overview).toHaveBeenCalledTimes(1);
    expect(mocks.user).toHaveBeenCalledTimes(3);
  });

  it("enforces the current analytics entitlement and subscription", async () => {
    mocks.organization.mockResolvedValueOnce({ plan: "STARTER", subscriptionStatus: "ACTIVE", trialEndsAt: null, currentPeriodEndsAt: null });
    await expect(getBaamSalesMetrics(input)).rejects.toThrow("featureLockedAnalytics");
    mocks.organization.mockResolvedValueOnce({ plan: "BUSINESS", subscriptionStatus: "CANCELED", trialEndsAt: null, currentPeriodEndsAt: null });
    await expect(getBaamSalesMetrics(input)).rejects.toThrow("subscriptionInactive");
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it("does not present missing average or source completeness as a measured zero", async () => {
    mocks.stores.mockResolvedValue([]);
    mocks.overview.mockResolvedValue({ totals: { ...report().totals, grossSalesKgs: 0, returnsKgs: 0, netSalesKgs: 0, receiptCount: 0, returnCount: 0, averageReceiptKgs: 0, paymentBreakdown: { CASH: 0 }, refundBreakdown: { CASH: 0 } }, series: [] });
    const result = await getBaamSalesMetrics(input);
    expect(result.totals.averageReceiptKgs).toBeNull();
    expect(result.quality).toMatchObject({ qualifyingRecords: 0, emptyAccessibleStoreSet: true, zeroMeaning: "no_qualifying_value_in_snapshot" });
    expect(result.freshness.sourceCompleteThrough).toBeNull();
  });

  it("reports payment mismatches without changing sales or inventing balanced payments", async () => {
    mocks.overview.mockResolvedValue(report({ paymentBreakdown: { CASH: 75 }, refundBreakdown: { CARD: 20 } }));
    const result = await getBaamSalesMetrics(input);
    expect(result.quality).toMatchObject({ paymentsReconcile: false, salesDifferenceKgs: -15, refundsDifferenceKgs: -10 });
    expect(result.totals.netSalesKgs).toBe(60);
  });

  it("changes identity for organization, period and actual granted scope; never reuses data across requests", async () => {
    const first = await getBaamSalesMetrics(input);
    expect((await getBaamSalesMetrics(input)).queryHash).toBe(first.queryHash);
    expect((await getBaamSalesMetrics({ ...input, storeId: "store-a" })).queryHash).not.toBe(first.queryHash);
    expect((await getBaamSalesMetrics({ ...input, dateTo: "2026-09-03" })).queryHash).not.toBe(first.queryHash);
    mocks.user.mockResolvedValue({ ...actor, organizationId: "org-b" });
    expect((await getBaamSalesMetrics(input)).queryHash).not.toBe(first.queryHash);
    expect(mocks.overview).toHaveBeenCalledTimes(5);
  });
});
