import {
  AttributeType,
  ProductDescriptionGenerationItemStatus,
  ProductDescriptionGenerationJobStatus,
  ProductDescriptionGenerationSource,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import {
  getProductDescriptionGenerationJob,
  PRODUCT_DESCRIPTION_GENERATION_JOB_NAME,
  startProductDescriptionGenerationJob,
} from "@/server/services/productDescriptionGenerationJobs";
import { toJson } from "@/server/services/json";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const { mockDownloadRemoteImage, mockNormalizeProductImageUrl } = vi.hoisted(() => ({
  mockDownloadRemoteImage: vi.fn(),
  mockNormalizeProductImageUrl: vi.fn((value: string | null) => value),
}));

vi.mock("@/server/services/productImageStorage", () => ({
  downloadRemoteImage: (value: string) => mockDownloadRemoteImage(value),
  normalizeProductImageUrl: (value: string | null) => mockNormalizeProductImageUrl(value),
}));

const describeDb = shouldRunDbTests ? describe : describe.skip;

const generatedDescriptionText =
  "Защитный чехол для смартфона с аккуратной формой и выразительным игровым принтом подходит для ежедневного использования. Он помогает закрыть корпус от потертостей, оставляет доступ к камере и кнопкам, а внешний вид делает карточку товара понятной для покупателя.";

const openAiTextResponse = (outputText: string) =>
  new Response(JSON.stringify({ status: "completed", output_text: outputText }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const seedPhoneCaseSpecTemplate = async (organizationId: string, category: string) => {
  await prisma.attributeDefinition.createMany({
    data: [
      {
        organizationId,
        key: "type",
        labelRu: "Тип",
        labelKg: "Түрү",
        type: AttributeType.TEXT,
      },
      {
        organizationId,
        key: "color",
        labelRu: "Цвет",
        labelKg: "Түс",
        type: AttributeType.TEXT,
      },
      {
        organizationId,
        key: "material",
        labelRu: "Материал",
        labelKg: "Материал",
        type: AttributeType.TEXT,
      },
    ],
  });
  await prisma.categoryAttributeTemplate.createMany({
    data: [
      { organizationId, category, attributeKey: "type", order: 1 },
      { organizationId, category, attributeKey: "color", order: 2 },
      { organizationId, category, attributeKey: "material", order: 3 },
    ],
  });
};

const seedProductForAiJob = async (input: {
  organizationId: string;
  productId: string;
  category: string;
  description?: string | null;
  attributes?: Record<string, unknown>;
}) => {
  await prisma.product.update({
    where: { id: input.productId },
    data: {
      name: "Чехол CS GO для смартфона",
      sku: "CASE-CSGO-1",
      category: input.category,
      description: input.description ?? null,
      photoUrl: "https://cdn.example.com/case-csgo.png",
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: input.productId,
      attributes: toJson(input.attributes ?? {}),
    },
  });
  for (const [key, value] of Object.entries(input.attributes ?? {})) {
    await prisma.variantAttributeValue.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        variantId: variant.id,
        key,
        value: toJson(value),
      },
    });
  }
  return variant;
};

describeDb("product description generation jobs", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockNormalizeProductImageUrl.mockImplementation((value: string | null) => value);
    mockDownloadRemoteImage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3, 4]),
      contentType: "image/png",
    });
    await resetDatabase();
  });

  it("persists per-product skipped status when a product has no usable photo", async () => {
    const { org, product, adminUser } = await seedBase();

    const created = await startProductDescriptionGenerationJob({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-description-job-no-photo",
      source: ProductDescriptionGenerationSource.PRODUCTS_PAGE,
      productIds: [product.id],
      locale: "ru",
      runImmediately: false,
    });

    expect(created.status).toBe(ProductDescriptionGenerationJobStatus.QUEUED);
    expect(created.items).toHaveLength(1);
    expect(created.items[0]?.status).toBe(ProductDescriptionGenerationItemStatus.PENDING);

    await runJob(PRODUCT_DESCRIPTION_GENERATION_JOB_NAME, { jobId: created.id });

    const job = await getProductDescriptionGenerationJob(org.id, created.id);
    expect(job.status).toBe(ProductDescriptionGenerationJobStatus.DONE);
    expect(job.totalCount).toBe(1);
    expect(job.processedCount).toBe(1);
    expect(job.successCount).toBe(0);
    expect(job.failedCount).toBe(0);
    expect(job.skippedCount).toBe(1);
    expect(job.items[0]?.status).toBe(ProductDescriptionGenerationItemStatus.SKIPPED);
    expect(job.items[0]?.errorMessage).toBe("aiDescriptionImageRequired");
  });

  it("returns normalized counters from 77 terminal item statuses when stored counters are stale", async () => {
    const { org, adminUser, baseUnit } = await seedBase();
    const productIds = Array.from({ length: 77 }, (_, index) => `ai-description-${index}`);

    await prisma.product.createMany({
      data: productIds.map((productId, index) => ({
        id: productId,
        organizationId: org.id,
        sku: `AI-DESC-${index}`,
        name: `AI description product ${index}`,
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
        photoUrl: index < 36 ? `https://example.test/product-${index}.jpg` : null,
      })),
    });

    const staleJob = await prisma.productDescriptionGenerationJob.create({
      data: {
        organizationId: org.id,
        createdById: adminUser.id,
        source: ProductDescriptionGenerationSource.PRODUCTS_PAGE,
        status: ProductDescriptionGenerationJobStatus.PROCESSING,
        totalCount: productIds.length,
        processedCount: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        items: {
          createMany: {
            data: productIds.map((productId, index) => ({
              organizationId: org.id,
              productId,
              status:
                index < 36
                  ? ProductDescriptionGenerationItemStatus.SUCCESS
                  : ProductDescriptionGenerationItemStatus.SKIPPED,
              generatedDescription:
                index < 36 ? `Generated product description ${index}` : undefined,
              errorMessage:
                index >= 36
                  ? index % 2 === 0
                    ? "aiDescriptionImageRequired"
                    : "descriptionAlreadyExists"
                  : undefined,
              completedAt: new Date(),
            })),
          },
        },
      },
      select: { id: true },
    });

    const job = await getProductDescriptionGenerationJob(org.id, staleJob.id);
    expect(job.totalCount).toBe(77);
    expect(job.processedCount).toBe(77);
    expect(job.successCount).toBe(36);
    expect(job.skippedCount).toBe(41);
    expect(job.failedCount).toBe(0);
    expect(job.progressPercent).toBe(100);
    expect(job.status).toBe(ProductDescriptionGenerationJobStatus.DONE);
  });

  it("rejects integration jobs that include products outside the active store", async () => {
    const { org, store, adminUser, baseUnit } = await seedBase();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: "Other Store",
        code: "OTHER",
      },
    });
    const otherProduct = await prisma.product.create({
      data: {
        organizationId: org.id,
        sku: "OTHER-1",
        name: "Other Store Product",
        unit: baseUnit.code,
        baseUnitId: baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: {
        organizationId: org.id,
        storeId: otherStore.id,
        productId: otherProduct.id,
        isActive: true,
      },
    });

    await expect(
      startProductDescriptionGenerationJob({
        organizationId: org.id,
        actorId: adminUser.id,
        requestId: "req-description-job-store-scope",
        source: ProductDescriptionGenerationSource.BAKAI_STORE,
        storeId: store.id,
        productIds: [otherProduct.id],
        locale: "ru",
        runImmediately: false,
      }),
    ).rejects.toMatchObject({ message: "productNotFound" });
  });

  it("overwrites existing descriptions and characteristics when overwrite is enabled", async () => {
    const { org, product, adminUser } = await seedBase();
    const category = "Аксессуары";
    await seedPhoneCaseSpecTemplate(org.id, category);
    const variant = await seedProductForAiJob({
      organizationId: org.id,
      productId: product.id,
      category,
      description: "Старое описание",
      attributes: {
        type: "Старый тип",
        color: "Белый",
        material: "Силикон",
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiTextResponse(generatedDescriptionText))
      .mockResolvedValueOnce(
        openAiTextResponse(
          JSON.stringify({
            type: "Чехол",
            color: "Черный",
            material: "Поликарбонат",
          }),
        ),
      );
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", fetchMock);

    const created = await startProductDescriptionGenerationJob({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-description-job-overwrite",
      source: ProductDescriptionGenerationSource.PRODUCTS_PAGE,
      productIds: [product.id],
      locale: "ru",
      overwriteExisting: true,
      runImmediately: false,
    });
    await runJob(PRODUCT_DESCRIPTION_GENERATION_JOB_NAME, { jobId: created.id });

    const [updatedProduct, updatedVariant, job] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
      prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
      getProductDescriptionGenerationJob(org.id, created.id),
    ]);
    expect(updatedProduct.description).toBe(generatedDescriptionText);
    expect(updatedVariant.attributes).toMatchObject({
      type: "Чехол",
      color: "Черный",
      material: "Поликарбонат",
    });
    await expect(
      prisma.variantAttributeValue.findMany({
        where: { variantId: variant.id },
        orderBy: { key: "asc" },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "type", value: "Чехол" }),
        expect.objectContaining({ key: "color", value: "Черный" }),
        expect.objectContaining({ key: "material", value: "Поликарбонат" }),
      ]),
    );
    expect(job.successCount).toBe(1);
    expect(job.skippedCount).toBe(0);
    expect(job.items[0]?.status).toBe(ProductDescriptionGenerationItemStatus.SUCCESS);
    expect(job.items[0]?.previousDescription).toBe("Старое описание");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips existing descriptions in missing-only mode but still fills missing characteristics", async () => {
    const { org, product, adminUser } = await seedBase();
    const category = "Аксессуары";
    await seedPhoneCaseSpecTemplate(org.id, category);
    const variant = await seedProductForAiJob({
      organizationId: org.id,
      productId: product.id,
      category,
      description: "Описание уже есть",
      attributes: {},
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        openAiTextResponse(
          JSON.stringify({
            type: "Чехол",
            color: "Черный",
            material: "Поликарбонат",
          }),
        ),
      );
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", fetchMock);

    const created = await startProductDescriptionGenerationJob({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-description-job-missing-specs",
      source: ProductDescriptionGenerationSource.PRODUCTS_PAGE,
      productIds: [product.id],
      locale: "ru",
      overwriteExisting: false,
      runImmediately: false,
    });
    await runJob(PRODUCT_DESCRIPTION_GENERATION_JOB_NAME, { jobId: created.id });

    const [updatedProduct, updatedVariant, job] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
      prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
      getProductDescriptionGenerationJob(org.id, created.id),
    ]);
    expect(updatedProduct.description).toBe("Описание уже есть");
    expect(updatedVariant.attributes).toMatchObject({
      type: "Чехол",
      color: "Черный",
      material: "Поликарбонат",
    });
    expect(job.successCount).toBe(1);
    expect(job.skippedCount).toBe(0);
    expect(job.items[0]?.generatedDescription).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips existing descriptions and specs in missing-only mode with a clear reason", async () => {
    const { org, product, adminUser } = await seedBase();
    const category = "Аксессуары";
    await seedPhoneCaseSpecTemplate(org.id, category);
    await seedProductForAiJob({
      organizationId: org.id,
      productId: product.id,
      category,
      description: "Описание уже есть",
      attributes: {
        type: "Чехол",
        color: "Черный",
        material: "Поликарбонат",
      },
    });
    const fetchMock = vi.fn();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal("fetch", fetchMock);

    const created = await startProductDescriptionGenerationJob({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-description-job-missing-only-skip",
      source: ProductDescriptionGenerationSource.PRODUCTS_PAGE,
      productIds: [product.id],
      locale: "ru",
      overwriteExisting: false,
      runImmediately: false,
    });
    await runJob(PRODUCT_DESCRIPTION_GENERATION_JOB_NAME, { jobId: created.id });

    const job = await getProductDescriptionGenerationJob(org.id, created.id);
    expect(job.successCount).toBe(0);
    expect(job.skippedCount).toBe(1);
    expect(job.items[0]?.status).toBe(ProductDescriptionGenerationItemStatus.SKIPPED);
    expect(job.items[0]?.errorMessage).toBe("descriptionAndSpecsAlreadyExist");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generates useful characteristics from metadata when a category has no template yet", async () => {
    const { org, product, adminUser } = await seedBase();
    const category = "Аксессуары";
    const variant = await seedProductForAiJob({
      organizationId: org.id,
      productId: product.id,
      category,
      description: "Описание уже есть",
      attributes: {},
    });
    const fetchMock = vi.fn();
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubGlobal("fetch", fetchMock);

    const created = await startProductDescriptionGenerationJob({
      organizationId: org.id,
      actorId: adminUser.id,
      requestId: "req-description-job-metadata-specs",
      source: ProductDescriptionGenerationSource.PRODUCTS_PAGE,
      productIds: [product.id],
      locale: "ru",
      overwriteExisting: false,
      runImmediately: false,
    });
    await runJob(PRODUCT_DESCRIPTION_GENERATION_JOB_NAME, { jobId: created.id });

    const [updatedVariant, templates, job] = await Promise.all([
      prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } }),
      prisma.categoryAttributeTemplate.findMany({
        where: { organizationId: org.id, category },
        include: { definition: true },
        orderBy: { order: "asc" },
      }),
      getProductDescriptionGenerationJob(org.id, created.id),
    ]);

    expect(updatedVariant.attributes).toMatchObject({
      ai_type: "Чехол",
      ai_purpose: "Защита смартфона",
      ai_features: "Вырез под камеру",
      ai_design: "Игровой принт",
    });
    expect(templates.map((template) => template.definition?.labelRu)).toEqual(
      expect.arrayContaining(["Тип", "Назначение", "Особенности", "Дизайн"]),
    );
    expect(templates.map((template) => template.definition?.labelRu)).not.toContain("Описание");
    expect(job.successCount).toBe(1);
    expect(job.items[0]?.status).toBe(ProductDescriptionGenerationItemStatus.SUCCESS);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
