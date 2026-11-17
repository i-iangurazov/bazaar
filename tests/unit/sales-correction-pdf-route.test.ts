import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  correction: vi.fn(),
  user: vi.fn(),
  access: vi.fn(),
  render: vi.fn(),
  audit: vi.fn(),
  feature: vi.fn(),
}));
vi.mock("@/server/auth/token", () => ({ getServerAuthToken: mocks.token }));
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    salesOrderCorrection: { findFirst: mocks.correction },
    user: { findFirst: mocks.user },
  },
}));
vi.mock("@/server/services/planLimits", () => ({ assertFeatureEnabled: mocks.feature }));
vi.mock("@/server/services/storeAccess", () => ({
  assertUserCanAccessStore: mocks.access,
}));
vi.mock("@/server/services/salesDocumentPdf", () => ({
  buildSalesCorrectionPdf: mocks.render,
}));
vi.mock("@/server/services/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "ru" }) }) }));

import { AppError } from "@/server/services/errors";
import { correctionDifferenceLabelKind } from "@/lib/salesOrderCorrectionDisplay";
import { GET } from "../../src/app/api/sales/orders/[id]/corrections/[correctionId]/pdf/route";

const correction = {
  id: "cr-1",
  number: "CR-000001",
  organizationId: "org-1",
  storeId: "store-1",
  reason: "Customer returned an item",
  notes: null,
  returnedKgs: 100,
  addedKgs: 0,
  offsetKgs: 0,
  refundKgs: 100,
  chargeKgs: 0,
  createdAt: new Date("2026-11-16T12:00:00Z"),
  originalOrder: {
    number: "SO-000004",
    createdAt: new Date("2026-11-16T11:00:00Z"),
    customerName: "Customer",
    store: { name: "Store", legalName: "Seller", inn: "123" },
  },
  saleReturn: {
    lines: [
      {
        qty: 1,
        unitPriceKgs: 100,
        lineTotalKgs: 100,
        unitCostKgs: 40,
        product: { name: "Product", sku: "SKU-1" },
      },
    ],
    refundRequests: [] as Array<{ status: string }>,
  },
  additionOrder: null,
};

const call = () =>
  GET(new Request("http://localhost/api/sales/orders/order-1/corrections/cr-1/pdf"), {
    params: Promise.resolve({ id: "order-1", correctionId: "cr-1" }),
  });

describe("sales correction PDF HTTP contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token.mockResolvedValue({
      sub: "live-user",
      organizationId: "org-1",
      role: "ADMIN",
      isOrgOwner: true,
    });
    mocks.correction.mockResolvedValue(correction);
    mocks.user.mockResolvedValue({
      id: "live-user",
      organizationId: "org-1",
      role: "ADMIN",
      isOrgOwner: true,
    });
    mocks.access.mockResolvedValue(undefined);
    mocks.feature.mockResolvedValue(undefined);
    mocks.render.mockResolvedValue(Buffer.from("%PDF-synthetic-correction"));
    mocks.audit.mockResolvedValue(undefined);
  });

  it("requires an authenticated actor", async () => {
    mocks.token.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(mocks.correction).not.toHaveBeenCalled();
  });

  it("does not reveal another tenant's correction", async () => {
    mocks.correction.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("enforces the customerOrders plan gate before rendering", async () => {
    mocks.feature.mockRejectedValue(new AppError("featureUnavailable", "FORBIDDEN", 403));
    expect((await call()).status).toBe(403);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("enforces store access before rendering", async () => {
    mocks.access.mockRejectedValue(new AppError("forbidden", "FORBIDDEN", 403));
    expect((await call()).status).toBe(403);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("downloads a safe correction attachment without cost data", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="correction-CR-000001.pdf"',
    );
    const payload = mocks.render.mock.calls[0]![0].job;
    expect(JSON.stringify(payload)).not.toContain("unitCost");
    expect(payload.returnedItems[0]).not.toHaveProperty("unitCostKgs");
    expect(payload.offsetKgs).toBe(0);
    expect(payload.refundRequestStatus).toBeNull();
    expect(
      correctionDifferenceLabelKind({
        refundRequestStatus: payload.refundRequestStatus,
        refundKgs: payload.refundKgs,
        chargeKgs: payload.chargeKgs,
      }),
    ).toBe("refundPaid");
    expect(mocks.render.mock.calls[0]![0].labels.offsetSettled).toBe("Погашено обменом");
    expect(mocks.render.mock.calls[0]![0].labels.toRefund).toBe("К возврату");
    expect(mocks.correction).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cr-1", originalOrderId: "order-1", organizationId: "org-1" },
      }),
    );
  });

  it("passes a resolved manual refund to the act as paid money", async () => {
    correction.saleReturn.refundRequests = [{ status: "RESOLVED" }];
    try {
      const response = await call();
      expect(response.status).toBe(200);
      const params = mocks.render.mock.calls[0]![0];
      expect(params.job.refundRequestStatus).toBe("RESOLVED");
      expect(params.labels.toRefundPaid).toBe("Выплачено");
      expect(params.labels.toRefundPending).toBe("Ожидает выплаты");
      expect(params.labels.refundCanceled).toBe("Возврат отменён");
    } finally {
      correction.saleReturn.refundRequests = [];
    }
  });

  it("passes a canceled manual refund to the act instead of claiming money is owed", async () => {
    correction.saleReturn.refundRequests = [{ status: "CANCELED" }];
    try {
      const response = await call();
      expect(response.status).toBe(200);
      expect(mocks.render.mock.calls[0]![0].job.refundRequestStatus).toBe("CANCELED");
    } finally {
      correction.saleReturn.refundRequests = [];
    }
  });
});
