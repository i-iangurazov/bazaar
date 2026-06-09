import {
  ProductDescriptionGenerationItemStatus,
  ProductDescriptionGenerationJobStatus,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  normalizeProductDescriptionGenerationJobView,
  type ProductDescriptionGenerationJobView,
} from "@/components/product-description-generation-progress";

const buildItem = (
  index: number,
  status: ProductDescriptionGenerationItemStatus,
  errorMessage?: string | null,
): ProductDescriptionGenerationJobView["items"][number] => ({
  id: `item-${index}`,
  productId: `product-${index}`,
  status,
  errorMessage,
  generatedDescription:
    status === ProductDescriptionGenerationItemStatus.SUCCESS
      ? `Generated product description ${index}`
      : null,
  imageUrl: index % 2 === 0 ? `https://example.test/${index}.jpg` : null,
  product: {
    sku: `SKU-${index}`,
    name: `Product ${index}`,
  },
});

describe("product description generation progress", () => {
  it("derives 77-item progress from row statuses when persisted counters are stale", () => {
    const items = [
      ...Array.from({ length: 36 }, (_, index) =>
        buildItem(index, ProductDescriptionGenerationItemStatus.SUCCESS),
      ),
      ...Array.from({ length: 41 }, (_, index) =>
        buildItem(
          index + 36,
          ProductDescriptionGenerationItemStatus.SKIPPED,
          index % 2 === 0 ? "aiDescriptionImageRequired" : "descriptionAlreadyExists",
        ),
      ),
    ];

    const normalized = normalizeProductDescriptionGenerationJobView({
      status: ProductDescriptionGenerationJobStatus.PROCESSING,
      totalCount: 77,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      progressPercent: 0,
      items,
    });

    expect(normalized.processedCount).toBe(77);
    expect(normalized.successCount).toBe(36);
    expect(normalized.skippedCount).toBe(41);
    expect(normalized.failedCount).toBe(0);
    expect(normalized.progressPercent).toBe(100);
    expect(normalized.status).toBe(ProductDescriptionGenerationJobStatus.DONE);
    expect(normalized.displayStatus).toBe(ProductDescriptionGenerationJobStatus.DONE);
  });

  it("keeps running progress consistent while pending rows remain", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, index) =>
        buildItem(index, ProductDescriptionGenerationItemStatus.SUCCESS),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        buildItem(index + 10, ProductDescriptionGenerationItemStatus.SKIPPED),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        buildItem(index + 13, ProductDescriptionGenerationItemStatus.FAILED),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        buildItem(index + 15, ProductDescriptionGenerationItemStatus.PENDING),
      ),
    ];

    const normalized = normalizeProductDescriptionGenerationJobView({
      status: ProductDescriptionGenerationJobStatus.PROCESSING,
      totalCount: 20,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      progressPercent: 0,
      items,
    });

    expect(normalized.processedCount).toBe(15);
    expect(normalized.successCount).toBe(10);
    expect(normalized.skippedCount).toBe(3);
    expect(normalized.failedCount).toBe(2);
    expect(normalized.progressPercent).toBe(75);
    expect(normalized.status).toBe(ProductDescriptionGenerationJobStatus.PROCESSING);
  });

  it("shows timed out status when the job failed because of a timeout", () => {
    const normalized = normalizeProductDescriptionGenerationJobView({
      status: ProductDescriptionGenerationJobStatus.FAILED,
      totalCount: 1,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      errorMessage: "aiDescriptionJobTimedOut",
      progressPercent: 0,
      items: [buildItem(0, ProductDescriptionGenerationItemStatus.FAILED, "aiDescriptionTimedOut")],
    });

    expect(normalized.failedCount).toBe(1);
    expect(normalized.displayStatus).toBe("TIMED_OUT");
  });
});
