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
import {
  AI_GENERATED_SPEC_DEFINITIONS,
  generateProductContent,
  resolveProductContentSpecKind,
  type ProductContentSpecKind,
} from "@/server/services/productContentGeneration";
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
          previousDescription: true,
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

  const items = job.items.map((item) => ({
    ...item,
    imageUrl:
      normalizeProductImageUrl(item.product.photoUrl) ??
      normalizeProductImageUrl(item.product.images[0]?.url ?? null),
  }));
  const counts = summarizeItemStatuses(items);
  const totalCount = Math.max(job.totalCount, items.length, counts.processedCount);
  const status = deriveJobStatusFromItems({
    storedStatus: job.status,
    totalCount,
    counts,
  });

  return {
    ...job,
    status,
    totalCount,
    processedCount: counts.processedCount,
    successCount: counts.successCount,
    failedCount: counts.failedCount,
    skippedCount: counts.skippedCount,
    progressPercent: getProgressPercent(counts.processedCount, totalCount),
    items,
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

type ProductSpecAutofillKind = ProductContentSpecKind;

type ProductSpecTemplate = {
  attributeKey: string;
  labelRu: string;
  labelKg?: string;
  type: "TEXT" | "NUMBER" | "SELECT" | "MULTI_SELECT";
  optionsRu: string[];
  autofillKind: ProductSpecAutofillKind | null;
};

type ProductSpecGenerationResult =
  | {
      status: "generated" | "overwritten";
      filledValueCount: number;
      previousValues: Record<string, string | null>;
      nextValues: Record<string, unknown>;
    }
  | {
      status: "skipped" | "failed";
      reason: string;
      filledValueCount: 0;
      previousValues?: Record<string, string | null>;
      nextValues?: Record<string, unknown>;
    };

const resolveProductSpecAutofillKind = resolveProductContentSpecKind;

const parseOptionStrings = (value: Prisma.JsonValue | null | undefined) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];

const toStoredProductSpecValue = (type: ProductSpecTemplate["type"], value: string) => {
  if (type === "MULTI_SELECT") {
    return [value];
  }
  if (type === "NUMBER") {
    const parsed = Number(value.replace(/\s+/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
};

const toSpecString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => toSpecString(item))
      .filter((item): item is string => Boolean(item));
    return normalized.length ? normalized.join(", ") : null;
  }
  return null;
};

const addCurrentSpecValue = (
  values: Map<string, string[]>,
  key: string,
  rawValue: unknown,
) => {
  const value = toSpecString(rawValue);
  if (!value) {
    return;
  }
  const existing = values.get(key) ?? [];
  if (!existing.includes(value)) {
    existing.push(value);
    values.set(key, existing);
  }
};

const generateAndPersistProductSpecs = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  jobId: string;
  product: {
    id: string;
    sku: string;
    name: string;
    category: string | null;
    supplier: { name: string } | null;
    photoUrl: string | null;
    images: Array<{ url: string }>;
    variants: Array<{
      id: string;
      attributes: Prisma.JsonValue;
      attributeValues: Array<{ key: string; value: Prisma.JsonValue }>;
    }>;
  };
  imageUrls: string[];
  overwriteExisting: boolean;
  logger: ProductDescriptionGenerationLogger;
}): Promise<ProductSpecGenerationResult> => {
  const category = input.product.category?.trim() ?? "";
  if (!category) {
    return { status: "skipped", reason: "missingCategory", filledValueCount: 0 };
  }

  const categoryTemplates = await prisma.categoryAttributeTemplate.findMany({
    where: {
      organizationId: input.organizationId,
      category,
    },
    select: {
      attributeKey: true,
      order: true,
      definition: {
        select: {
          labelRu: true,
          type: true,
          optionsRu: true,
          isActive: true,
        },
      },
    },
    orderBy: [{ order: "asc" }, { attributeKey: "asc" }],
  });

  let templateSpecs: ProductSpecTemplate[] = categoryTemplates
    .filter((template) => template.definition?.isActive && template.definition.labelRu.trim())
    .map((template) => ({
      attributeKey: template.attributeKey,
      labelRu: template.definition?.labelRu.trim() ?? template.attributeKey,
      type: template.definition?.type ?? "TEXT",
      optionsRu: parseOptionStrings(template.definition?.optionsRu),
      autofillKind: resolveProductSpecAutofillKind({
        labelRu: template.definition?.labelRu,
        attributeKey: template.attributeKey,
      }),
    }));

  const generatedTemplateMode = templateSpecs.length === 0;
  if (generatedTemplateMode) {
    templateSpecs = AI_GENERATED_SPEC_DEFINITIONS.map((definition) => ({
      attributeKey: definition.key,
      labelRu: definition.labelRu,
      labelKg: definition.labelKg,
      type: "TEXT",
      optionsRu: [],
      autofillKind: definition.kind,
    }));
  }

  const currentValues = new Map<string, string[]>();
  for (const variant of input.product.variants) {
    if (variant.attributes && typeof variant.attributes === "object" && !Array.isArray(variant.attributes)) {
      for (const [key, value] of Object.entries(variant.attributes as Record<string, unknown>)) {
        addCurrentSpecValue(currentValues, key, value);
      }
    }
    for (const valueRow of variant.attributeValues) {
      addCurrentSpecValue(currentValues, valueRow.key, valueRow.value);
    }
  }

  const nextValues = new Map<string, unknown>();
  const previousValues: Record<string, string | null> = {};
  let supportedFieldCount = 0;
  const supportedTemplateSpecs: ProductSpecTemplate[] = [];

  for (const templateSpec of templateSpecs) {
    if (!templateSpec.autofillKind) {
      continue;
    }
    supportedFieldCount += 1;
    supportedTemplateSpecs.push(templateSpec);
    const existing = currentValues.get(templateSpec.attributeKey) ?? [];
    previousValues[templateSpec.attributeKey] = existing[0] ?? null;
  }

  if (!supportedFieldCount) {
    return { status: "skipped", reason: "noSupportedSpecFields", filledValueCount: 0 };
  }

  const contentResult = await generateProductContent({
    product: {
      id: input.product.id,
      sku: input.product.sku,
      name: input.product.name,
      supplier: input.product.supplier,
    },
    category,
    imageUrls: input.imageUrls,
    locale: "ru",
    mode: input.overwriteExisting ? "overwrite" : "missing-only",
    generateDescription: false,
    generateSpecs: true,
    overwriteSpecs: input.overwriteExisting,
    requestedSpecs: supportedTemplateSpecs.map((templateSpec) => ({
      key: templateSpec.attributeKey,
      labelRu: templateSpec.labelRu,
      labelKg: templateSpec.labelKg,
      kind: templateSpec.autofillKind as ProductSpecAutofillKind,
      options: templateSpec.optionsRu,
      existingValue: currentValues.get(templateSpec.attributeKey)?.[0] ?? null,
    })),
    integrationContext: {
      source: "product-description-generation-job",
    },
    logger: input.logger,
  });

  for (const generatedSpec of contentResult.specs.values) {
    const templateSpec = supportedTemplateSpecs.find(
      (candidate) => candidate.attributeKey === generatedSpec.key,
    );
    if (!templateSpec) {
      continue;
    }
    nextValues.set(
      templateSpec.attributeKey,
      toStoredProductSpecValue(templateSpec.type, generatedSpec.value),
    );
  }

  if (generatedTemplateMode && nextValues.size) {
    templateSpecs = supportedTemplateSpecs.filter((templateSpec) =>
      nextValues.has(templateSpec.attributeKey),
    );
  }

  if (!nextValues.size) {
    const allSupportedFieldsAlreadyFilled =
      supportedFieldCount > 0 &&
      templateSpecs
        .filter((templateSpec) => Boolean(templateSpec.autofillKind))
        .every((templateSpec) => (currentValues.get(templateSpec.attributeKey) ?? []).length > 0);
    if (allSupportedFieldsAlreadyFilled && !input.overwriteExisting) {
      return {
        status: "skipped",
        reason: "specsAlreadyExist",
        filledValueCount: 0,
        previousValues,
      };
    }
    if (
      contentResult.specs.status === "failed" &&
      contentResult.specs.reason !== "aiSpecNoUsableImages"
    ) {
      return {
        status: "failed",
        reason: contentResult.specs.reason,
        filledValueCount: 0,
        previousValues,
      };
    }
    return {
      status: "skipped",
      reason:
        generatedTemplateMode && contentResult.specs.reason === "noResolvedSpecValues"
          ? "missingSpecTemplate"
          : contentResult.specs.reason === "aiSpecNoUsableImages"
            ? "aiSpecNoUsableImages"
            : "noResolvedSpecValues",
      filledValueCount: 0,
      previousValues,
    };
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (generatedTemplateMode) {
      const existingTemplateCount = await tx.categoryAttributeTemplate.count({
        where: {
          organizationId: input.organizationId,
          category,
        },
      });

      for (const [index, templateSpec] of templateSpecs.entries()) {
        await tx.attributeDefinition.upsert({
          where: {
            organizationId_key: {
              organizationId: input.organizationId,
              key: templateSpec.attributeKey,
            },
          },
          update: {
            isActive: true,
            labelRu: templateSpec.labelRu,
            labelKg: templateSpec.labelKg ?? templateSpec.labelRu,
            type: templateSpec.type,
          },
          create: {
            organizationId: input.organizationId,
            key: templateSpec.attributeKey,
            labelRu: templateSpec.labelRu,
            labelKg: templateSpec.labelKg ?? templateSpec.labelRu,
            type: templateSpec.type,
            required: false,
            isActive: true,
          },
        });
        await tx.categoryAttributeTemplate.upsert({
          where: {
            organizationId_category_attributeKey: {
              organizationId: input.organizationId,
              category,
              attributeKey: templateSpec.attributeKey,
            },
          },
          update: {
            order: existingTemplateCount + index,
          },
          create: {
            organizationId: input.organizationId,
            category,
            attributeKey: templateSpec.attributeKey,
            order: existingTemplateCount + index,
          },
        });
      }
    }

    let targetVariant = input.product.variants[0];
    if (!targetVariant) {
      targetVariant = await tx.productVariant.create({
        data: {
          productId: input.product.id,
          attributes: toJson({}),
        },
        select: {
          id: true,
          attributes: true,
          attributeValues: {
            select: { key: true, value: true },
          },
        },
      });
    }

    const currentAttributes =
      targetVariant.attributes &&
      typeof targetVariant.attributes === "object" &&
      !Array.isArray(targetVariant.attributes)
        ? { ...(targetVariant.attributes as Record<string, unknown>) }
        : {};

    for (const [key, value] of nextValues.entries()) {
      currentAttributes[key] = value;
    }

    await tx.productVariant.update({
      where: { id: targetVariant.id },
      data: {
        attributes: toJson(currentAttributes),
      },
    });

    for (const [key, value] of nextValues.entries()) {
      await tx.variantAttributeValue.upsert({
        where: {
          variantId_key: {
            variantId: targetVariant.id,
            key,
          },
        },
        update: {
          value: toJson(value),
        },
        create: {
          organizationId: input.organizationId,
          productId: input.product.id,
          variantId: targetVariant.id,
          key,
          value: toJson(value),
        },
      });
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "PRODUCT_UPDATE",
      entity: "Product",
      entityId: input.product.id,
      requestId: input.requestId,
      before: toJson({ specs: previousValues }),
      after: toJson({
        specs: Object.fromEntries(nextValues),
        generated: true,
        generationJobId: input.jobId,
      }),
    });

    return nextValues.size;
  });

  return {
    status: Object.values(previousValues).some((value) => value) ? "overwritten" : "generated",
    filledValueCount: updated,
    previousValues,
    nextValues: Object.fromEntries(nextValues),
  };
};

const summarizeItemStatuses = (
  items: Array<{ status: ProductDescriptionGenerationItemStatus }>,
) => {
  const successCount = items.filter(
    (item) => item.status === ProductDescriptionGenerationItemStatus.SUCCESS,
  ).length;
  const failedCount = items.filter(
    (item) => item.status === ProductDescriptionGenerationItemStatus.FAILED,
  ).length;
  const skippedCount = items.filter(
    (item) => item.status === ProductDescriptionGenerationItemStatus.SKIPPED,
  ).length;
  const pendingCount = items.filter(
    (item) => item.status === ProductDescriptionGenerationItemStatus.PENDING,
  ).length;
  const processingCount = items.filter(
    (item) => item.status === ProductDescriptionGenerationItemStatus.PROCESSING,
  ).length;
  const cancelledCount = items.filter(
    (item) => item.status === ProductDescriptionGenerationItemStatus.CANCELLED,
  ).length;
  return {
    processedCount: successCount + failedCount + skippedCount,
    successCount,
    failedCount,
    skippedCount,
    pendingCount,
    processingCount,
    cancelledCount,
  };
};

const deriveJobStatusFromItems = (input: {
  storedStatus: ProductDescriptionGenerationJobStatus;
  totalCount: number;
  counts: ReturnType<typeof summarizeItemStatuses>;
}) => {
  if (
    input.storedStatus === ProductDescriptionGenerationJobStatus.FAILED ||
    input.storedStatus === ProductDescriptionGenerationJobStatus.CANCELLED
  ) {
    return input.storedStatus;
  }

  const noActiveItems = input.counts.pendingCount === 0 && input.counts.processingCount === 0;
  const allItemsHandled =
    input.totalCount > 0 &&
    input.counts.processedCount + input.counts.cancelledCount >= input.totalCount;

  if (noActiveItems && allItemsHandled) {
    return input.counts.failedCount > 0 || input.counts.cancelledCount > 0
      ? ProductDescriptionGenerationJobStatus.DONE_WITH_ERRORS
      : ProductDescriptionGenerationJobStatus.DONE;
  }

  if (
    input.storedStatus === ProductDescriptionGenerationJobStatus.DONE &&
    input.counts.failedCount > 0
  ) {
    return ProductDescriptionGenerationJobStatus.DONE_WITH_ERRORS;
  }

  return input.storedStatus;
};

const getProgressPercent = (processedCount: number, totalCount: number) =>
  totalCount > 0 ? Math.min(100, Math.round((processedCount / totalCount) * 100)) : 0;

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
  const processedCount = successCount + failedCount + skippedCount;
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
              failedCount > 0 || cancelledCount > 0
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
      sku: true,
      name: true,
      category: true,
      isBundle: true,
      description: true,
      photoUrl: true,
      supplier: {
        select: { name: true },
      },
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
      variants: {
        where: { isActive: true },
        select: {
          id: true,
          attributes: true,
          attributeValues: {
            select: {
              key: true,
              value: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
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
  const imageUrls = collectProductImageUrls(product);
  let generatedDescription: string | null = null;
  let descriptionSkipReason: string | null = null;
  let descriptionFailureReason: string | null = null;

  const descriptionResult = await generateProductContent({
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      isBundle: product.isBundle,
      supplier: product.supplier,
    },
    category: product.category,
    imageUrls,
    locale: input.job.locale,
    mode: input.job.overwriteExisting ? "overwrite" : "missing-only",
    generateDescription: true,
    generateSpecs: false,
    overwriteDescription: input.job.overwriteExisting,
    integrationContext: {
      source: "product-description-generation-job",
    },
    logger: input.logger,
  }).then(
    (result) => result.description,
    (error) => ({
      status: "failed" as const,
      value: null,
      reason: toErrorMessage(error),
    }),
  );

  if (descriptionResult.status === "generated" || descriptionResult.status === "overwritten") {
    generatedDescription = descriptionResult.value;
  } else if (descriptionResult.status === "failed") {
    if (isSkipErrorMessage(descriptionResult.reason)) {
      descriptionSkipReason = descriptionResult.reason;
    } else {
      descriptionFailureReason = descriptionResult.reason;
    }
    input.logger.warn(
      {
        jobId: input.job.id,
        productId: product.id,
        itemId: input.item.id,
        error: descriptionResult.reason,
      },
      "product description generation failed for item",
    );
  } else {
    descriptionSkipReason = descriptionResult.reason;
  }

  const specResult = await generateAndPersistProductSpecs({
    organizationId: input.job.organizationId,
    actorId: input.job.createdById,
    requestId: randomUUID(),
    jobId: input.job.id,
    product,
    imageUrls,
    overwriteExisting: input.job.overwriteExisting,
    logger: input.logger,
  });

  if (generatedDescription) {
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
  }

  const specsUpdated =
    specResult.status === "generated" || specResult.status === "overwritten";

  if (generatedDescription || specsUpdated) {
    await markItem({
      itemId: input.item.id,
      status: ProductDescriptionGenerationItemStatus.SUCCESS,
      generatedDescription,
      previousDescription,
      imageCount: imageUrls.length,
    });
    return;
  }

  const failureReason =
    descriptionFailureReason || (specResult.status === "failed" ? specResult.reason : null);
  if (failureReason) {
    await markItem({
      itemId: input.item.id,
      status: ProductDescriptionGenerationItemStatus.FAILED,
      errorMessage: failureReason,
      previousDescription,
      imageCount: imageUrls.length,
    });
    return;
  }

  const skipReason =
    descriptionSkipReason === "descriptionAlreadyExists" &&
    specResult.status === "skipped" &&
    specResult.reason === "specsAlreadyExist"
      ? "descriptionAndSpecsAlreadyExist"
      : descriptionSkipReason ?? (specResult.status === "skipped" ? specResult.reason : null);

  await markItem({
    itemId: input.item.id,
    status: ProductDescriptionGenerationItemStatus.SKIPPED,
    errorMessage: skipReason ?? "aiDescriptionGenerationSkipped",
    generatedDescription,
    previousDescription,
    imageCount: imageUrls.length,
  });
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
