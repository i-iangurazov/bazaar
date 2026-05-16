import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import {
  arrangeClothingCategoriesWithAi,
  bulkUpdateProductCategory,
  createProduct,
  importProducts,
  updateProduct,
} from "@/server/services/products";
import { computeEan13CheckDigit } from "@/server/services/barcodes";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { adjustStock } from "@/server/services/inventory";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const grantStoreAccess = async (organizationId: string, userId: string, storeId: string) => {
  await prisma.userStoreAccess.createMany({
    data: [{ organizationId, userId, storeId }],
    skipDuplicates: true,
  });
};

describeDb("products", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("auto-generates unique SKU when create input omits it", async () => {
    const { org, adminUser, baseUnit } = await seedBase();

    const first = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-auto-sku-1",
      name: "Auto SKU Product 1",
      baseUnitId: baseUnit.id,
    });

    const second = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-auto-sku-2",
      name: "Auto SKU Product 2",
      baseUnitId: baseUnit.id,
    });

    expect(first.sku).toMatch(/^SKU-\d{6}$/);
    expect(second.sku).toMatch(/^SKU-\d{6}$/);
    expect(first.sku).not.toBe(second.sku);
    expect(Number(second.sku.slice(4))).toBeGreaterThan(Number(first.sku.slice(4)));
  });

  it("applies optional initial on-hand and minimum stock on store product creation", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-initial-stock-create",
      sku: "INITIAL-STOCK-1",
      name: "Initial Stock Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
      initialOnHand: 7,
      minStock: 3,
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
    const movement = await prisma.stockMovement.findFirst({
      where: {
        storeId: store.id,
        productId: product.id,
        type: "ADJUSTMENT",
        referenceId: product.id,
      },
    });
    const policy = await prisma.reorderPolicy.findUnique({
      where: { storeId_productId: { storeId: store.id, productId: product.id } },
    });

    expect(snapshot?.onHand).toBe(7);
    expect(movement?.qtyDelta).toBe(7);
    expect(policy?.minStock).toBe(3);
  });

  it("applies initial on-hand per variant on store product creation", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-variant-initial-stock-create",
      sku: "VARIANT-STOCK-1",
      name: "Variant Stock Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
      variants: [
        { name: "S", attributes: { size: "S" }, initialOnHand: 2 },
        { name: "M", attributes: { size: "M" }, initialOnHand: 5 },
      ],
    });

    const variants = await prisma.productVariant.findMany({
      where: { productId: product.id },
      orderBy: { name: "asc" },
    });
    const snapshots = await prisma.inventorySnapshot.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        variantId: { in: variants.map((variant) => variant.id) },
      },
      orderBy: { variant: { name: "asc" } },
    });
    const movements = await prisma.stockMovement.findMany({
      where: {
        storeId: store.id,
        productId: product.id,
        variantId: { in: variants.map((variant) => variant.id) },
        type: "ADJUSTMENT",
      },
      orderBy: { qtyDelta: "asc" },
    });

    expect(snapshots.map((snapshot) => snapshot.onHand)).toEqual([2, 5]);
    expect(movements.map((movement) => movement.qtyDelta)).toEqual([2, 5]);
  });

  it("duplicates products with selectable photos, fresh SKU, copied store price, and zero stock", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const source = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-duplicate-source",
      sku: "DUP-SOURCE-1",
      name: "Duplicate Source",
      baseUnitId: baseUnit.id,
      storeId: store.id,
      basePriceKgs: 100,
      initialOnHand: 9,
      photoUrl: `/uploads/imported-products/${org.id}/source-main.jpg`,
      images: [
        { url: `/uploads/imported-products/${org.id}/source-main.jpg`, position: 0 },
        { url: `/uploads/imported-products/${org.id}/source-extra.jpg`, position: 1 },
      ],
      barcodes: ["DUP-SOURCE-BARCODE"],
      variants: [{ name: "Large", sku: "DUP-SOURCE-L", attributes: { size: "L" } }],
    });
    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: source.id,
        variantKey: "BASE",
        priceKgs: 1234,
        updatedById: adminUser.id,
      },
    });

    const withoutPhotos = await caller.products.duplicate({
      productId: source.id,
      storeId: store.id,
      copyImages: false,
    });
    const withPhotos = await caller.products.duplicate({
      productId: source.id,
      storeId: store.id,
      copyImages: true,
    });

    const noPhotoProduct = await prisma.product.findUniqueOrThrow({
      where: { id: withoutPhotos.productId },
      include: {
        barcodes: true,
        images: true,
        inventorySnapshots: true,
        storePrices: true,
        storeProducts: true,
        variants: true,
      },
    });
    const photoProduct = await prisma.product.findUniqueOrThrow({
      where: { id: withPhotos.productId },
      include: { images: true },
    });

    expect(noPhotoProduct.sku).not.toBe(source.sku);
    expect(noPhotoProduct.photoUrl).toBeNull();
    expect(noPhotoProduct.images).toHaveLength(0);
    expect(noPhotoProduct.barcodes).toHaveLength(0);
    expect(noPhotoProduct.variants[0]?.sku).toBeNull();
    expect(noPhotoProduct.inventorySnapshots.find((row) => row.storeId === store.id)?.onHand).toBe(
      0,
    );
    expect(noPhotoProduct.storePrices.find((row) => row.storeId === store.id)?.priceKgs.toNumber()).toBe(
      1234,
    );
    expect(noPhotoProduct.storeProducts.find((row) => row.storeId === store.id)?.isActive).toBe(
      true,
    );
    expect(photoProduct.images).toHaveLength(2);
  });

  it("stores multiple categories and keeps the first one as primary", async () => {
    const { org, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-multi-category-create",
      sku: "MULTI-CAT-1",
      name: "Multi Category Product",
      baseUnitId: baseUnit.id,
      categories: ["Phones", "Featured", "Phones"],
    });

    const created = await prisma.product.findUnique({
      where: { id: product.id },
      select: { category: true, categories: true },
    });

    expect(created).toEqual({
      category: "Phones",
      categories: ["Phones", "Featured"],
    });

    await updateProduct({
      productId: product.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-multi-category-update",
      sku: product.sku,
      name: "Multi Category Product",
      baseUnitId: baseUnit.id,
      categories: ["Featured", "Phones", "Clearance"],
      barcodes: [],
    });

    const updated = await prisma.product.findUnique({
      where: { id: product.id },
      select: { category: true, categories: true },
    });

    expect(updated).toEqual({
      category: "Featured",
      categories: ["Featured", "Phones", "Clearance"],
    });
  });

  it("adds bulk categories without replacing the existing primary category", async () => {
    const { org, adminUser, baseUnit } = await seedBase();

    const firstProduct = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-bulk-category-first",
      sku: "BULK-CAT-1",
      name: "Bulk Category Product 1",
      baseUnitId: baseUnit.id,
      categories: ["Phones"],
    });
    const secondProduct = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-bulk-category-second",
      sku: "BULK-CAT-2",
      name: "Bulk Category Product 2",
      baseUnitId: baseUnit.id,
    });

    await bulkUpdateProductCategory({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-bulk-category-add",
      productIds: [firstProduct.id, secondProduct.id],
      category: "Featured",
      mode: "add",
    });

    const afterAdd = await prisma.product.findMany({
      where: { id: { in: [firstProduct.id, secondProduct.id] } },
      orderBy: { sku: "asc" },
      select: { sku: true, category: true, categories: true },
    });

    expect(afterAdd).toEqual([
      {
        sku: "BULK-CAT-1",
        category: "Phones",
        categories: ["Phones", "Featured"],
      },
      {
        sku: "BULK-CAT-2",
        category: "Featured",
        categories: ["Featured"],
      },
    ]);

    await bulkUpdateProductCategory({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-bulk-category-primary",
      productIds: [firstProduct.id],
      category: "Featured",
      mode: "setPrimary",
    });

    const afterPromote = await prisma.product.findUnique({
      where: { id: firstProduct.id },
      select: { category: true, categories: true },
    });

    expect(afterPromote).toEqual({
      category: "Featured",
      categories: ["Featured", "Phones"],
    });
  });

  it("arranges categoryless clothing by gender and inferred category from local product signals", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    await prisma.productCategory.createMany({
      data: [
        { organizationId: org.id, name: "Dresses" },
        { organizationId: org.id, name: "Shoes" },
      ],
    });

    const dress = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-ai-arrange-dress",
      sku: "AI-DRESS-1",
      name: "Платье летнее",
      baseUnitId: baseUnit.id,
      variants: [
        {
          name: "Размер 42",
          sku: "AI-DRESS-1-42",
          attributes: { size: "42" },
        },
      ],
    });
    const shoes = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-ai-arrange-shoes",
      sku: "AI-SHOES-1",
      name: "Кроссовки",
      baseUnitId: baseUnit.id,
      variants: [
        {
          name: "Размер 43",
          sku: "AI-SHOES-1-43",
          attributes: { size: "43" },
        },
      ],
    });

    const result = await arrangeClothingCategoriesWithAi({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-ai-arrange-local",
      productIds: [dress.id, shoes.id],
    });

    expect(result).toMatchObject({
      scanned: 2,
      eligible: 2,
      updated: 2,
      skipped: 0,
      aiUsed: false,
    });

    const updatedProducts = await prisma.product.findMany({
      where: { id: { in: [dress.id, shoes.id] } },
      select: { sku: true, category: true, categories: true },
      orderBy: { sku: "asc" },
    });

    expect(updatedProducts).toEqual([
      {
        sku: "AI-DRESS-1",
        category: "Женщины",
        categories: ["Женщины", "Dresses"],
      },
      {
        sku: "AI-SHOES-1",
        category: "Мужчины",
        categories: ["Мужчины", "Shoes"],
      },
    ]);
  });

  it("does not create ordinary categories that are not already available", async () => {
    const { org, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-ai-arrange-no-new-category",
      sku: "AI-NO-NEW-CATEGORY-1",
      name: "Платье вечернее",
      baseUnitId: baseUnit.id,
      variants: [
        {
          name: "Размер 44",
          sku: "AI-NO-NEW-CATEGORY-1-44",
          attributes: { size: "44" },
        },
      ],
    });

    const result = await arrangeClothingCategoriesWithAi({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-ai-arrange-no-new-category-run",
      productIds: [product.id],
    });

    expect(result).toMatchObject({
      scanned: 1,
      eligible: 1,
      updated: 1,
      skipped: 0,
      aiUsed: false,
    });

    const updated = await prisma.product.findUnique({
      where: { id: product.id },
      select: { category: true, categories: true },
    });
    const categoryNames = await prisma.productCategory.findMany({
      where: { organizationId: org.id },
      select: { name: true },
      orderBy: { name: "asc" },
    });

    expect(updated).toEqual({
      category: "Женщины",
      categories: ["Женщины"],
    });
    expect(categoryNames.map((category) => category.name)).toEqual(["Женщины", "Мужчины"]);
  });

  it("uses AI image fallback with language-insensitive existing ordinary categories only", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    await prisma.productCategory.create({
      data: { organizationId: org.id, name: "Dresses" },
    });
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: Array<{ content?: Array<{ type?: string; text?: string; image_url?: string }> }>;
      };
      const userContent = body.input?.[1]?.content ?? [];
      expect(userContent.some((item) => item.type === "input_image")).toBe(true);
      expect(userContent.find((item) => item.type === "input_text")?.text).toContain("AI-IMAGE-1");
      expect(userContent.find((item) => item.type === "input_text")?.text).toContain(
        "allowedOrdinaryCategories",
      );
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify([
            {
              id: "replace-after-create",
              gender: "WOMEN",
              category: "Платья",
              confidence: 0.91,
              reason: "image",
            },
          ]),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-ai-arrange-image",
      sku: "AI-IMAGE-1",
      name: "Look 2026",
      baseUnitId: baseUnit.id,
      photoUrl: "https://cdn.example.com/products/look-2026.png",
    });

    fetchMock.mockImplementationOnce(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: Array<{ content?: Array<{ type?: string; text?: string; image_url?: string }> }>;
      };
      const userContent = body.input?.[1]?.content ?? [];
      expect(userContent.some((item) => item.type === "input_image")).toBe(true);
      expect(userContent.find((item) => item.type === "input_text")?.text).toContain(product.id);
      expect(userContent.find((item) => item.type === "input_text")?.text).toContain('"Dresses"');
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify([
            {
              id: product.id,
              gender: "WOMEN",
              category: "Платья",
              confidence: 0.91,
              reason: "image",
            },
          ]),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await arrangeClothingCategoriesWithAi({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-ai-arrange-image-run",
      productIds: [product.id],
    });

    expect(result).toMatchObject({
      scanned: 1,
      eligible: 1,
      updated: 1,
      skipped: 0,
      aiUsed: true,
    });

    const updated = await prisma.product.findUnique({
      where: { id: product.id },
      select: { category: true, categories: true },
    });

    expect(updated).toEqual({
      category: "Женщины",
      categories: ["Женщины", "Dresses"],
    });
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

  it("normalizes scanned manufacturer barcodes on product create and rejects short scans", async () => {
    const { org, adminUser, baseUnit } = await seedBase();

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-scanned-barcode-create",
      sku: "SCAN-CREATE-1",
      name: "Scanned Create Product",
      baseUnitId: baseUnit.id,
      barcodes: ["  0000 1234  "],
    });

    await expect(
      prisma.productBarcode.findUnique({
        where: {
          organizationId_value: {
            organizationId: org.id,
            value: "00001234",
          },
        },
      }),
    ).resolves.toMatchObject({ productId: product.id });

    await expect(
      createProduct({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "req-product-scanned-barcode-short",
        sku: "SCAN-CREATE-2",
        name: "Short Barcode Product",
        baseUnitId: baseUnit.id,
        barcodes: ["12"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "barcodeTooShort" });
  });

  it("saves scanned manufacturer barcodes on product edit and finds them through POS scan lookup", async () => {
    const { org, store, adminUser, managerUser, baseUnit } = await seedBase();
    await grantStoreAccess(org.id, managerUser.id, store.id);
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-scanned-barcode-edit-create",
      sku: "SCAN-EDIT-1",
      name: "Scanned Edit Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
    });

    await updateProduct({
      productId: product.id,
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-scanned-barcode-edit-update",
      sku: product.sku,
      name: product.name,
      baseUnitId: baseUnit.id,
      barcodes: ["  9876 5432  "],
    });

    const result = await caller.products.lookupScan({ q: "98765432" });
    expect(result.exactMatch).toBe(true);
    expect(result.items[0]).toMatchObject({ id: product.id, matchType: "barcode" });

    const listResult = await caller.products.list({
      search: "9876 5432",
      page: 1,
      pageSize: 25,
    });
    expect(listResult.items.map((item) => item.id)).toContain(product.id);
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
    const { org, store, adminUser, managerUser, baseUnit } = await seedBase();
    await grantStoreAccess(org.id, managerUser.id, store.id);
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
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
      storeId: store.id,
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

  it("bootstraps products with the resolved single-store context", async () => {
    const { org, store, product, adminUser } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    await prisma.storePrice.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        variantKey: "BASE",
        priceKgs: 777,
      },
    });

    const result = await caller.products.bootstrap({
      page: 1,
      pageSize: 25,
      sortKey: "name",
      sortDirection: "asc",
    });

    const item = result.list.items.find((entry) => entry.id === product.id);

    expect(result.selectedStoreId).toBe(store.id);
    expect(result.stores).toHaveLength(1);
    expect(item?.effectivePriceKgs).toBe(777);
  });

  it("normalizes scanned barcode input while keeping org scoping", async () => {
    const { org, store, adminUser, managerUser, baseUnit } = await seedBase();
    await grantStoreAccess(org.id, managerUser.id, store.id);
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
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
      storeId: store.id,
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

  it("keeps paginated product list ordering stable for default sortable fields", async () => {
    const { org, store, adminUser, managerUser, baseUnit } = await seedBase();
    await grantStoreAccess(org.id, managerUser.id, store.id);
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-list-a",
      sku: "SKU-C",
      name: "Charlie Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
    });
    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-list-b",
      sku: "SKU-A",
      name: "Alpha Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
    });
    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-list-c",
      sku: "SKU-B",
      name: "Bravo Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
    });

    const pageOne = await caller.products.list({
      page: 1,
      pageSize: 2,
      sortKey: "name",
      sortDirection: "asc",
    });
    const pageTwo = await caller.products.list({
      page: 2,
      pageSize: 2,
      sortKey: "name",
      sortDirection: "asc",
    });

    expect(pageOne.total).toBeGreaterThanOrEqual(3);
    expect(pageOne.items.map((item) => item.name)).toEqual(["Alpha Product", "Bravo Product"]);
    expect(pageTwo.items.map((item) => item.name)).toContain("Charlie Product");
  });

  it("ranks product search results by name relevance before alphabetical order", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const aerator = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-search-relevance-aerator",
      sku: "01033",
      name: "Аэратор внут. резьба",
      baseUnitId: baseUnit.id,
    });
    const directThread = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-search-relevance-thread",
      sku: "05318",
      name: "Резьба 15 (10см)",
      baseUnitId: baseUnit.id,
    });

    const result = await caller.products.list({
      search: "Резьба",
      page: 1,
      pageSize: 10,
      sortKey: "name",
      sortDirection: "asc",
    });

    const resultIds = result.items.map((item) => item.id);
    expect(resultIds.indexOf(directThread.id)).toBeLessThan(resultIds.indexOf(aerator.id));
  });

  it("sorts paginated product lists by computed on-hand quantity", async () => {
    const { org, adminUser, baseUnit, store } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const lowQty = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-sort-on-hand-low",
      sku: "SKU-QTY-LOW",
      name: "Low Qty Product",
      baseUnitId: baseUnit.id,
    });
    const midQty = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-sort-on-hand-mid",
      sku: "SKU-QTY-MID",
      name: "Mid Qty Product",
      baseUnitId: baseUnit.id,
    });
    const highQty = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-sort-on-hand-high",
      sku: "SKU-QTY-HIGH",
      name: "High Qty Product",
      baseUnitId: baseUnit.id,
    });

    await adjustStock({
      storeId: store.id,
      productId: lowQty.id,
      qtyDelta: 2,
      reason: "Seed low quantity",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-product-sort-stock-low",
      idempotencyKey: "idem-product-sort-stock-low",
    });
    await adjustStock({
      storeId: store.id,
      productId: midQty.id,
      qtyDelta: 5,
      reason: "Seed mid quantity",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-product-sort-stock-mid",
      idempotencyKey: "idem-product-sort-stock-mid",
    });
    await adjustStock({
      storeId: store.id,
      productId: highQty.id,
      qtyDelta: 9,
      reason: "Seed high quantity",
      actorId: adminUser.id,
      organizationId: org.id,
      requestId: "req-product-sort-stock-high",
      idempotencyKey: "idem-product-sort-stock-high",
    });

    const pageOne = await caller.products.list({
      storeId: store.id,
      page: 1,
      pageSize: 2,
      sortKey: "onHandQty",
      sortDirection: "desc",
    });
    const pageTwo = await caller.products.list({
      storeId: store.id,
      page: 2,
      pageSize: 2,
      sortKey: "onHandQty",
      sortDirection: "desc",
    });

    expect(pageOne.items.map((item) => [item.name, item.onHandQty])).toEqual([
      ["High Qty Product", 9],
      ["Mid Qty Product", 5],
    ]);
    expect(pageTwo.items[0]).toMatchObject({
      name: "Low Qty Product",
      onHandQty: 2,
    });
  });

  it("returns detailed product reads with numeric prices and variant delete flags", async () => {
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
      requestId: "req-product-detail-read",
      sku: "SKU-DETAIL-1",
      name: "Detail Read Product",
      category: "Tea",
      categories: ["Tea", "Featured"],
      baseUnitId: baseUnit.id,
      basePriceKgs: 180,
      avgCostKgs: 125,
      description: "Detailed product description for contract coverage.",
      barcodes: ["DETAIL-001"],
      variants: [{ name: "Large", sku: "SKU-DETAIL-1-L" }],
    });

    const detail = await caller.products.getById({ productId: product.id });

    expect(detail).toMatchObject({
      id: product.id,
      sku: "SKU-DETAIL-1",
      name: "Detail Read Product",
      category: "Tea",
      categories: ["Tea", "Featured"],
      basePriceKgs: 180,
      avgCostKgs: 125,
      purchasePriceKgs: 125,
      barcodes: ["DETAIL-001"],
      baseUnitId: baseUnit.id,
      baseUnit: {
        id: baseUnit.id,
      },
    });
    expect(detail?.variants).toHaveLength(1);
    expect(detail?.variants[0]).toMatchObject({
      name: "Large",
      canDelete: true,
    });
  });

  it("exports import-ready product data with categories, prices, images, variants and barcodes", async () => {
    const { org, adminUser, baseUnit, store } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const product = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-export-rich",
      sku: "SKU-EXPORT-1",
      name: "Export Rich Product",
      category: "Women",
      categories: ["Women", "Shoes"],
      baseUnitId: baseUnit.id,
      basePriceKgs: 200,
      avgCostKgs: 125,
      description: "Exported product description.",
      photoUrl: "https://cdn.example.com/products/export-main.jpg",
      images: [{ url: "https://cdn.example.com/products/export-detail.jpg", position: 1 }],
      barcodes: ["EXPORT-BC-1", "EXPORT-BC-2"],
      variants: [{ name: "M", sku: "SKU-EXPORT-1-M", attributes: { size: "M", color: "Black" } }],
    });

    await prisma.reorderPolicy.create({
      data: {
        storeId: store.id,
        productId: product.id,
        minStock: 8,
        leadTimeDays: 7,
        reviewPeriodDays: 7,
        safetyStockDays: 3,
        minOrderQty: 0,
      },
    });
    await prisma.purchaseOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        status: "RECEIVED",
        receivedAt: new Date(),
        lines: {
          create: {
            productId: product.id,
            qtyOrdered: 1,
            qtyReceived: 1,
            unitCost: 140,
          },
        },
      },
    });

    const csv = await caller.products.exportCsv({ storeId: store.id });
    const workbook = XLSX.read(csv, { type: "string" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false,
    });
    const header = (rows[0] ?? []).map((cell, index) =>
      index === 0 ? cell.replace(/^\uFEFF/, "") : cell,
    );
    const exported = rows.find((row) => row[0] === "SKU-EXPORT-1");

    expect(header).toEqual([
      "SKU",
      "Название",
      "Ед. измерения",
      "Категории",
      "Описание",
      "Цена продажи",
      "Цена закупки",
      "Себестоимость",
      "Минимальный остаток",
      "Фото / ссылки на изображения",
      "Варианты",
      "Штрихкоды",
    ]);
    expect(exported).toBeDefined();
    const byHeader = new Map(header.map((label, index) => [label, exported?.[index]]));
    expect(byHeader.get("Категории")).toBe("Women, Shoes");
    expect(byHeader.get("Цена продажи")).toBe("200");
    expect(byHeader.get("Цена закупки")).toBe("140");
    expect(byHeader.get("Себестоимость")).toBe("125");
    expect(byHeader.get("Минимальный остаток")).toBe("8");
    expect(byHeader.get("Фото / ссылки на изображения")).toContain("export-main.jpg");
    expect(byHeader.get("Фото / ссылки на изображения")).toContain("export-detail.jpg");
    expect(JSON.parse(byHeader.get("Варианты") ?? "[]")).toEqual([
      { name: "M", sku: "SKU-EXPORT-1-M", size: "M", color: "Black" },
    ]);
    expect(byHeader.get("Штрихкоды")).toBe("EXPORT-BC-1, EXPORT-BC-2");
  });

  it("reflects create, update, archive, and restore flows in subsequent product lists", async () => {
    const { org, store, managerUser, baseUnit } = await seedBase();
    await grantStoreAccess(org.id, managerUser.id, store.id);
    const caller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const created = await caller.products.create({
      sku: "SKU-LIST-FLOW",
      name: "List Flow Product",
      category: "Initial",
      baseUnitId: baseUnit.id,
      basePriceKgs: 199,
      barcodes: ["LIST-FLOW-001"],
      storeId: store.id,
    });

    const afterCreate = await caller.products.list({
      search: "SKU-LIST-FLOW",
      page: 1,
      pageSize: 25,
    });
    expect(afterCreate.items.find((item) => item.id === created.id)).toMatchObject({
      name: "List Flow Product",
      category: "Initial",
      isDeleted: false,
    });

    await caller.products.update({
      productId: created.id,
      sku: "SKU-LIST-FLOW",
      name: "List Flow Product Updated",
      category: "Updated",
      categories: ["Updated", "Featured"],
      baseUnitId: baseUnit.id,
      basePriceKgs: 249,
      barcodes: ["LIST-FLOW-001"],
    });

    const afterUpdate = await caller.products.list({
      search: "Updated",
      page: 1,
      pageSize: 25,
    });
    expect(afterUpdate.items.find((item) => item.id === created.id)).toMatchObject({
      name: "List Flow Product Updated",
      category: "Updated",
      basePriceKgs: 249,
      isDeleted: false,
    });

    await caller.products.archive({ productId: created.id });

    const activeListAfterArchive = await caller.products.list({
      search: "SKU-LIST-FLOW",
      page: 1,
      pageSize: 25,
    });
    expect(activeListAfterArchive.items.find((item) => item.id === created.id)).toBeUndefined();

    const archivedList = await caller.products.list({
      search: "SKU-LIST-FLOW",
      includeArchived: true,
      page: 1,
      pageSize: 25,
    });
    expect(archivedList.items.find((item) => item.id === created.id)).toMatchObject({
      name: "List Flow Product Updated",
      isDeleted: true,
    });

    await caller.products.restore({ productId: created.id });

    const afterRestore = await caller.products.list({
      search: "SKU-LIST-FLOW",
      page: 1,
      pageSize: 25,
    });
    expect(afterRestore.items.find((item) => item.id === created.id)).toMatchObject({
      name: "List Flow Product Updated",
      category: "Updated",
      isDeleted: false,
    });
  });

  it("orders product lists by the most recently edited products by default", async () => {
    const { org, adminUser, baseUnit, product } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    const older = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-products-sort-older",
      sku: "SORT-OLDER",
      name: "Older Sort Product",
      baseUnitId: baseUnit.id,
    });
    const newer = await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-products-sort-newer",
      sku: "SORT-NEWER",
      name: "Newer Sort Product",
      baseUnitId: baseUnit.id,
    });
    await prisma.$executeRaw`
      UPDATE "Product"
      SET "updatedAt" = CASE
        WHEN id = ${product.id} THEN ${new Date("2024-01-01T00:00:00.000Z")}
        WHEN id = ${older.id} THEN ${new Date("2024-02-01T00:00:00.000Z")}
        WHEN id = ${newer.id} THEN ${new Date("2024-03-01T00:00:00.000Z")}
        ELSE "updatedAt"
      END
      WHERE id IN (${product.id}, ${older.id}, ${newer.id})
    `;

    const initialList = await caller.products.list({ page: 1, pageSize: 3 });
    expect(initialList.items.map((item) => item.id)).toEqual([newer.id, older.id, product.id]);

    await caller.products.update({
      productId: older.id,
      sku: older.sku,
      name: "Older Sort Product Edited",
      baseUnitId: baseUnit.id,
    });

    const afterEdit = await caller.products.list({ page: 1, pageSize: 3 });
    expect(afterEdit.items[0]?.id).toBe(older.id);
  });

  it("allows admins to permanently delete unused products and blocks products with history", async () => {
    const { org, store, adminUser, managerUser, baseUnit } = await seedBase();
    await grantStoreAccess(org.id, managerUser.id, store.id);
    const adminCaller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });
    const managerCaller = createTestCaller({
      id: managerUser.id,
      email: managerUser.email,
      role: managerUser.role,
      organizationId: org.id,
    });

    const unused = await adminCaller.products.create({
      sku: "DELETE-UNUSED",
      name: "Delete Unused Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
      barcodes: ["DELETE-UNUSED-BC"],
    });

    await expect(
      managerCaller.products.deletePermanent({ productId: unused.id }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await adminCaller.products.deletePermanent({ productId: unused.id });
    await expect(prisma.product.findUnique({ where: { id: unused.id } })).resolves.toBeNull();
    await expect(prisma.productBarcode.count({ where: { productId: unused.id } })).resolves.toBe(0);

    const withHistory = await adminCaller.products.create({
      sku: "DELETE-HISTORY",
      name: "Delete History Product",
      baseUnitId: baseUnit.id,
      storeId: store.id,
      initialOnHand: 1,
    });

    await expect(
      adminCaller.products.deletePermanent({ productId: withHistory.id }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "productDeleteBlockedByHistory",
    });
  });

  it("returns duplicate diagnostics for exact sku, barcode, and normalized-name matches", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const caller = createTestCaller({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      organizationId: org.id,
    });

    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-dup-sku",
      sku: "DUP-SKU-1",
      name: "SKU Collision Product",
      baseUnitId: baseUnit.id,
    });
    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-dup-barcode",
      sku: "DUP-BARCODE-1",
      name: "Barcode Collision Product",
      baseUnitId: baseUnit.id,
      barcodes: ["00001234"],
    });
    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-dup-name",
      sku: "DUP-NAME-1",
      name: "Apple iPhone 15 Pro",
      baseUnitId: baseUnit.id,
    });

    const diagnostics = await caller.products.duplicateDiagnostics({
      sku: "DUP-SKU-1",
      name: " Apple   iPhone-15   Pro ",
      barcodes: [" 0000 1234 "],
    });

    expect(diagnostics.exactSkuMatch).toMatchObject({
      sku: "DUP-SKU-1",
      name: "SKU Collision Product",
    });
    expect(diagnostics.exactBarcodeMatches).toEqual([
      expect.objectContaining({
        barcode: "00001234",
        sku: "DUP-BARCODE-1",
      }),
    ]);
    expect(diagnostics.likelyNameMatches).toEqual([
      expect.objectContaining({
        sku: "DUP-NAME-1",
        name: "Apple iPhone 15 Pro",
      }),
    ]);
  });

  it("avoids false-positive duplicate diagnostics and excludes the current product on edit", async () => {
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
      requestId: "req-product-dup-self",
      sku: "SELF-DUP-1",
      name: "Fresh Milk 1L",
      baseUnitId: baseUnit.id,
      barcodes: ["SELF-BC-1"],
    });
    await createProduct({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-product-dup-other",
      sku: "OTHER-DUP-1",
      name: "Fresh Milk 2L",
      baseUnitId: baseUnit.id,
    });

    const falsePositiveCheck = await caller.products.duplicateDiagnostics({
      name: "Fresh Milk 500ml",
    });
    expect(falsePositiveCheck.likelyNameMatches).toEqual([]);

    const selfCheck = await caller.products.duplicateDiagnostics({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      barcodes: ["SELF-BC-1"],
    });

    expect(selfCheck.exactSkuMatch).toBeNull();
    expect(selfCheck.exactBarcodeMatches).toEqual([]);
    expect(selfCheck.likelyNameMatches).toEqual([]);
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
        productIds: [productWithoutBarcodeA.id, productWithBarcode.id, productWithoutBarcodeC.id],
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

  it("initializes base snapshots only for the targeted store in multi-store orgs", async () => {
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
      storeId: store.id,
    });

    const snapshots = await prisma.inventorySnapshot.findMany({
      where: { productId: product.id },
      orderBy: { storeId: "asc" },
    });
    expect(snapshots).toHaveLength(1);
    const snapshotByStore = new Map(snapshots.map((snapshot) => [snapshot.storeId, snapshot]));
    expect(snapshotByStore.get(store.id)?.allowNegativeStock).toBe(false);
    expect(snapshotByStore.get(storeB.id)).toBeUndefined();

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
      storeId: storeB.id,
    });

    const imported = await prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: org.id, sku: "SKU-SNAP-2" } },
    });
    expect(imported).not.toBeNull();
    const importSnapshots = await prisma.inventorySnapshot.findMany({
      where: { productId: imported!.id },
    });
    expect(importSnapshots).toHaveLength(1);
    expect(importSnapshots[0]?.storeId).toBe(storeB.id);
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
