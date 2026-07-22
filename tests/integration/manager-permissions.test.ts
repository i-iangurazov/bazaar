import { beforeEach, describe, expect, it } from "vitest";
import { PurchaseOrderStatus, StockCountStatus } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("manager operational permissions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows managers to manage product support data", async () => {
    const { org, store, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const unit = await caller.units.create({
      code: "box",
      labelRu: "коробка",
      labelKg: "куту",
    });
    const updatedUnit = await caller.units.update({
      unitId: unit.id,
      labelRu: "кор.",
      labelKg: "кут.",
    });
    expect(updatedUnit.labelRu).toBe("кор.");

    const category = await caller.productCategories.create({ name: "Shoes" });
    expect(category.name).toBe("Shoes");
    await caller.attributes.create({
      key: "size",
      labelRu: "Размер",
      labelKg: "Өлчөм",
      type: "TEXT",
    });
    await caller.attributes.create({
      key: "color",
      labelRu: "Цвет",
      labelKg: "Түс",
      type: "TEXT",
    });

    const template = await caller.categoryTemplates.set({
      category: "Shoes",
      attributeKeys: ["size", "color"],
    });
    expect(template.map((row) => row.attributeKey)).toEqual(["size", "color"]);

    await caller.categoryTemplates.remove({ category: "Shoes" });
    await caller.productCategories.remove({ name: "Shoes", storeId: store.id });
    await expect(
      prisma.storeCategoryPreference.findUniqueOrThrow({
        where: {
          storeId_normalizedName: {
            storeId: store.id,
            normalizedName: "shoes",
          },
        },
      }),
    ).resolves.toMatchObject({ isArchived: true, isVisibleInForms: false });
    await expect(
      prisma.productCategory.findUnique({
        where: { organizationId_name: { organizationId: org.id, name: "Shoes" } },
      }),
    ).resolves.toMatchObject({ id: category.id });
    await caller.units.remove({ unitId: unit.id });
  });

  it("allows managers to manage master products", async () => {
    const { org, baseUnit, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const created = await caller.products.create({
      idempotencyKey: "manager-product-create",
      sku: "MGR-PRODUCT-1",
      name: "Manager Product",
      baseUnitId: baseUnit.id,
      basePriceKgs: 1200,
      avgCostKgs: 700,
      categories: ["Shoes"],
    });
    expect(created.name).toBe("Manager Product");

    const updated = await caller.products.update({
      productId: created.id,
      sku: "MGR-PRODUCT-1",
      name: "Manager Product Updated",
      baseUnitId: baseUnit.id,
      basePriceKgs: 1300,
      avgCostKgs: 800,
      categories: ["Shoes", "Sale"],
      barcodes: ["1234567890123"],
    });
    expect(updated.name).toBe("Manager Product Updated");
    expect(updated.categories).toEqual(["Shoes", "Sale"]);

    await caller.products.archive({ productId: created.id });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({ isDeleted: true });

    await caller.products.restore({ productId: created.id });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({ isDeleted: false });
  });

  it("allows managers to manually adjust inventory in accessible stores", async () => {
    const { org, store, product, baseUnit, managerUser } = await seedBase();
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.products.create({
        idempotencyKey: "manager-stock-product-create",
        sku: "MGR-STOCK-1",
        name: "Manager Stock Product",
        baseUnitId: baseUnit.id,
        basePriceKgs: 100,
        initialOnHand: 5,
        categories: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "inventoryAdminRequired" });

    const adjustment = await caller.inventory.adjust({
      storeId: store.id,
      productId: product.id,
      qtyDelta: 1,
      reason: "manual test adjustment",
      idempotencyKey: "manager-stock-adjust",
    });
    const snapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(adjustment.onHand).toBe(1);
    expect(snapshot?.onHand).toBe(1);
  });

  it("allows managers to create and post inventory documents", async () => {
    const { org, store, supplier, product, managerUser } = await seedBase({ plan: "BUSINESS" });
    const transferStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Transfer Store",
        code: "TRN",
        allowNegativeStock: false,
      },
    });
    await prisma.userStoreAccess.create({
      data: {
        organizationId: org.id,
        userId: managerUser.id,
        storeId: transferStore.id,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: transferStore.id,
        productId: product.id,
        isActive: true,
        assignedById: managerUser.id,
      },
    });

    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await expect(
      caller.inventory.receive({
        storeId: store.id,
        productId: product.id,
        qtyReceived: 10,
        idempotencyKey: "manager-direct-receive",
      }),
    ).resolves.toMatchObject({ onHand: 10 });

    await expect(
      caller.inventory.postStockReceiving({
        storeId: store.id,
        referenceNumber: "MGR-RCV-1",
        lines: [{ productId: product.id, quantity: 5, unitCost: 100 }],
        idempotencyKey: "manager-stock-receiving",
      }),
    ).resolves.toMatchObject({ storeId: store.id, lineCount: 1, totalQuantity: 5 });

    await expect(
      caller.inventory.transfer({
        fromStoreId: store.id,
        toStoreId: transferStore.id,
        productId: product.id,
        qty: 3,
        idempotencyKey: "manager-stock-transfer",
      }),
    ).resolves.toMatchObject({
      fromStoreId: store.id,
      toStoreId: transferStore.id,
      lineCount: 1,
      totalQuantity: 3,
    });

    await expect(
      caller.inventory.postStockWriteOff({
        storeId: store.id,
        reason: "Другое",
        comment: "manager permission test",
        lines: [{ productId: product.id, qty: 1 }],
        idempotencyKey: "manager-stock-writeoff",
      }),
    ).resolves.toMatchObject({ storeId: store.id, lineCount: 1, totalQuantity: 1 });

    const stockCount = await caller.stockCounts.create({
      storeId: store.id,
      notes: "manager count",
    });
    await caller.stockCounts.addOrUpdateLineByScan({
      idempotencyKey: "manager-stock-count-scan",
      stockCountId: stockCount.id,
      storeId: store.id,
      barcodeOrQuery: product.sku,
      mode: "set",
      countedQty: 9,
    });
    await expect(
      caller.stockCounts.applyCount({
        stockCountId: stockCount.id,
        idempotencyKey: "manager-stock-count-apply",
      }),
    ).resolves.toMatchObject({ applied: true, adjustments: 1 });
    await expect(
      prisma.stockCount.findUniqueOrThrow({ where: { id: stockCount.id } }),
    ).resolves.toMatchObject({ status: StockCountStatus.APPLIED });

    const purchaseOrder = await caller.purchaseOrders.create({
      idempotencyKey: "manager-purchase-order-create",
      storeId: store.id,
      supplierId: supplier.id,
      lines: [{ productId: product.id, qtyOrdered: 2, unitCost: 100 }],
      submit: false,
    });
    await caller.purchaseOrders.submit({ purchaseOrderId: purchaseOrder.id });
    await caller.purchaseOrders.approve({ purchaseOrderId: purchaseOrder.id });
    await expect(
      caller.purchaseOrders.receive({
        purchaseOrderId: purchaseOrder.id,
        idempotencyKey: "manager-purchase-order-receive",
      }),
    ).resolves.toMatchObject({ id: purchaseOrder.id, status: PurchaseOrderStatus.RECEIVED });

    const sourceSnapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: store.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });
    const transferSnapshot = await prisma.inventorySnapshot.findUnique({
      where: {
        storeId_productId_variantKey: {
          storeId: transferStore.id,
          productId: product.id,
          variantKey: "BASE",
        },
      },
    });

    expect(sourceSnapshot?.onHand).toBe(11);
    expect(transferSnapshot?.onHand).toBe(3);
  });

  it("requires administrators to manage registers", async () => {
    const { org, store, managerUser, adminUser } = await seedBase({ plan: "BUSINESS" });
    await prisma.userStoreAccess.createMany({
      data: [{ organizationId: org.id, userId: managerUser.id, storeId: store.id }],
      skipDuplicates: true,
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Other Store",
        code: "OTH",
        allowNegativeStock: false,
      },
    });
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });
    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    await expect(
      managerCaller.pos.registers.create({
        storeId: store.id,
        name: "Manager register",
        code: "manager",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "forbidden" });

    const register = await adminCaller.pos.registers.create({
      storeId: store.id,
      name: "Front",
      code: "front",
    });
    expect(register.code).toBe("FRONT");

    const updated = await adminCaller.pos.registers.update({
      registerId: register.id,
      name: "Front Desk",
    });
    expect(updated.name).toBe("Front Desk");

    await adminCaller.pos.registers.update({
      registerId: register.id,
      isActive: false,
    });
    const activeRegisters = await adminCaller.pos.registers.list();
    expect(activeRegisters.map((item) => item.id)).not.toContain(register.id);

    const inactiveRegisters = await adminCaller.pos.registers.list({ status: "inactive" });
    expect(inactiveRegisters.map((item) => item.id)).toContain(register.id);

    const allRegisters = await adminCaller.pos.registers.list({ status: "all" });
    expect(allRegisters.map((item) => item.id)).toContain(register.id);

    const tempRegister = await adminCaller.pos.registers.create({
      storeId: store.id,
      name: "Temporary",
      code: "temp",
    });
    await expect(
      adminCaller.pos.registers.delete({ registerId: tempRegister.id }),
    ).resolves.toMatchObject({ deleted: true, id: tempRegister.id });

    const historyRegister = await adminCaller.pos.registers.create({
      storeId: store.id,
      name: "History",
      code: "hist",
    });
    await prisma.registerShift.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        registerId: historyRegister.id,
        openedById: adminUser.id,
        openingCashKgs: 0,
      },
    });
    await expect(
      adminCaller.pos.registers.delete({ registerId: historyRegister.id }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "posRegisterDeleteBlockedByHistory" });

    await expect(
      managerCaller.pos.registers.create({
        storeId: otherStore.id,
        name: "Back",
        code: "back",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "forbidden" });
  });
});
