import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/prisma";
import * as descriptions from "@/server/services/productDescriptions";
import {
  startProductDescriptionGenerationJob,
  runProductDescriptionGenerationJob,
  getProductDescriptionGenerationJob,
  retryFailedProductDescriptionGenerationItems,
} from "@/server/services/productDescriptionGenerationJobs";
import {
  getSubscriptionUsage,
  reserveSubscriptionUsage,
  startSubscriptionUsage,
  settleSubscriptionUsage,
} from "@/server/billing/subscriptionUsage";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
async function fixture() {
  const f = await seedBase({ plan: "BUSINESS" });
  await prisma.organization.update({
    where: { id: f.org.id },
    data: { currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000) },
  });
  await prisma.subscriptionContract.create({
    data: { organizationId: f.org.id, catalogVersion: "2026-11" },
  });
  return f;
}
(shouldRunDbTests ? describe : describe.skip)(
  "job quota reflects actual provider eligibility",
  () => {
    beforeEach(resetDatabase);
    afterEach(() => vi.restoreAllMocks());
    it("accepts 495 no-op cards plus5 image-backed cards against Business300 and calls AI only5 times", async () => {
      const f = await fixture();
      const ids = Array.from({ length: 500 }, () => randomUUID());
      await prisma.product.createMany({
        data: ids.map((id, index) => ({
          id,
          organizationId: f.org.id,
          name: `Card ${index}`,
          sku: `ELIG-${index}`,
          unit: f.baseUnit.code,
          baseUnitId: f.baseUnit.id,
          photoUrl: index >= 495 ? "https://cdn.example.com/product.jpg" : null,
        })),
      });
      const provider = vi
        .spyOn(descriptions, "generateProductDescriptionFromImages")
        .mockResolvedValue({ description: "Generated product description" });
      const network = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("real provider is forbidden"));
      const job = await startProductDescriptionGenerationJob({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        source: "PRODUCTS_PAGE",
        productIds: ids,
        overwriteExisting: false,
        runImmediately: false,
      });
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 0, reserved: 5 });
      await runProductDescriptionGenerationJob({ jobId: job.id });
      expect(provider).toHaveBeenCalledTimes(5);
      expect(network).not.toHaveBeenCalled();
      expect(await getProductDescriptionGenerationJob(f.org.id, job.id)).toMatchObject({
        status: "DONE",
        successCount: 5,
        skippedCount: 495,
      });
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 5, reserved: 0 });
    });
    it("rechecks the exact worker snapshot and cannot call AI after a no-op card gains an image without remaining quota", async () => {
      const f = await fixture();
      const used = await reserveSubscriptionUsage({
        organizationId: f.org.id,
        resource: "ai",
        operationKey: "previous-results",
        units: 300,
      });
      await startSubscriptionUsage(used);
      await settleSubscriptionUsage(used, true);
      const remainingIds = [randomUUID(), randomUUID()];
      await prisma.product.createMany({
        data: remainingIds.map((id, index) => ({
          id,
          organizationId: f.org.id,
          name: `Unprocessed ${index}`,
          sku: `RETRY-${index}`,
          unit: f.baseUnit.code,
          baseUnitId: f.baseUnit.id,
        })),
      });
      const provider = vi
        .spyOn(descriptions, "generateProductDescriptionFromImages")
        .mockResolvedValue({ description: "must not run" });
      const job = await startProductDescriptionGenerationJob({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        source: "PRODUCTS_PAGE",
        productIds: [f.product.id, ...remainingIds],
        runImmediately: false,
      });
      await prisma.productDescriptionGenerationJobItem.updateMany({
        where: { jobId: job.id, productId: f.product.id },
        data: { createdAt: new Date(0) },
      });
      await prisma.product.update({
        where: { id: f.product.id },
        data: { photoUrl: "https://cdn.example.com/added.jpg" },
      });
      await runProductDescriptionGenerationJob({ jobId: job.id });
      expect(provider).not.toHaveBeenCalled();
      expect((await getProductDescriptionGenerationJob(f.org.id, job.id)).items[0]?.status).toBe(
        "FAILED",
      );
      const failedJob = await getProductDescriptionGenerationJob(f.org.id, job.id);
      expect(failedJob.failedCount).toBe(3);
      expect(failedJob.items.every((item) => item.status === "FAILED")).toBe(true);
      expect(
        await prisma.productDescriptionGenerationJobItem.count({
          where: { jobId: job.id, status: "PENDING" },
        }),
      ).toBe(0);
      await expect(
        retryFailedProductDescriptionGenerationItems({
          organizationId: f.org.id,
          actorId: f.adminUser.id,
          requestId: randomUUID(),
          jobId: job.id,
        }),
      ).rejects.toThrow("billingUsageLimitReached");
      expect(
        (await getSubscriptionUsage(f.org.id)).find((row) => row.resource === "ai"),
      ).toMatchObject({ used: 300, reserved: 0 });
      expect(
        (await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).description,
      ).toBeNull();
    });
  },
);
