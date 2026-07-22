import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { consumeZip, imageExportStore, storeZip } from "@/lib/imageExportStore";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const { mockGetServerAuthToken, mockPrintLabels } = vi.hoisted(() => ({
  mockGetServerAuthToken: vi.fn(),
  mockPrintLabels: vi.fn(),
}));

vi.mock("@/server/auth/token", () => ({
  getServerAuthToken: mockGetServerAuthToken,
}));

vi.mock("@/server/printing/adapter", () => ({
  printLabels: mockPrintLabels,
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined }),
}));

import { POST as priceTagsPost } from "@/app/api/price-tags/pdf/route";
import { POST as connectorLabelsPost } from "@/app/api/printing/labels/connector/route";
import { GET as downloadImagesGet } from "@/app/api/products/export-images/download/route";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("Agent 2 P0 HTTP boundary reproductions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    imageExportStore.clear();
    await resetDatabase();
  });

  it("HARD-A2-009 lets a Store-A-only manager generate and dispatch Store B labels", async () => {
    const { org, store, baseUnit, managerUser } = await seedBase({ plan: "BUSINESS" });
    const storeB = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Restricted Print Store B",
        code: `PB-${randomUUID().slice(0, 8)}`,
      },
    });
    const productB = await prisma.product.create({
      data: {
        organizationId: org.id,
        sku: `PRINT-${randomUUID().slice(0, 8)}`,
        name: "Restricted print product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        basePriceKgs: 456,
        barcodes: {
          create: {
            organizationId: org.id,
            value: `20${Date.now().toString().slice(-10)}`,
          },
        },
        storeProducts: {
          create: {
            organizationId: org.id,
            storeId: storeB.id,
            isActive: true,
          },
        },
      },
    });
    await prisma.storePrinterSettings.create({
      data: {
        organizationId: org.id,
        storeId: storeB.id,
        labelPrintMode: "CONNECTOR",
      },
    });
    const accessBefore = await prisma.userStoreAccess.findMany({
      where: { userId: managerUser.id },
      select: { storeId: true },
    });
    const printerBefore = await prisma.storePrinterSettings.findUniqueOrThrow({
      where: { storeId: storeB.id },
    });
    expect(accessBefore.map((entry) => entry.storeId)).toEqual([store.id]);
    mockGetServerAuthToken.mockResolvedValue({
      sub: managerUser.id,
      organizationId: org.id,
      role: managerUser.role,
    });
    mockPrintLabels.mockResolvedValue({ ok: true });

    const pdfResponse = await priceTagsPost(
      new Request("http://localhost/api/price-tags/pdf", {
        method: "POST",
        body: JSON.stringify({
          template: "3x8",
          storeId: storeB.id,
          items: [{ productId: productB.id, quantity: 1 }],
        }),
      }),
    );
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers.get("content-type")).toBe("application/pdf");
    expect(pdfBytes.byteLength).toBeGreaterThan(500);

    const connectorResponse = await connectorLabelsPost(
      new Request("http://localhost/api/printing/labels/connector", {
        method: "POST",
        body: JSON.stringify({
          template: "3x8",
          storeId: storeB.id,
          items: [{ productId: productB.id, quantity: 1 }],
        }),
      }),
    );
    expect(connectorResponse.status).toBe(200);
    await expect(connectorResponse.json()).resolves.toEqual({ ok: true });
    expect(mockPrintLabels).toHaveBeenCalledTimes(1);
    expect(mockPrintLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: org.id,
        job: expect.objectContaining({ storeId: storeB.id, productIds: [productB.id] }),
      }),
    );

    const [accessAfter, printerAfter] = await Promise.all([
      prisma.userStoreAccess.findMany({
        where: { userId: managerUser.id },
        select: { storeId: true },
      }),
      prisma.storePrinterSettings.findUniqueOrThrow({ where: { storeId: storeB.id } }),
    ]);
    expect(accessAfter).toEqual(accessBefore);
    expect(printerAfter.labelPrintMode).toBe(printerBefore.labelPrintMode);
  });

  it("HARD-A2-010 lets an authenticated user in another organization consume an image ZIP token", async () => {
    const { org, adminUser } = await seedBase({ plan: "BUSINESS" });
    const betaOrg = await prisma.organization.create({
      data: { name: "Artifact Beta Org", plan: "BUSINESS" },
    });
    const betaUser = await prisma.user.create({
      data: {
        organizationId: betaOrg.id,
        email: `beta-${randomUUID()}@test.local`,
        name: "Beta artifact user",
        passwordHash: "hash",
        role: Role.ADMIN,
        isOrgOwner: true,
        emailVerifiedAt: new Date(),
      },
    });
    const principals = await prisma.user.findMany({
      where: { id: { in: [adminUser.id, betaUser.id] } },
      select: { id: true, organizationId: true },
      orderBy: { organizationId: "asc" },
    });
    expect(new Set(principals.map((principal) => principal.organizationId))).toEqual(
      new Set([org.id, betaOrg.id]),
    );

    const downloadToken = randomUUID();
    const alphaBytes = new TextEncoder().encode("alpha-private-zip-canary");
    storeZip(downloadToken, alphaBytes.buffer, "alpha-private-images.zip");
    mockGetServerAuthToken.mockResolvedValue({
      sub: betaUser.id,
      organizationId: betaOrg.id,
      role: betaUser.role,
    });

    const response = await downloadImagesGet(
      new Request(
        `http://localhost/api/products/export-images/download?token=${encodeURIComponent(downloadToken)}`,
      ),
    );
    const downloaded = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("alpha-private-images.zip");
    expect(downloaded).toEqual(alphaBytes);
    expect(consumeZip(downloadToken)).toBeUndefined();
  });
});
