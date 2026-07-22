import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthToken, mockPrintReceipt } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
  mockPrintReceipt: vi.fn(),
}));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: mockGetServerAuthToken,
}));
vi.mock("@/server/printing/adapter", () => ({
  printReceipt: mockPrintReceipt,
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: "ru" }) }),
  headers: () => ({ get: () => null }),
}));

import { GET as receiptPdfGet } from "@/app/api/pos/receipts/[id]/pdf/route";
import { POST as receiptConnectorPost } from "@/app/api/printing/receipt/connector/route";
import { prisma } from "@/server/db/prisma";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("Agent 1 POS receipt HTTP store authorization", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrintReceipt.mockResolvedValue({ ok: true });
    await resetDatabase();
  });

  it("HARD-A1-001 denies same-org and cross-org receipt artifacts before print/audit effects", async () => {
    const { org, store, adminUser, managerUser } = await seedBase({ plan: "BUSINESS" });
    const restrictedStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Restricted receipt store",
        code: "RESTRICTED-RECEIPT",
      },
    });
    const foreignOrg = await prisma.organization.create({
      data: { name: "Foreign receipt organization", plan: "BUSINESS" },
    });
    const foreignAdmin = await prisma.user.create({
      data: {
        organizationId: foreignOrg.id,
        email: "foreign-receipt-admin@test.local",
        name: "Foreign Receipt Admin",
        passwordHash: "hash",
        role: Role.ADMIN,
        isOrgOwner: true,
        emailVerifiedAt: new Date(),
      },
    });
    const foreignStore = await prisma.store.create({
      data: {
        organizationId: foreignOrg.id,
        name: "Foreign receipt store",
        code: "FOREIGN-RECEIPT",
      },
    });
    const [assignedSale, restrictedSale, foreignSale] = await Promise.all([
      prisma.customerOrder.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          number: "B1-RECEIPT-ASSIGNED",
          status: "COMPLETED",
          source: "MANUAL",
          isPosSale: true,
          subtotalKgs: 100,
          totalKgs: 100,
          completedAt: new Date(),
          createdById: adminUser.id,
        },
      }),
      prisma.customerOrder.create({
        data: {
          organizationId: org.id,
          storeId: restrictedStore.id,
          number: "B1-RECEIPT-RESTRICTED",
          status: "COMPLETED",
          source: "MANUAL",
          isPosSale: true,
          subtotalKgs: 200,
          totalKgs: 200,
          completedAt: new Date(),
          createdById: adminUser.id,
        },
      }),
      prisma.customerOrder.create({
        data: {
          organizationId: foreignOrg.id,
          storeId: foreignStore.id,
          number: "B1-RECEIPT-FOREIGN",
          status: "COMPLETED",
          source: "MANUAL",
          isPosSale: true,
          subtotalKgs: 300,
          totalKgs: 300,
          completedAt: new Date(),
          createdById: foreignAdmin.id,
        },
      }),
    ]);
    await prisma.storePrinterSettings.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          receiptPrintMode: "CONNECTOR",
        },
        {
          organizationId: org.id,
          storeId: restrictedStore.id,
          receiptPrintMode: "CONNECTOR",
        },
        {
          organizationId: foreignOrg.id,
          storeId: foreignStore.id,
          receiptPrintMode: "CONNECTOR",
        },
      ],
    });
    mockGetServerAuthToken.mockResolvedValue({
      sub: managerUser.id,
      email: managerUser.email,
      organizationId: org.id,
      role: managerUser.role,
      isOrgOwner: false,
      isPlatformOwner: false,
    });
    const deniedAuditBefore = await prisma.auditLog.count({
      where: { entityId: { in: [restrictedSale.id, foreignSale.id] } },
    });

    const restrictedPdf = await receiptPdfGet(
      new Request(`http://localhost/api/pos/receipts/${restrictedSale.id}/pdf`),
      { params: { id: restrictedSale.id } },
    );
    const restrictedConnector = await receiptConnectorPost(
      new Request("http://localhost/api/printing/receipt/connector", {
        method: "POST",
        body: JSON.stringify({ saleId: restrictedSale.id, kind: "precheck" }),
      }),
    );
    const foreignPdf = await receiptPdfGet(
      new Request(`http://localhost/api/pos/receipts/${foreignSale.id}/pdf`),
      { params: { id: foreignSale.id } },
    );
    const foreignConnector = await receiptConnectorPost(
      new Request("http://localhost/api/printing/receipt/connector", {
        method: "POST",
        body: JSON.stringify({ saleId: foreignSale.id, kind: "precheck" }),
      }),
    );
    const deniedAuditAfter = await prisma.auditLog.count({
      where: { entityId: { in: [restrictedSale.id, foreignSale.id] } },
    });

    expect(restrictedPdf.status).toBe(403);
    expect(restrictedConnector.status).toBe(403);
    expect(foreignPdf.status).toBe(404);
    expect(foreignConnector.status).toBe(404);
    expect(mockPrintReceipt).not.toHaveBeenCalled();
    expect(deniedAuditAfter).toBe(deniedAuditBefore);

    const assignedPdf = await receiptPdfGet(
      new Request(`http://localhost/api/pos/receipts/${assignedSale.id}/pdf`),
      { params: { id: assignedSale.id } },
    );
    const assignedConnector = await receiptConnectorPost(
      new Request("http://localhost/api/printing/receipt/connector", {
        method: "POST",
        body: JSON.stringify({ saleId: assignedSale.id, kind: "precheck" }),
      }),
    );

    expect(assignedPdf.status).toBe(200);
    expect(assignedPdf.headers.get("content-type")).toBe("application/pdf");
    expect(assignedConnector.status).toBe(200);
    expect(mockPrintReceipt).toHaveBeenCalledTimes(1);
    expect(mockPrintReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: org.id,
        job: expect.objectContaining({ saleId: assignedSale.id, storeId: store.id }),
      }),
    );
  });
});
