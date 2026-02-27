import { beforeEach, describe, expect, it } from "vitest";
import { AttributeType, MMarketEnvironment, MMarketExportJobStatus } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import {
  __buildMMarketExportPlanForTests,
  __resetMMarketCooldownForTests,
  requestMMarketExport,
  runMMarketPreflight,
  updateMMarketBranchMappings,
  updateMMarketConnection,
} from "@/server/services/mMarket";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

const prepareReadyMMarketData = async () => {
  const { org, store, product, adminUser } = await seedBase();

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

  return { org, store, product, adminUser };
};

describeDb("m-market integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    __resetMMarketCooldownForTests();
  });

  it("blocks products when images are less than 3 or include non-direct extensions", async () => {
    const { org, product } = await prepareReadyMMarketData();

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
    const badExtensionFailure = badExtension.failedProducts.find((row) => row.sku === product.sku);

    expect(badExtension.canExport).toBe(false);
    expect(badExtensionFailure?.issues).toContain("NON_DIRECT_IMAGE_URL");
  });

  it("blocks products when description is shorter than 50 symbols", async () => {
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
    expect(failure?.issues).toContain("SHORT_DESCRIPTION");
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
});
