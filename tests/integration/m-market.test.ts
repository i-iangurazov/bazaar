import { beforeEach, describe, expect, it } from "vitest";
import { AttributeType, MMarketEnvironment, MMarketExportJobStatus } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  __buildMMarketExportPlanForTests,
  __resetMMarketCooldownForTests,
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
        "Надежный смартфон для ежедневного использования с хорошей автономностью и стабильной связью.",
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

  it("blocks products when images are less than 3 or include non-direct extensions", async () => {
    const { org, product } = await prepareReadyMMarketData();
    const previousPlaceholder = process.env.MMARKET_PLACEHOLDER_IMAGE_URL;
    process.env.MMARKET_PLACEHOLDER_IMAGE_URL = "";

    try {
      const firstImage = await prisma.productImage.findFirst({ where: { productId: product.id } });
      if (!firstImage) {
        throw new Error("missing image");
      }

      await prisma.productImage.delete({ where: { id: firstImage.id } });

      const tooFewImages = await runMMarketPreflight(org.id);
      const tooFewFailure = tooFewImages.failedProducts.find((row) => row.sku === product.sku);

      expect(tooFewImages.canExport).toBe(false);
      expect(tooFewFailure?.issues).toContain("INVALID_IMAGES_COUNT");

      await prisma.productImage.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          url: "https://cdn.example.com/images/test-4.gif",
          position: 9,
        },
      });

      const badExtension = await runMMarketPreflight(org.id);
      const badExtensionFailure = badExtension.failedProducts.find(
        (row) => row.sku === product.sku,
      );

      expect(badExtension.canExport).toBe(false);
      expect(badExtensionFailure?.issues).toContain("NON_DIRECT_IMAGE_URL");
    } finally {
      if (previousPlaceholder === undefined) {
        delete process.env.MMARKET_PLACEHOLDER_IMAGE_URL;
      } else {
        process.env.MMARKET_PLACEHOLDER_IMAGE_URL = previousPlaceholder;
      }
    }
  });

  it("defaults products to excluded until the user includes them", async () => {
    const { org, product } = await seedBase();

    const list = await listMMarketProducts({
      organizationId: org.id,
      page: 1,
      pageSize: 25,
    });

    expect(list.items.find((row) => row.id === product.id)?.included).toBe(false);
    expect(list.summary.includedProducts).toBe(0);
    expect(list.summary.excludedProducts).toBe(1);
  });

  it("treats legacy backfilled inclusions as excluded until the first explicit selection", async () => {
    const { org, product, adminUser, supplier, baseUnit } = await seedBase();

    const secondProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        sku: "TEST-2",
        name: "Second Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
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
    expect(nextList.items.find((row) => row.id === secondProduct.id)?.included).toBe(false);
  });

  it("pads missing images with the Bazaar placeholder for export", async () => {
    const { org, product } = await prepareReadyMMarketData();
    const previousPlaceholder = process.env.MMARKET_PLACEHOLDER_IMAGE_URL;
    process.env.MMARKET_PLACEHOLDER_IMAGE_URL =
      "https://pub-75076a8067634fa3a91a6df2248d729c.r2.dev/bazaar-placeholder.png";

    try {
      const firstImage = await prisma.productImage.findFirst({ where: { productId: product.id } });
      if (!firstImage) {
        throw new Error("missing image");
      }

      await prisma.productImage.delete({ where: { id: firstImage.id } });

      const preflight = await runMMarketPreflight(org.id);
      const failure = preflight.failedProducts.find((row) => row.sku === product.sku);
      const plan = await __buildMMarketExportPlanForTests(org.id);
      const payloadProduct = plan.payload.products.find((row) => row.sku === product.sku);

      expect(failure?.issues).not.toContain("INVALID_IMAGES_COUNT");
      expect(payloadProduct?.images).toHaveLength(3);
      expect(payloadProduct?.images[2]).toContain("bazaar-placeholder.png");
    } finally {
      if (previousPlaceholder === undefined) {
        delete process.env.MMARKET_PLACEHOLDER_IMAGE_URL;
      } else {
        process.env.MMARKET_PLACEHOLDER_IMAGE_URL = previousPlaceholder;
      }
    }
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

  it("builds stock payload with mapped branch_id values", async () => {
    const { org } = await prepareReadyMMarketData();

    const plan = await __buildMMarketExportPlanForTests(org.id);
    const firstProduct = plan.payload.products[0];

    expect(plan.preflight.canExport).toBe(true);
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

    expect(preflight.canExport).toBe(true);
    expect(preflight.summary.productsConsidered).toBe(0);
    expect(preflight.summary.productsReady).toBe(0);
    expect(plan.payload.products).toHaveLength(0);
  });
});
