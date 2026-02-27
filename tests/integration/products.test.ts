import { beforeEach, describe, expect, it } from "vitest";

import { createProduct, importProducts, updateProduct } from "@/server/services/products";
import { computeEan13CheckDigit } from "@/server/services/barcodes";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { adjustStock } from "@/server/services/inventory";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("products", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("enforces barcode uniqueness within an organization", async () => {
    const { org, adminUser, baseUnit } = await seedBase();

    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-1",
      sku: "SKU-1",
      name: "Test Product 1",
      baseUnitId: baseUnit.id,
      barcodes: ["ABC-123"],
    });

    await expect(
      createProduct({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "req-product-2",
        sku: "SKU-2",
        name: "Test Product 2",
        baseUnitId: baseUnit.id,
        barcodes: ["ABC-123"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows the same barcode across different organizations", async () => {
    const { org, adminUser, baseUnit } = await seedBase();

    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-1",
      sku: "SKU-1",
      name: "Test Product 1",
      baseUnitId: baseUnit.id,
      barcodes: ["ABC-123"],
    });

    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    const otherUser = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        email: "admin2@test.local",
        name: "Admin 2",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });
    const otherBaseUnit = await prisma.unit.create({
      data: {
        organizationId: otherOrg.id,
        code: "each",
        labelRu: "each",
        labelKg: "each",
      },
    });

    await expect(
      createProduct({
        organizationId: otherOrg.id,
        actorId: otherUser.id,
        requestId: "req-product-3",
        sku: "SKU-3",
        name: "Test Product 3",
        baseUnitId: otherBaseUnit.id,
        barcodes: ["ABC-123"],
      }),
    ).resolves.toMatchObject({ sku: "SKU-3" });
  });

  it("finds products by barcode within the organization", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-barcode",
      sku: "SKU-BC-1",
      name: "Barcode Product",
      baseUnitId: baseUnit.id,
      barcodes: ["BAR-001"],
    });

    const found = await caller.products.findByBarcode({ value: "BAR-001" });
    expect(found).toMatchObject({ id: product.id, sku: "SKU-BC-1" });

    const otherOrg = await prisma.organization.create({ data: { name: "Other Org 2" } });
    const otherUser = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        email: "admin3@test.local",
        name: "Admin 3",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });
    const otherCaller = createTestCaller({
      id: otherUser.id,
      email: otherUser.email,
      role: otherUser.role,
      organizationId: otherOrg.id,
    });

    const notFound = await otherCaller.products.findByBarcode({ value: "BAR-001" });
    expect(notFound).toBeNull();
  });

  it("normalizes scanned barcode input while keeping org scoping", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-barcode-normalized",
      sku: "SKU-BC-2",
      name: "Barcode Product Normalized",
      baseUnitId: baseUnit.id,
      barcodes: ["00001234"],
    });

    const found = await caller.products.findByBarcode({ value: "  0000 1234  " });
    expect(found).toMatchObject({ id: product.id, sku: "SKU-BC-2" });

    const otherOrg = await prisma.organization.create({ data: { name: "Other Org 4" } });
    const otherUser = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        email: "admin4@test.local",
        name: "Admin 4",
        passwordHash: "hash",
        role: "ADMIN",
      },
    });
    const otherCaller = createTestCaller({
      id: otherUser.id,
      email: otherUser.email,
      role: otherUser.role,
      organizationId: otherOrg.id,
    });

    const notFound = await otherCaller.products.findByBarcode({ value: "00001234" });
    expect(notFound).toBeNull();
  });

  it("resolves scan lookup by exact barcode", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-scan",
      sku: "SKU-SCAN-1",
      name: "Scan Product",
      baseUnitId: baseUnit.id,
      barcodes: ["SCAN-001"],
    });

    const result = await caller.products.lookupScan({ q: "SCAN-001" });
    expect(result.exactMatch).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: product.id, matchType: "barcode" });
  });

  it("generates a unique EAN-13 barcode for a product", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-generate-barcode",
      sku: "SKU-GEN-1",
      name: "Generate Barcode Product",
      baseUnitId: baseUnit.id,
    });

    const generated = await caller.products.generateBarcode({
      productId: product.id,
      mode: "EAN13",
    });

    expect(/^\d{13}$/.test(generated.value)).toBe(true);
    expect(generated.value[12]).toBe(computeEan13CheckDigit(generated.value.slice(0, 12)));

    const stored = await prisma.productBarcode.findMany({
      where: { organizationId: org.id, productId: product.id },
      select: { value: true },
    });
    expect(stored.map((row) => row.value)).toContain(generated.value);
  });

  it("replaces existing barcode when force generation is enabled", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-force-barcode",
      sku: "SKU-FORCE-1",
      name: "Force Barcode Product",
      baseUnitId: baseUnit.id,
      barcodes: ["FORCE-OLD-001"],
    });

    const generated = await caller.products.generateBarcode({
      productId: product.id,
      mode: "EAN13",
      force: true,
    });

    expect(generated.barcodes).toEqual([generated.value]);
    const stored = await prisma.productBarcode.findMany({
      where: { organizationId: org.id, productId: product.id },
      select: { value: true },
      orderBy: { createdAt: "asc" },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.value).toBe(generated.value);
  });

  it("bulk generates barcodes only for products missing barcode", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const productWithoutBarcodeA = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-bulk-barcode-a",
      sku: "SKU-BULK-A",
      name: "Bulk Product A",
      baseUnitId: baseUnit.id,
    });
    const productWithBarcode = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-bulk-barcode-b",
      sku: "SKU-BULK-B",
      name: "Bulk Product B",
      baseUnitId: baseUnit.id,
      barcodes: ["BULK-EXISTING-1"],
    });
    const productWithoutBarcodeC = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-bulk-barcode-c",
      sku: "SKU-BULK-C",
      name: "Bulk Product C",
      baseUnitId: baseUnit.id,
    });

    const result = await caller.products.bulkGenerateBarcodes({
      mode: "CODE128",
      filter: {
        productIds: [
          productWithoutBarcodeA.id,
          productWithBarcode.id,
          productWithoutBarcodeC.id,
        ],
      },
    });

    expect(result.generatedCount).toBe(2);
    expect(result.skippedCount).toBe(1);

    const generatedRows = await prisma.productBarcode.findMany({
      where: {
        organizationId: org.id,
        productId: { in: [productWithoutBarcodeA.id, productWithoutBarcodeC.id] },
      },
      select: { value: true },
    });
    expect(generatedRows.every((row) => row.value.startsWith("BZ"))).toBe(true);
  });

  it("initializes base snapshots for create and import across stores", async () => {
    const { org, adminUser, store, baseUnit } = await seedBase();

    const storeB = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Secondary Store",
        code: "SEC",
        allowNegativeStock: true,
      },
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-snap",
      sku: "SKU-SNAP-1",
      name: "Snapshot Product",
      baseUnitId: baseUnit.id,
    });

    const snapshots = await prisma.inventorySnapshot.findMany({
      where: { productId: product.id },
      orderBy: { storeId: "asc" },
    });
    expect(snapshots).toHaveLength(2);
    const snapshotByStore = new Map(snapshots.map((snapshot) => [snapshot.storeId, snapshot]));
    expect(snapshotByStore.get(store.id)?.allowNegativeStock).toBe(false);
    expect(snapshotByStore.get(storeB.id)?.allowNegativeStock).toBe(true);

    await importProducts({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-import",
      rows: [
        {
          sku: "SKU-SNAP-2",
          name: "Imported Product",
          unit: baseUnit.code,
          barcodes: ["IMP-001"],
        },
      ],
    });

    const imported = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: "SKU-SNAP-2" } },
    });
    expect(imported).not.toBeNull();
    const importSnapshots = await prisma.inventorySnapshot.findMany({
      where: { productId: imported!.id },
    });
    expect(importSnapshots).toHaveLength(2);
  });

  it("blocks variant removal when movements exist", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-variant",
      sku: "SKU-VAR-1",
      name: "Variant Product",
      baseUnitId: baseUnit.id,
      variants: [{ name: "Red", sku: "SKU-VAR-1-RED" }],
    });

    const variant = await prisma.productVariant.findFirst({
      where: { productId: product.id, isActive: true },
    });

    expect(variant).not.toBeNull();

    await adjustStock({
      storeId: store.id,
      productId: product.id,
      variantId: variant?.id ?? undefined,
      qtyDelta: 3,
      reason: "Seed",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-variant-stock",
      idempotencyKey: "idem-variant-stock",
    });

    await expect(
      updateProduct({
        productId: product.id,
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "req-variant-update",
        sku: product.sku,
        name: product.name,
        baseUnitId: baseUnit.id,
        variants: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
