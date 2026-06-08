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
