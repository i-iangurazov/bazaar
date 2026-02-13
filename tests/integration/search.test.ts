import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("search router", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns command palette results scoped to the current organization", async () => {
    const { org, store, supplier, product, adminUser, baseUnit } = await seedBase();

    await prisma.store.update({
      where: { id: store.id },
      data: { name: "Acme Store", code: "ACM" },
    });
    await prisma.supplier.update({
      where: { id: supplier.id },
      data: { name: "Acme Supply" },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { name: "Acme Product", sku: "AC-001" },
    });

    await prisma.productBarcode.create({
      data: {
        organizationId: org.id,
        productId: product.id,
        value: "AC-BARCODE-001",
      },
    });

    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        supplierId: supplier.id,
      },
    });

    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    const otherUnit = await prisma.unit.create({
      data: {
        organizationId: otherOrg.id,
        code: "oth-each",
        labelRu: "шт",
        labelKg: "даана",
      },
    });
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: "Acme Hidden Store",
        code: "ACX",
      },
    });
    const otherSupplier = await prisma.supplier.create({
      data: {
        organizationId: otherOrg.id,
        name: "Acme Hidden Supplier",
      },
    });
    const otherProduct = await prisma.product.create({
      data: {
        organizationId: otherOrg.id,
        supplierId: otherSupplier.id,
        sku: "AC-HIDDEN-001",
        name: "Acme Hidden Product",
        unit: otherUnit.code,
        baseUnitId: otherUnit.id,
      },
    });

    await prisma.productBarcode.create({
      data: {
        organizationId: otherOrg.id,
        productId: otherProduct.id,
        value: "AC-HIDDEN-BARCODE",
      },
    });

    await prisma.purchaseOrder.create({
      data: {
        organizationId: otherOrg.id,
        storeId: otherStore.id,
        supplierId: otherSupplier.id,
      },
    });

    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    const result = await caller.search.global({ q: "ac" });
    const productResult = result.results.find((item) => item.type === "product" && item.id === product.id);
    const supplierResult = result.results.find((item) => item.type === "supplier" && item.id === supplier.id);
    const storeResult = result.results.find((item) => item.type === "store" && item.id === store.id);
    const poResult = result.results.find((item) => item.type === "purchaseOrder" && item.id === po.id);

    expect(productResult?.href).toBe(`/products/${product.id}`);
    expect(supplierResult?.href).toBe("/suppliers");
    expect(storeResult?.href).toBe("/stores");
    expect(poResult?.href).toBe(`/purchase-orders/${po.id}`);

    expect(result.results.some((item) => item.id === otherProduct.id)).toBe(false);
    expect(result.results.some((item) => item.label.includes("Hidden"))).toBe(false);
  });

  it("requires at least 2 characters", async () => {
    const { org, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
      isOrgOwner: true,
    });

    await expect(caller.search.global({ q: "a" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
