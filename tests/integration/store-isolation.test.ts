import { CustomerOrderStatus, ExportJobStatus, ExportType, Prisma, Role, StockMovementType } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createProduct } from "@/server/services/products";
import { adjustStock } from "@/server/services/inventory";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("store isolation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("keeps a newly created second store empty until products are explicitly assigned", async () => {
    const { org, adminUser, store, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });

    const storeB = await caller.stores.create({
      name: "Second Store",
      code: "SEC",
      allowNegativeStock: false,
      trackExpiryLots: false,
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-store-isolation-create",
      sku: "ISO-001",
      name: "Store A Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
    });

    const storeAProducts = await caller.products.list({ storeId: store.id });
    const storeBProducts = await caller.products.list({ storeId: storeB.id });
    const storeBInventory = await caller.inventory.list({ storeId: storeB.id });

    expect(storeAProducts.items.map((item) => item.id)).toContain(product.id);
    expect(storeBProducts.items.map((item) => item.id)).not.toContain(product.id);
    expect(storeBInventory.total).toBe(0);
  });

  it("explicitly assigns existing catalog products to a store without copying stock", async () => {
    const { org, adminUser, store, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });
    const storeB = await caller.stores.create({
      name: "Second Store",
      code: "SEC",
      allowNegativeStock: false,
      trackExpiryLots: false,
    });
    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-assign-existing-product",
      sku: "ASSIGN-001",
      name: "Assignable Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
    });
    await adjustStock({
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      qtyDelta: 7,
      reason: "receive",
      actorId: adminUser.id,
      requestId: "req-assign-stock",
      idempotencyKey: "assign-existing-stock",
    });

    const firstResult = await caller.products.assignToStore({
      storeId: storeB.id,
      productIds: [product.id],
    });
    const secondResult = await caller.products.assignToStore({
      storeId: storeB.id,
      productIds: [product.id],
    });
    const storeBProducts = await caller.products.list({ storeId: storeB.id });
    const storeASnapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    const storeBSnapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: storeB.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(firstResult.assignedCount).toBe(1);
    expect(firstResult.skippedCount).toBe(0);
    expect(secondResult.assignedCount).toBe(0);
    expect(secondResult.skippedCount).toBe(1);
    expect(storeBProducts.items.map((item) => item.id)).toContain(product.id);
    expect(storeASnapshot?.onHand).toBe(7);
    expect(storeBSnapshot).toBeNull();
  });

  it("scopes product creation and POS lookup to the selected store", async () => {
    const { org, adminUser, store, baseUnit } = await seedBase();
    const storeB = await prisma.store.create({
      data: { organizationId: org.id, name: "Store B", code: "B" },
    });
    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-store-b-product",
      sku: "B-ONLY",
      name: "Store B Only",
      baseUnitId: baseUnit.id,
      barcodes: ["B-ONLY-BC"],
      storeId: storeB.id,
    });
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: adminUser.isOrgOwner,
    });

    const storeAResult = await caller.products.searchQuick({ q: "B-ONLY-BC", storeId: store.id });
    const storeBResult = await caller.products.searchQuick({ q: "B-ONLY-BC", storeId: storeB.id });

    expect(storeAResult).toHaveLength(0);
    expect(storeBResult.map((item) => item.id)).toContain(product.id);
  });

  it("restricts cashier store selector and products to assigned stores", async () => {
    const { org, cashierUser, adminUser, store, baseUnit } = await seedBase();
    const storeB = await prisma.store.create({
      data: { organizationId: org.id, name: "Store B", code: "B" },
    });
    await prisma.userStoreAccess.create({
      data: { organizationId: org.id, userId: cashierUser.id, storeId: store.id },
    });
    const storeBProduct = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-store-b-hidden",
      sku: "HIDDEN-B",
      name: "Hidden Store B Product",
      baseUnitId: baseUnit.id,
      storeId: storeB.id,
    });
    const cashierCaller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: Role.CASHIER,
      organizationId: org.id,
      isOrgOwner: false,
    });

    const stores = await cashierCaller.stores.list();
    const storeAProducts = await cashierCaller.products.list({ storeId: store.id });
    await expect(cashierCaller.products.list({ storeId: storeB.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(stores.map((item) => item.id)).toEqual([store.id]);
    expect(storeAProducts.items.map((item) => item.id)).not.toContain(storeBProduct.id);
  });

  it("scopes dashboard stores and sales orders to assigned stores", async () => {
    const { org, cashierUser, store } = await seedBase({ plan: "BUSINESS" });
    const storeB = await prisma.store.create({
      data: { organizationId: org.id, name: "Store B", code: "B" },
    });
    await prisma.userStoreAccess.create({
      data: { organizationId: org.id, userId: cashierUser.id, storeId: store.id },
    });
    const [storeAOrder, storeBOrder] = await Promise.all([
      prisma.customerOrder.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          number: "SO-STORE-A",
          status: CustomerOrderStatus.CONFIRMED,
          customerName: "Store A Customer",
          totalKgs: 100,
          subtotalKgs: 100,
        },
      }),
      prisma.customerOrder.create({
        data: {
          organizationId: org.id,
          storeId: storeB.id,
          number: "SO-STORE-B",
          status: CustomerOrderStatus.CONFIRMED,
          customerName: "Store B Customer",
          totalKgs: 200,
          subtotalKgs: 200,
        },
      }),
    ]);
    const cashierCaller = createTestCaller({
      id: cashierUser.id,
      email: cashierUser.email,
      role: Role.CASHIER,
      organizationId: org.id,
      isOrgOwner: false,
    });

    const dashboard = await cashierCaller.dashboard.bootstrap({
      includeRecentActivity: false,
      includeRecentMovements: false,
    });
    const orders = await cashierCaller.salesOrders.list({ page: 1, pageSize: 25 });

    expect(dashboard.stores.map((item) => item.id)).toEqual([store.id]);
    expect(dashboard.selectedStoreId).toBe(store.id);
    expect(orders.items.map((item) => item.id)).toContain(storeAOrder.id);
    expect(orders.items.map((item) => item.id)).not.toContain(storeBOrder.id);
    await expect(
      cashierCaller.dashboard.summary({
        storeId: storeB.id,
        includeRecentActivity: false,
        includeRecentMovements: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      cashierCaller.salesOrders.list({ storeId: storeB.id, page: 1, pageSize: 25 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("scopes reports, analytics and exports to assigned stores", async () => {
    const { org, managerUser, adminUser, store, product, baseUnit } = await seedBase({ plan: "BUSINESS" });
    const storeB = await prisma.store.create({
      data: { organizationId: org.id, name: "Store B", code: "B" },
    });
    await prisma.userStoreAccess.create({
      data: { organizationId: org.id, userId: managerUser.id, storeId: store.id },
    });
    const storeBProduct = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-store-b-report-product",
      sku: "REPORT-B",
      name: "Report Store B Product",
      baseUnitId: baseUnit.id,
      storeId: storeB.id,
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { basePriceKgs: new Prisma.Decimal(100) },
    });
    await prisma.product.update({
      where: { id: storeBProduct.id },
      data: { basePriceKgs: new Prisma.Decimal(500) },
    });
    await Promise.all([
      prisma.stockMovement.create({
        data: {
          storeId: store.id,
          productId: product.id,
          type: StockMovementType.SALE,
          qtyDelta: -1,
          createdById: managerUser.id,
        },
      }),
      prisma.stockMovement.create({
        data: {
          storeId: storeB.id,
          productId: storeBProduct.id,
          type: StockMovementType.SALE,
          qtyDelta: -9,
          createdById: adminUser.id,
        },
      }),
      prisma.stockMovement.create({
        data: {
          storeId: store.id,
          productId: product.id,
          type: StockMovementType.ADJUSTMENT,
          qtyDelta: -1,
          createdById: managerUser.id,
        },
      }),
      prisma.stockMovement.create({
        data: {
          storeId: storeB.id,
          productId: storeBProduct.id,
          type: StockMovementType.ADJUSTMENT,
          qtyDelta: -2,
          createdById: adminUser.id,
        },
      }),
    ]);
    const [storeAJob, storeBJob] = await Promise.all([
      prisma.exportJob.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          type: ExportType.PRICE_LIST,
          status: ExportJobStatus.DONE,
          periodStart: new Date("2026-01-01T00:00:00Z"),
          periodEnd: new Date("2026-01-31T23:59:59Z"),
          requestedById: managerUser.id,
        },
      }),
      prisma.exportJob.create({
        data: {
          organizationId: org.id,
          storeId: storeB.id,
          type: ExportType.PRICE_LIST,
          status: ExportJobStatus.DONE,
          periodStart: new Date("2026-01-01T00:00:00Z"),
          periodEnd: new Date("2026-01-31T23:59:59Z"),
          requestedById: adminUser.id,
        },
      }),
    ]);
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: Role.MANAGER,
      organizationId: org.id,
      isOrgOwner: false,
    });

    const shrinkage = await managerCaller.reports.shrinkage({ days: 30 });
    const topProducts = await managerCaller.analytics.topProducts({
      rangeDays: 30,
      metric: "units",
    });
    const exportJobs = await managerCaller.exports.list();
    const storeBExport = await managerCaller.exports.get({ jobId: storeBJob.id });

    expect(shrinkage.map((item) => item.storeId)).toEqual([store.id]);
    expect(topProducts.items.map((item) => item.name)).toContain(product.name);
    expect(topProducts.items.map((item) => item.name)).not.toContain(storeBProduct.name);
    expect(exportJobs.map((job) => job.id)).toContain(storeAJob.id);
    expect(exportJobs.map((job) => job.id)).not.toContain(storeBJob.id);
    expect(storeBExport).toBeNull();
    await expect(managerCaller.reports.shrinkage({ storeId: storeB.id, days: 30 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      managerCaller.analytics.topProducts({ storeId: storeB.id, rangeDays: 30, metric: "units" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      managerCaller.exports.create({
        storeId: storeB.id,
        type: ExportType.PRICE_LIST,
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-01-31T23:59:59Z"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("receives stock into one store without affecting another store", async () => {
    const { org, adminUser, store, baseUnit } = await seedBase({ allowNegativeStock: true });
    const storeB = await prisma.store.create({
      data: { organizationId: org.id, name: "Store B", code: "B" },
    });
    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-stock-scope-product",
      sku: "STOCK-SCOPE",
      name: "Stock Scoped Product",
      baseUnitId: baseUnit.id,
      storeId: storeB.id,
    });

    await adjustStock({
      organizationId: org.id,
      storeId: storeB.id,
      productId: product.id,
      qtyDelta: 5,
      reason: "receive",
      actorId: adminUser.id,
      requestId: "req-stock-scope-adjust",
      idempotencyKey: "stock-scope-adjust",
    });

    const storeASnapshot = await prisma.inventorySnapshot.findFirst({
      where: { storeId: store.id, productId: product.id },
    });
    const storeBSnapshot = await prisma.inventorySnapshot.findFirst({
      where: { storeId: storeB.id, productId: product.id },
    });

    expect(storeASnapshot).toBeNull();
    expect(storeBSnapshot?.onHand).toBe(5);
  });
});
