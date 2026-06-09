import {
  ProductDescriptionGenerationItemStatus,
  ProductDescriptionGenerationJobStatus,
  ProductDescriptionGenerationSource,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { runJob } from "@/server/jobs";
import {
  getProductDescriptionGenerationJob,
  PRODUCT_DESCRIPTION_GENERATION_JOB_NAME,
  startProductDescriptionGenerationJob,
} from "@/server/services/productDescriptionGenerationJobs";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("product description generation jobs", () => {
  beforeEach(async () => {
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
});
