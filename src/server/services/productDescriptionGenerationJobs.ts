import { randomUUID } from "node:crypto";

import {
  ProductDescriptionGenerationItemStatus,
  ProductDescriptionGenerationJobStatus,
  ProductDescriptionGenerationSource,
  type Prisma,
} from "@prisma/client";
import type { Logger } from "pino";

import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { registerJob, runJob, type JobPayload, type JobResult } from "@/server/jobs";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";
import { generateProductDescriptionFromImages } from "@/server/services/productDescriptions";
import { normalizeProductImageUrl } from "@/server/services/productImageStorage";

export const PRODUCT_DESCRIPTION_GENERATION_JOB_NAME = "product-description-generation";

const MAX_GENERATION_PRODUCTS = 5_000;
const MAX_IMAGES_PER_PRODUCT = 3;
const ITEM_BATCH_SIZE = 10;

const parsePositiveIntEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const PROCESSING_ITEM_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.PRODUCT_DESCRIPTION_ITEM_TIMEOUT_MS,
  5 * 60 * 1000,
);
const PROCESSING_JOB_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.PRODUCT_DESCRIPTION_JOB_TIMEOUT_MS,
  60 * 60 * 1000,
);

type ProductDescriptionGenerationLogger = Pick<Logger, "info" | "warn" | "error">;

const normalizeProductIds = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const normalizeGenerationLocale = (value?: string | null) => normalizeLocale(value) ?? defaultLocale;

const buildStoreProductWhere = (storeId: string): Prisma.ProductWhereInput => ({
  storeProducts: {
    some: {
      storeId,
      isActive: true,
    },
  },
});

const assertStoreBelongsToOrganization = async (input: {
  organizationId: string;
  storeId: string;
}) => {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
};

const getGenerationJob = async (organizationId: string, jobId: string) => {
  const job = await prisma.productDescriptionGenerationJob.findFirst({
    where: { id: jobId, organizationId },
    select: {
      id: true,
      source: true,
      status: true,
      storeId: true,
      locale: true,
      overwriteExisting: true,
      totalCount: true,
      processedCount: true,
      successCount: true,
      failedCount: true,
      skippedCount: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      store: {
        select: { id: true, name: true },
      },
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productId: true,
          status: true,
          errorMessage: true,
          generatedDescription: true,
          imageCount: true,
          startedAt: true,
          completedAt: true,
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              photoUrl: true,
              images: {
                select: { url: true },
                orderBy: { position: "asc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!job) {
    throw new AppError("productDescriptionGenerationJobNotFound", "NOT_FOUND", 404);
  }

  return {
    ...job,
    progressPercent:
      job.totalCount > 0 ? Math.round((job.processedCount / job.totalCount) * 100) : 0,
    items: job.items.map((item) => ({
      ...item,
      imageUrl:
        normalizeProductImageUrl(item.product.photoUrl) ??
        normalizeProductImageUrl(item.product.images[0]?.url ?? null),
    })),
  };
};

export const getProductDescriptionGenerationJob = async (
  organizationId: string,
  jobId: string,
) => getGenerationJob(organizationId, jobId);

export const startProductDescriptionGenerationJob = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  source: ProductDescriptionGenerationSource;
  productIds: string[];
  storeId?: string | null;
  locale?: string | null;
  overwriteExisting?: boolean;
  logger?: ProductDescriptionGenerationLogger;
  runImmediately?: boolean;
}) => {
  const productIds = normalizeProductIds(input.productIds);
  if (!productIds.length) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  if (productIds.length > MAX_GENERATION_PRODUCTS) {
    throw new AppError("bulkGenerateDescriptionsLimitExceeded", "BAD_REQUEST", 400);
  }

  const storeId = input.storeId?.trim() || null;
  if (
    input.source !== ProductDescriptionGenerationSource.PRODUCTS_PAGE &&
    !storeId
  ) {
    throw new AppError("integrationStoreRequired", "BAD_REQUEST", 400);
  }
  if (storeId) {
    await assertStoreBelongsToOrganization({ organizationId: input.organizationId, storeId });
  }

  const eligibleProducts = await prisma.product.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: productIds },
      isDeleted: false,
      ...(storeId ? buildStoreProductWhere(storeId) : {}),
    },
    select: { id: true },
  });
  if (eligibleProducts.length !== productIds.length) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.productDescriptionGenerationJob.create({
      data: {
        organizationId: input.organizationId,
        storeId,
        createdById: input.actorId,
        source: input.source,
        status: ProductDescriptionGenerationJobStatus.QUEUED,
        locale: normalizeGenerationLocale(input.locale),
        overwriteExisting: Boolean(input.overwriteExisting),
        totalCount: productIds.length,
        items: {
          createMany: {
            data: productIds.map((productId) => ({
              organizationId: input.organizationId,
              productId,
              status: ProductDescriptionGenerationItemStatus.PENDING,
            })),
          },
        },
      },
      select: { id: true },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_DESCRIPTION_GENERATION_JOB_CREATED",
      entity: "ProductDescriptionGenerationJob",
      entityId: created.id,
      requestId: input.requestId,
      after: toJson({
        jobId: created.id,
        source: input.source,
        storeId,
        totalCount: productIds.length,
        overwriteExisting: Boolean(input.overwriteExisting),
      }),
    });

    return created;
  });

  if (input.runImmediately !== false) {
    void runJob(PRODUCT_DESCRIPTION_GENERATION_JOB_NAME, { jobId: job.id }).catch((error) => {
      input.logger?.warn(
        {
          jobId: job.id,
          error: error instanceof Error ? { message: error.message, name: error.name } : error,
        },
        "product description generation background job failed to start",
      );
    });
  }

  return getGenerationJob(input.organizationId, job.id);
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "aiDescriptionGenerationFailed";
};

const isSkipErrorMessage = (message: string) =>
  message === "aiDescriptionImageRequired" || message === "aiDescriptionNoUsableImages";

const collectProductImageUrls = (product: {
  photoUrl: string | null;
  images: Array<{ url: string }>;
}) =>
  Array.from(
    new Set(
      [product.photoUrl, ...product.images.map((image) => image.url)]
        .map((value) => normalizeProductImageUrl(value ?? null))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, MAX_IMAGES_PER_PRODUCT);

const refreshJobCounts = async (jobId: string) => {
  const grouped = await prisma.productDescriptionGenerationJobItem.groupBy({
    by: ["status"],
    where: { jobId },
    _count: { _all: true },
  });
  const countByStatus = new Map(
    grouped.map((group) => [group.status, group._count._all] as const),
  );
  const successCount = countByStatus.get(ProductDescriptionGenerationItemStatus.SUCCESS) ?? 0;
  const failedCount = countByStatus.get(ProductDescriptionGenerationItemStatus.FAILED) ?? 0;
  const skippedCount = countByStatus.get(ProductDescriptionGenerationItemStatus.SKIPPED) ?? 0;
  const cancelledCount = countByStatus.get(ProductDescriptionGenerationItemStatus.CANCELLED) ?? 0;
  const pendingCount = countByStatus.get(ProductDescriptionGenerationItemStatus.PENDING) ?? 0;
  const processingCount =
    countByStatus.get(ProductDescriptionGenerationItemStatus.PROCESSING) ?? 0;
  const processedCount = successCount + failedCount + skippedCount + cancelledCount;
  const isComplete = pendingCount === 0 && processingCount === 0;

  return prisma.productDescriptionGenerationJob.update({
    where: { id: jobId },
    data: {
      processedCount,
      successCount,
      failedCount,
      skippedCount,
      ...(isComplete
        ? {
            status:
              failedCount > 0
                ? ProductDescriptionGenerationJobStatus.DONE_WITH_ERRORS
                : ProductDescriptionGenerationJobStatus.DONE,
            completedAt: new Date(),
          }
        : {}),
    },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      status: true,
      totalCount: true,
      processedCount: true,
      successCount: true,
      failedCount: true,
      skippedCount: true,
    },
  });
};

const timeoutAbandonedProductDescriptionWork = async (
  logger: ProductDescriptionGenerationLogger,
) => {
  const itemTimeoutBefore = new Date(Date.now() - PROCESSING_ITEM_TIMEOUT_MS);
  const staleProcessingItems = await prisma.productDescriptionGenerationJobItem.findMany({
    where: {
      status: ProductDescriptionGenerationItemStatus.PROCESSING,
      updatedAt: { lt: itemTimeoutBefore },
    },
    select: { jobId: true },
    distinct: ["jobId"],
  });

  if (staleProcessingItems.length) {
    await prisma.productDescriptionGenerationJobItem.updateMany({
      where: {
        status: ProductDescriptionGenerationItemStatus.PROCESSING,
        updatedAt: { lt: itemTimeoutBefore },
      },
      data: {
        status: ProductDescriptionGenerationItemStatus.FAILED,
        errorMessage: "aiDescriptionTimedOut",
        completedAt: new Date(),
      },
    });

    for (const item of staleProcessingItems) {
      await refreshJobCounts(item.jobId);
    }
    logger.warn(
      {
        jobIds: staleProcessingItems.map((item) => item.jobId),
        timeoutMs: PROCESSING_ITEM_TIMEOUT_MS,
      },
      "timed out abandoned product description generation items",
    );
  }

  const jobTimeoutBefore = new Date(Date.now() - PROCESSING_JOB_TIMEOUT_MS);
  const staleJobs = await prisma.productDescriptionGenerationJob.findMany({
    where: {
      status: {
        in: [
          ProductDescriptionGenerationJobStatus.QUEUED,
          ProductDescriptionGenerationJobStatus.PROCESSING,
        ],
      },
      OR: [
        { startedAt: { lt: jobTimeoutBefore } },
        { startedAt: null, createdAt: { lt: jobTimeoutBefore } },
      ],
    },
    select: { id: true },
  });

  if (!staleJobs.length) {
    return;
  }

  const staleJobIds = staleJobs.map((job) => job.id);
  await prisma.productDescriptionGenerationJobItem.updateMany({
    where: {
      jobId: { in: staleJobIds },
      status: {
        in: [
          ProductDescriptionGenerationItemStatus.PENDING,
          ProductDescriptionGenerationItemStatus.PROCESSING,
        ],
      },
    },
    data: {
      status: ProductDescriptionGenerationItemStatus.FAILED,
      errorMessage: "aiDescriptionJobTimedOut",
      completedAt: new Date(),
    },
  });
  for (const jobId of staleJobIds) {
    await refreshJobCounts(jobId);
    await prisma.productDescriptionGenerationJob.update({
      where: { id: jobId },
      data: {
        status: ProductDescriptionGenerationJobStatus.FAILED,
        errorMessage: "aiDescriptionJobTimedOut",
        completedAt: new Date(),
      },
    });
  }
  logger.warn(
    {
      jobIds: staleJobIds,
      timeoutMs: PROCESSING_JOB_TIMEOUT_MS,
    },
    "timed out abandoned product description generation jobs",
  );
};

const markItem = async (input: {
  itemId: string;
  status: ProductDescriptionGenerationItemStatus;
  errorMessage?: string | null;
  generatedDescription?: string | null;
  previousDescription?: string | null;
  imageCount?: number;
}) =>
  prisma.productDescriptionGenerationJobItem.update({
    where: { id: input.itemId },
    data: {
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      generatedDescription: input.generatedDescription,
      previousDescription: input.previousDescription,
      imageCount: input.imageCount,
      completedAt: new Date(),
    },
  });

const processJobItem = async (input: {
  job: {
    id: string;
    organizationId: string;
    createdById: string;
    locale: string | null;
    overwriteExisting: boolean;
  };
  item: { id: string; productId: string };
  logger: ProductDescriptionGenerationLogger;
}) => {
  const startedAt = new Date();
  await prisma.productDescriptionGenerationJobItem.update({
    where: { id: input.item.id },
    data: {
      status: ProductDescriptionGenerationItemStatus.PROCESSING,
      startedAt,
      errorMessage: null,
      completedAt: null,
    },
  });

  const product = await prisma.product.findFirst({
    where: {
      id: input.item.productId,
      organizationId: input.job.organizationId,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      category: true,
      isBundle: true,
      description: true,
      photoUrl: true,
      images: {
        where: {
          url: {
            not: { startsWith: "data:image/" },
          },
        },
        select: { url: true },
        orderBy: { position: "asc" },
        take: MAX_IMAGES_PER_PRODUCT,
      },
    },
  });

  if (!product) {
    await markItem({
      itemId: input.item.id,
      status: ProductDescriptionGenerationItemStatus.SKIPPED,
      errorMessage: "productNotFound",
    });
    return;
  }

  const previousDescription = product.description?.trim() ?? "";
  if (previousDescription && !input.job.overwriteExisting) {
    await markItem({
      itemId: input.item.id,
      status: ProductDescriptionGenerationItemStatus.SKIPPED,
      errorMessage: "descriptionAlreadyExists",
      previousDescription,
    });
    return;
  }

  const imageUrls = collectProductImageUrls(product);
  if (!imageUrls.length) {
    await markItem({
      itemId: input.item.id,
      status: ProductDescriptionGenerationItemStatus.SKIPPED,
      errorMessage: "aiDescriptionImageRequired",
      previousDescription,
      imageCount: 0,
    });
    return;
  }

  try {
    const result = await generateProductDescriptionFromImages({
      name: product.name,
      category: product.category,
      isBundle: product.isBundle,
      locale: input.job.locale,
      imageUrls,
      logger: input.logger,
    });

    const generatedDescription = result.description.trim();
    if (!generatedDescription || generatedDescription === previousDescription) {
      await markItem({
        itemId: input.item.id,
        status: ProductDescriptionGenerationItemStatus.SKIPPED,
        errorMessage: "aiDescriptionGenerationSkipped",
        generatedDescription,
        previousDescription,
        imageCount: imageUrls.length,
      });
      return;
    }

    await prisma.product.update({
      where: { id: product.id },
      data: { description: generatedDescription },
    });
    await writeAuditLog(prisma, {
      organizationId: input.job.organizationId,
      actorId: input.job.createdById,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      entityId: product.id,
      requestId: randomUUID(),
      before: toJson({ description: previousDescription || null }),
      after: toJson({
        description: generatedDescription,
        generated: true,
        generationJobId: input.job.id,
      }),
    });

    await markItem({
      itemId: input.item.id,
      status: ProductDescriptionGenerationItemStatus.SUCCESS,
      generatedDescription,
      previousDescription,
      imageCount: imageUrls.length,
    });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    await markItem({
      itemId: input.item.id,
      status: isSkipErrorMessage(errorMessage)
        ? ProductDescriptionGenerationItemStatus.SKIPPED
        : ProductDescriptionGenerationItemStatus.FAILED,
      errorMessage,
      previousDescription,
      imageCount: imageUrls.length,
    });
    input.logger.warn(
      {
        jobId: input.job.id,
        productId: product.id,
        itemId: input.item.id,
        error: error instanceof Error ? { message: error.message, name: error.name } : error,
      },
      "product description generation failed for item",
    );
  }
};

const getPayloadJobId = (value?: JobPayload) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.jobId === "string" ? record.jobId : undefined;
};

const processQueuedProductDescriptionGenerationJob = async (
  requestedJobId?: string,
): Promise<JobResult> => {
  const logger = getLogger();
  await timeoutAbandonedProductDescriptionWork(logger);

  const job = await prisma.productDescriptionGenerationJob.findFirst({
    where: {
      ...(requestedJobId ? { id: requestedJobId } : {}),
      status: {
        in: [
          ProductDescriptionGenerationJobStatus.QUEUED,
          ProductDescriptionGenerationJobStatus.PROCESSING,
        ],
      },
    },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      locale: true,
      overwriteExisting: true,
      status: true,
      totalCount: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return {
      job: PRODUCT_DESCRIPTION_GENERATION_JOB_NAME,
      status: "skipped",
      details: { reason: "noQueuedJobs" },
    };
  }

  if (job.status === ProductDescriptionGenerationJobStatus.QUEUED) {
    await prisma.productDescriptionGenerationJob.update({
      where: { id: job.id },
      data: {
        status: ProductDescriptionGenerationJobStatus.PROCESSING,
        startedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  try {
    let pendingItems = await prisma.productDescriptionGenerationJobItem.findMany({
      where: {
        jobId: job.id,
        status: ProductDescriptionGenerationItemStatus.PENDING,
      },
      select: { id: true, productId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ITEM_BATCH_SIZE,
    });

    while (pendingItems.length > 0) {
      for (const item of pendingItems) {
        await processJobItem({ job, item, logger });
      }
      await refreshJobCounts(job.id);
      pendingItems = await prisma.productDescriptionGenerationJobItem.findMany({
        where: {
          jobId: job.id,
          status: ProductDescriptionGenerationItemStatus.PENDING,
        },
        select: { id: true, productId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: ITEM_BATCH_SIZE,
      });
    }

    const finished = await refreshJobCounts(job.id);
    await writeAuditLog(prisma, {
      organizationId: finished.organizationId,
      actorId: finished.createdById,
      action: "PRODUCT_DESCRIPTION_GENERATION_JOB_FINISHED",
      entity: "ProductDescriptionGenerationJob",
      entityId: finished.id,
      requestId: randomUUID(),
      after: toJson({
        jobId: finished.id,
        status: finished.status,
        totalCount: finished.totalCount,
        processedCount: finished.processedCount,
        successCount: finished.successCount,
        failedCount: finished.failedCount,
        skippedCount: finished.skippedCount,
      }),
    });

    return {
      job: PRODUCT_DESCRIPTION_GENERATION_JOB_NAME,
      status: "ok",
      details: {
        jobId: finished.id,
        status: finished.status,
        processedCount: finished.processedCount,
        totalCount: finished.totalCount,
      },
    };
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    await prisma.productDescriptionGenerationJob.update({
      where: { id: job.id },
      data: {
        status: ProductDescriptionGenerationJobStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
      },
    });
    logger.error(
      {
        jobId: job.id,
        error: error instanceof Error ? { message: error.message, name: error.name } : error,
      },
      "product description generation job failed",
    );
    return {
      job: PRODUCT_DESCRIPTION_GENERATION_JOB_NAME,
      status: "ok",
      details: { jobId: job.id, status: ProductDescriptionGenerationJobStatus.FAILED },
    };
  }
};

export const retryFailedProductDescriptionGenerationItems = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  jobId: string;
  logger?: ProductDescriptionGenerationLogger;
}) => {
  const job = await prisma.productDescriptionGenerationJob.findFirst({
    where: { id: input.jobId, organizationId: input.organizationId },
    select: {
      source: true,
      storeId: true,
      locale: true,
      overwriteExisting: true,
      items: {
        where: { status: ProductDescriptionGenerationItemStatus.FAILED },
        select: { productId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!job) {
    throw new AppError("productDescriptionGenerationJobNotFound", "NOT_FOUND", 404);
  }
  if (!job.items.length) {
    throw new AppError("productDescriptionGenerationRetryUnavailable", "BAD_REQUEST", 400);
  }

  return startProductDescriptionGenerationJob({
    organizationId: input.organizationId,
    actorId: input.actorId,
    requestId: input.requestId,
    source: job.source,
    storeId: job.storeId,
    productIds: job.items.map((item) => item.productId),
    locale: job.locale,
    overwriteExisting: job.overwriteExisting,
    logger: input.logger,
  });
};

const runProductDescriptionGenerationJob = async (payload?: JobPayload) => {
  return processQueuedProductDescriptionGenerationJob(getPayloadJobId(payload));
};

registerJob(PRODUCT_DESCRIPTION_GENERATION_JOB_NAME, {
  handler: runProductDescriptionGenerationJob,
});

export { ProductDescriptionGenerationItemStatus, ProductDescriptionGenerationJobStatus, ProductDescriptionGenerationSource };
