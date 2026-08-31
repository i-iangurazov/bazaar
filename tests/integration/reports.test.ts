import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createProduct } from "@/server/services/products";
import { editStockMovementDocument, postStockWriteOff } from "@/server/services/inventory";
import {
  getShrinkageReport,
  getSlowMoversReport,
  getStockoutsReport,
} from "@/server/services/reports";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { adjustStockWithExplicitPositiveCost as adjustStock } from "../helpers/d009Fixtures";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describeDb("reports", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns stockouts, slow movers, and shrinkage data", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const stockoutProduct = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-report-product-1",
      sku: "SKU-REPORT-1",
      name: "Report Product 1",
      baseUnitId: baseUnit.id,
    });

    await adjustStock({
      storeId: store.id,
      productId: stockoutProduct.id,
      qtyDelta: 5,
      reason: "Seed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-report-adjust-1",
      idempotencyKey: "idem-report-adjust-1",
    });

    await adjustStock({
      storeId: store.id,
      productId: stockoutProduct.id,
      qtyDelta: -5,
      reason: "Stockout",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-report-adjust-2",
      idempotencyKey: "idem-report-adjust-2",
    });

    const slowProduct = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-report-product-2",
      sku: "SKU-REPORT-2",
      name: "Report Product 2",
      baseUnitId: baseUnit.id,
    });

    const range = { from: daysAgo(30), to: new Date() };

    const stockouts = await getStockoutsReport({
      organizationId: org.id,
      storeId: store.id,
      ...range,
    });
    expect(
      stockouts.items.some((row) => row.productId === stockoutProduct.id && row.count === 1),
    ).toBe(true);

    const slowMovers = await getSlowMoversReport({
      organizationId: org.id,
      storeId: store.id,
      ...range,
    });
    expect(slowMovers.items.some((row) => row.productId === slowProduct.id)).toBe(true);

    const shrinkage = await getShrinkageReport({
      organizationId: org.id,
      storeId: store.id,
      ...range,
    });
    expect(
      shrinkage.items.some((row) => row.productId === stockoutProduct.id && row.totalQty === 5),
    ).toBe(true);

    const [stockoutsBeyondLastPage, slowMoversBeyondLastPage, shrinkageBeyondLastPage] =
      await Promise.all([
        getStockoutsReport({
          organizationId: org.id,
          storeId: store.id,
          ...range,
          page: 99,
          pageSize: 10,
        }),
        getSlowMoversReport({
          organizationId: org.id,
          storeId: store.id,
          ...range,
          page: 99,
          pageSize: 10,
        }),
        getShrinkageReport({
          organizationId: org.id,
          storeId: store.id,
          ...range,
          page: 99,
          pageSize: 10,
        }),
      ]);

    expect(stockoutsBeyondLastPage).toMatchObject({
      items: [],
      total: stockouts.total,
      page: 99,
      pageSize: 10,
    });
    expect(slowMoversBeyondLastPage).toMatchObject({
      items: [],
      total: slowMovers.total,
      page: 99,
      pageSize: 10,
    });
    expect(shrinkageBeyondLastPage).toMatchObject({
      items: [],
      total: shrinkage.total,
      page: 99,
      pageSize: 10,
    });
  });

  it("reports posted write-offs with cost details and nets document corrections", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-report-write-off-product",
      idempotencyKey: "idem-report-write-off-product",
      sku: "SKU-REPORT-WRITE-OFF",
      name: "Report Write-off Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
      initialOnHand: 10,
      avgCostKgs: 12.345,
    });
    const occurredAt = new Date();
    const writeOff = await postStockWriteOff({
      storeId: store.id,
      date: occurredAt,
      reason: "Порча",
      comment: "Damaged packaging",
      lines: [{ productId: product.id, qty: 4 }],
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-report-write-off",
      idempotencyKey: "idem-report-write-off",
    });

    await editStockMovementDocument({
      documentType: "WRITE_OFF",
      referenceType: "WRITE_OFF",
      referenceId: writeOff.writeOffId,
      lines: [{ productId: product.id, quantity: 2 }],
      reason: "Corrected damaged quantity",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-report-write-off-edit",
      idempotencyKey: "idem-report-write-off-edit",
    });

    await prisma.stockMovement.create({
      data: {
        storeId: store.id,
        productId: product.id,
        type: "ADJUSTMENT",
        qtyDelta: -9,
        referenceType: "BUNDLE_ASSEMBLY",
        referenceId: "report-bundle-assembly",
        note: "bundleAssemble:test",
        createdById: adminUser.id,
      },
    });

    const report = await getShrinkageReport({
      organizationId: org.id,
      storeId: store.id,
      from: new Date(occurredAt.getTime() - 60_000),
      to: new Date(Date.now() + 60_000),
    });
    const row = report.items.find((item) => item.documentId === writeOff.writeOffId);

    expect(row).toMatchObject({
      documentType: "WRITE_OFF",
      storeId: store.id,
      productId: product.id,
      userId: adminUser.id,
      reason: "Порча",
      totalQty: 2,
      movementCount: 2,
    });
    expect(row?.totalValueKgs).toBeCloseTo(24.7, 6);
    expect(row?.occurredAt.getTime()).toBe(occurredAt.getTime());
    expect(row?.movementIds).toHaveLength(2);
    expect(row?.movementIds).toContain(row?.latestMovementId);
    expect(report.items.some((item) => item.documentId === "report-bundle-assembly")).toBe(false);
  });

  it("bounds report rows with deterministic server pagination", async () => {
    const { org, store, baseUnit } = await seedBase();
    const products = Array.from({ length: 15 }, (_, index) => ({
      id: `report-page-product-${index.toString().padStart(2, "0")}`,
      organizationId: org.id,
      sku: `REPORT-PAGE-${index.toString().padStart(2, "0")}`,
      name: `Report page product ${index.toString().padStart(2, "0")}`,
      unit: baseUnit.code,
      baseUnitId: baseUnit.id,
    }));
    await prisma.product.createMany({ data: products });
    await prisma.inventorySnapshot.createMany({
      data: products.map((product, index) => ({
        storeId: store.id,
        productId: product.id,
        onHand: index + 1,
      })),
    });
    const range = { from: daysAgo(30), to: new Date() };

    const first = await getSlowMoversReport({
      organizationId: org.id,
      storeId: store.id,
      ...range,
      page: 1,
      pageSize: 10,
    });
    const second = await getSlowMoversReport({
      organizationId: org.id,
      storeId: store.id,
      ...range,
      page: 2,
      pageSize: 10,
    });

    expect(first).toMatchObject({ page: 1, pageSize: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.total).toBeGreaterThanOrEqual(15);
    expect(second).toMatchObject({ page: 2, pageSize: 10, total: first.total });
    expect(second.items.length).toBeGreaterThan(0);
    expect(new Set([...first.items, ...second.items].map((row) => row.productId)).size).toBe(
      first.items.length + second.items.length,
    );

    const beyondLastPage = await getSlowMoversReport({
      organizationId: org.id,
      storeId: store.id,
      ...range,
      page: 99,
      pageSize: 10,
    });
    expect(beyondLastPage).toMatchObject({
      items: [],
      total: first.total,
      page: 99,
      pageSize: 10,
    });
  });
});
