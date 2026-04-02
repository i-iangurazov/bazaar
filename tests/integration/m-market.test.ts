import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttributeType, MMarketEnvironment, MMarketExportJobStatus } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import {
  __buildMMarketExportPlanForTests,
  __resetMMarketCooldownForTests,
  assignDefaultCategoryToMMarketProducts,
  listMMarketProducts,
  requestMMarketExport,
  runMMarketPreflight,
  updateMMarketBranchMappings,
  updateMMarketConnection,
  updateMMarketProductSelection,
} from "@/server/services/mMarket";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const prepareReadyMMarketData = async () => {
  const { org, store, product, adminUser, supplier, baseUnit } = await seedBase();

  await prisma.product.update({
    where: { id: product.id },
    data: {
      name: "Smartphone Basic",
      category: "Phones",
      basePriceKgs: 1200,
      description:
        "Надежный смартфон для ежедневного использования с хорошей автономностью, стабильной связью, ярким экраном, прочным корпусом и понятным интерфейсом для повседневных задач.",
      photoUrl: "https://cdn.example.com/images/test-1.jpg",
    },
  });

  await prisma.productImage.createMany({
    data: [
      {
        organizationId: org.id,
        productId: product.id,
        url: "https://cdn.example.com/images/test-2.jpg",
        position: 0,
      },
      {
        organizationId: org.id,
        productId: product.id,
        url: "https://cdn.example.com/images/test-3.png",
        position: 1,
      },
    ],
  });

  await prisma.inventorySnapshot.create({
    data: {
      storeId: store.id,
      productId: product.id,
      variantKey: "BASE",
      onHand: 5,
      onOrder: 0,
      allowNegativeStock: store.allowNegativeStock,
    },
  });

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      name: "Base",
      attributes: {},
      isActive: true,
    },
  });

  await prisma.attributeDefinition.create({
    data: {
      organizationId: org.id,
      key: "material",
      labelRu: "Материал",
      labelKg: "Материал",
      type: AttributeType.TEXT,
      required: true,
      isActive: true,
    },
  });

  await prisma.categoryAttributeTemplate.create({
    data: {
      organizationId: org.id,
      category: "Phones",
      attributeKey: "material",
      order: 0,
    },
  });

  await prisma.variantAttributeValue.create({
    data: {
      organizationId: org.id,
      productId: product.id,
      variantId: variant.id,
      key: "material",
      value: "metal",
    },
  });

  await updateMMarketConnection({
    organizationId: org.id,
    actorId: adminUser.id,
    requestId: "test-connection",
    environment: MMarketEnvironment.DEV,
    apiToken: "local-token",
  });

  await updateMMarketBranchMappings({
    organizationId: org.id,
    actorId: adminUser.id,
    requestId: "test-mappings",
    mappings: [{ storeId: store.id, mmarketBranchId: "branch-main" }],
  });

  await updateMMarketProductSelection({
    organizationId: org.id,
    actorId: adminUser.id,
    requestId: "test-selection",
    productIds: [product.id],
    included: true,
  });

  return { org, store, product, adminUser, supplier, baseUnit };
};

describeDb("m-market integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    __resetMMarketCooldownForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks products when direct images are missing or use non-direct extensions", async () => {
    const { org, product } = await prepareReadyMMarketData();

    await prisma.product.update({
      where: { id: product.id },
      data: { photoUrl: null },
    });
    await prisma.productImage.deleteMany({ where: { productId: product.id } });

    const tooFewImages = await runMMarketPreflight(org.id);
    const tooFewFailure = tooFewImages.failedProducts.find((row) => row.sku === product.sku);

    expect(tooFewImages.canExport).toBe(false);
    expect(tooFewFailure?.issues).toContain("INVALID_IMAGES_COUNT");

    await prisma.product.update({
      where: { id: product.id },
      data: { photoUrl: "https://cdn.example.com/images/test-4.gif" },
    });

    const badExtension = await runMMarketPreflight(org.id);
    const badExtensionFailure = badExtension.failedProducts.find((row) => row.sku === product.sku);

    expect(badExtension.canExport).toBe(false);
    expect(badExtensionFailure?.issues).toContain("NON_DIRECT_IMAGE_URL");
  });

  it("defaults products to excluded until the user includes them", async () => {
    const { org, product } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { photoUrl: "https://cdn.example.com/images/default-excluded.jpg" },
    });

    const list = await listMMarketProducts({
      organizationId: org.id,
      page: 1,
      pageSize: 25,
    });

    expect(list.items.find((row) => row.id === product.id)?.included).toBe(false);
    expect(list.items.find((row) => row.id === product.id)?.exportStatus).toBe("EXCLUDED");
    expect(list.summary.includedProducts).toBe(0);
    expect(list.summary.excludedProducts).toBe(1);
  });

  it("treats legacy backfilled inclusions as excluded until the first explicit selection", async () => {
    const { org, product, adminUser, supplier, baseUnit } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: { photoUrl: "https://cdn.example.com/images/first-product.jpg" },
    });

    const secondProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "TEST-2",
        name: "Second Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        photoUrl: "https://cdn.example.com/images/second-product.jpg",
      },
    });

    await prisma.mMarketIncludedProduct.createMany({
      data: [
        { orgId: org.id, productId: product.id },
        { orgId: org.id, productId: secondProduct.id },
      ],
    });

    const initialList = await listMMarketProducts({
      organizationId: org.id,
      page: 1,
      pageSize: 25,
    });
    const initialPreflight = await runMMarketPreflight(org.id);

    expect(initialList.summary.includedProducts).toBe(0);
    expect(initialList.summary.excludedProducts).toBe(2);
    expect(initialList.items.every((row) => !row.included)).toBe(true);
    expect(initialList.items.every((row) => row.exportStatus === "EXCLUDED")).toBe(true);
    expect(initialPreflight.summary.productsConsidered).toBe(0);
    expect(initialPreflight.blockers.byCode.NO_PRODUCTS_SELECTED).toBe(1);

    await updateMMarketProductSelection({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "first-explicit-selection",
      productIds: [product.id],
      included: true,
    });

    const includedRows = await prisma.mMarketIncludedProduct.findMany({
      where: { orgId: org.id },
      orderBy: { productId: "asc" },
      select: { productId: true },
    });
    const nextList = await listMMarketProducts({
      organizationId: org.id,
      page: 1,
      pageSize: 25,
    });

    expect(includedRows).toEqual([{ productId: product.id }]);
    expect(nextList.summary.includedProducts).toBe(1);
    expect(nextList.summary.excludedProducts).toBe(1);
    expect(nextList.items.find((row) => row.id === product.id)?.included).toBe(true);
    expect(nextList.items.find((row) => row.id === product.id)?.exportStatus).toBe("INCLUDED");
    expect(nextList.items.find((row) => row.id === secondProduct.id)?.included).toBe(false);
    expect(nextList.items.find((row) => row.id === secondProduct.id)?.exportStatus).toBe(
      "EXCLUDED",
    );
  });

  it("lists only products that have at least one image", async () => {
    const { org, product, supplier, baseUnit } = await seedBase();

    await prisma.product.update({
      where: { id: product.id },
      data: {
        photoUrl: "https://cdn.example.com/images/listable-product.jpg",
        basePriceKgs: 1200,
      },
    });

    const hiddenFromList = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "NO-IMAGE",
        name: "No Image Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });

    const list = await listMMarketProducts({
      organizationId: org.id,
      page: 1,
      pageSize: 25,
    });

    expect(list.summary.totalProducts).toBe(1);
    expect(list.items.map((row) => row.id)).toEqual([product.id]);
    expect(list.items[0]?.imageUrl).toBe("https://cdn.example.com/images/listable-product.jpg");
    expect(list.items[0]?.exportPriceKgs).toBe(1420);
    expect(list.items.some((row) => row.id === hiddenFromList.id)).toBe(false);
  });

  it("assigns the fallback category only to exported products missing category", async () => {
    const { org, product, adminUser, supplier, baseUnit } = await prepareReadyMMarketData();

    await prisma.product.update({
      where: { id: product.id },
      data: { category: null },
    });

    const excludedProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "NO-CATEGORY-EXCLUDED",
        name: "Excluded No Category Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        photoUrl: "https://cdn.example.com/images/no-category-excluded.jpg",
      },
    });

    const before = await runMMarketPreflight(org.id);
    expect(before.blockers.byCode.MISSING_CATEGORY).toBe(1);

    const result = await assignDefaultCategoryToMMarketProducts({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "assign-default-category",
    });

    const refreshedIncludedProduct = await prisma.product.findUnique({
      where: { id: product.id },
      select: { category: true },
    });
    const refreshedExcludedProduct = await prisma.product.findUnique({
      where: { id: excludedProduct.id },
      select: { category: true },
    });

    expect(result.targetedCount).toBe(1);
    expect(result.updatedCount).toBe(1);
    expect(refreshedIncludedProduct?.category).toBe("Без категории");
    expect(refreshedExcludedProduct?.category).toBeNull();
  });

  it("allows export with fewer than three direct images without padding placeholders", async () => {
    const { org, product } = await prepareReadyMMarketData();
    const firstImage = await prisma.productImage.findFirst({ where: { productId: product.id } });
    if (!firstImage) {
      throw new Error("missing image");
    }

    await prisma.productImage.delete({ where: { id: firstImage.id } });

    const preflight = await runMMarketPreflight(org.id);
    const failure = preflight.failedProducts.find((row) => row.sku === product.sku);
    const plan = await __buildMMarketExportPlanForTests(org.id);
    const payloadProduct = plan.payload.products.find((row) => row.sku === product.sku);

    expect(failure).toBeUndefined();
    expect(payloadProduct?.images).toHaveLength(2);
    expect(payloadProduct?.images.some((value) => value.includes("bazaar-placeholder"))).toBe(
      false,
    );
  });

  it("blocks products when description is shorter than 150 symbols", async () => {
    const { org, product } = await prepareReadyMMarketData();

    await prisma.product.update({
      where: { id: product.id },
      data: {
        description: "Короткое описание",
      },
    });

    const preflight = await runMMarketPreflight(org.id);
    const failure = preflight.failedProducts.find((row) => row.sku === product.sku);

    expect(preflight.canExport).toBe(false);
    expect(failure?.productId).toBe(product.id);
    expect(failure?.issues).toContain("SHORT_DESCRIPTION");
  });

  it("checks and exports only explicitly included products", async () => {
    const { org, store, product, supplier, baseUnit } = await prepareReadyMMarketData();

    const excludedProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "EXCLUDED-1",
        name: "Bad",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });

    await prisma.inventorySnapshot.create({
      data: {
        storeId: store.id,
        productId: excludedProduct.id,
        variantKey: "BASE",
        onHand: 7,
        onOrder: 0,
        allowNegativeStock: store.allowNegativeStock,
      },
    });

    const preflight = await runMMarketPreflight(org.id);
    const plan = await __buildMMarketExportPlanForTests(org.id);

    expect(preflight.summary.productsConsidered).toBe(1);
    expect(preflight.failedProducts.some((row) => row.productId === excludedProduct.id)).toBe(
      false,
    );
    expect(plan.payload.products.map((row) => row.sku)).toEqual([product.sku]);
  });

  it("omits optional null fields in generated export payload", async () => {
    const { org } = await prepareReadyMMarketData();

    const plan = await __buildMMarketExportPlanForTests(org.id);
    const firstProduct = plan.payload.products[0];

    expect(firstProduct).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(firstProduct, "discount")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(firstProduct, "similar_products_sku")).toBe(false);
  });

  it("adds 10 percent and 100 KGS to the exported price", async () => {
    const { org } = await prepareReadyMMarketData();

    const plan = await __buildMMarketExportPlanForTests(org.id);
    const firstProduct = plan.payload.products[0];

    expect(firstProduct?.price).toBe(1420);
  });

  it("prevents second export request within the 15-minute cooldown window", async () => {
    const { org, adminUser } = await prepareReadyMMarketData();

    const first = await requestMMarketExport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "export-1",
    });

    const second = await requestMMarketExport({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "export-2",
    });

    expect(first.job.status).toBe(MMarketExportJobStatus.QUEUED);
    expect(second.job.status).toBe(MMarketExportJobStatus.RATE_LIMITED);
    expect(second.remainingSeconds).toBeGreaterThan(0);
  });

  it("marks successfully exported products as exported in the products table", async () => {
    const { org, adminUser, product } = await prepareReadyMMarketData();
    const previousSpecsEndpoint = process.env.MMARKET_SPECS_KEYS_ENDPOINT_DEV;
    delete process.env.MMARKET_SPECS_KEYS_ENDPOINT_DEV;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const requested = await requestMMarketExport({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "export-success",
      });

      const result = await runJob("mmarket-export", { jobId: requested.job.id });
      const list = await listMMarketProducts({
        organizationId: org.id,
        page: 1,
        pageSize: 25,
      });
      const inclusion = await prisma.mMarketIncludedProduct.findUnique({
        where: {
          orgId_productId: {
            orgId: org.id,
            productId: product.id,
          },
        },
        select: {
          lastExportedAt: true,
        },
      });

      expect(result.status).toBe("ok");
      expect(fetchMock).toHaveBeenCalled();
      expect(inclusion?.lastExportedAt).toBeInstanceOf(Date);
      expect(list.items.find((row) => row.id === product.id)?.exportStatus).toBe("EXPORTED");
    } finally {
      if (previousSpecsEndpoint === undefined) {
        delete process.env.MMARKET_SPECS_KEYS_ENDPOINT_DEV;
      } else {
        process.env.MMARKET_SPECS_KEYS_ENDPOINT_DEV = previousSpecsEndpoint;
      }
    }
  });

  it("builds stock payload with mapped branch_id values", async () => {
    const { org } = await prepareReadyMMarketData();

    const plan = await __buildMMarketExportPlanForTests(org.id);
    const firstProduct = plan.payload.products[0];
    const payloadBytes = Buffer.byteLength(JSON.stringify(plan.payload), "utf8");

    expect(plan.preflight.canExport).toBe(true);
    expect(plan.errorReport).toMatchObject({
      environment: "DEV",
      endpoint: "https://dev.m-market.kg/api/crm/products/import_products/",
      payloadBytes,
      networkError: null,
      payloadStats: {
        productCount: 1,
        selectedProducts: 1,
        payloadBytes,
      },
      payload: {
        products: [
          {
            sku: firstProduct?.sku,
          },
        ],
      },
      specValidationMode: plan.preflight.specValidationMode,
    });
    expect(firstProduct?.stock).toEqual([
      {
        branch_id: "branch-main",
        quantity: 5,
      },
    ]);
    expect(firstProduct?.specs).toEqual({
      Материал: "metal",
    });
  });

  it("skips products that are manually excluded from export", async () => {
    const { org, product, adminUser } = await prepareReadyMMarketData();

    await updateMMarketProductSelection({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "exclude-product",
      productIds: [product.id],
      included: false,
    });

    const preflight = await runMMarketPreflight(org.id);
    const plan = await __buildMMarketExportPlanForTests(org.id);

    expect(preflight.canExport).toBe(false);
    expect(preflight.blockers.byCode.NO_PRODUCTS_SELECTED).toBe(1);
    expect(preflight.summary.productsConsidered).toBe(0);
    expect(preflight.summary.productsReady).toBe(0);
    expect(plan.payload.products).toHaveLength(0);
  });
});
