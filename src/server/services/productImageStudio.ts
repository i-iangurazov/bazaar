import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, resolve, sep } from "node:path";

import sharp from "sharp";
import {
  Prisma,
  ProductImageStudioBackground,
  ProductImageStudioJobStatus,
  ProductImageStudioOutputFormat,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { registerJob, runJob, type JobPayload } from "@/server/jobs";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import {
  downloadRemoteImage,
  isManagedProductImageUrl,
  normalizeProductImageUrl,
  uploadProductImageBuffer,
} from "@/server/services/productImageStorage";

export const PRODUCT_IMAGE_STUDIO_JOB_NAME = "product-image-studio-process";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_AI_MODEL = "gpt-5-nano";
const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1-mini";
const DEFAULT_OPENAI_IMAGE_QUALITY = "medium";
const PROVIDER_NAME = "openai";
const MANAGED_UPLOAD_PREFIX = "/uploads/imported-products/";
const publicRootDir = resolve(process.cwd(), "public");
const PRODUCT_IMAGE_STUDIO_MIN_DIMENSION = 512;
const OPENAI_MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

const imageMimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const imageMimeBySharpFormat: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  heif: "image/heif",
  tiff: "image/tiff",
};

export type ProductImageStudioOverviewStatus = "NOT_CONFIGURED" | "READY" | "ERROR";

export type ProductImageStudioProviderErrorCode =
  | "RATE_LIMITED"
  | "API_REQUEST_FAILED"
  | "OUTPUT_MISSING";

type ProductImageStudioPresetInput = {
  backgroundMode: ProductImageStudioBackground;
  outputFormat: ProductImageStudioOutputFormat;
  centered: boolean;
  improveVisibility: boolean;
  softShadow: boolean;
  tighterCrop: boolean;
  brighterPresentation: boolean;
};

type ProductImageStudioSourceImage = {
  normalizedUrl: string;
  buffer: Buffer;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
};

type OpenAiImageResponseBody = {
  id?: string | null;
  status?: string | null;
  output?: Array<{
    id?: string | null;
    type?: string | null;
    status?: string | null;
    revised_prompt?: string | null;
    result?: string | null;
  }>;
  incomplete_details?: {
    reason?: string | null;
  } | null;
  error?: {
    message?: string | null;
    type?: string | null;
  } | null;
};

type OpenAiImageQuality = "low" | "medium" | "high" | "auto";

const resolveMaxImageBytes = () => {
  const parsed = Number(process.env.PRODUCT_IMAGE_MAX_BYTES);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 5 * 1024 * 1024;
};

const PRODUCT_IMAGE_STUDIO_MAX_BYTES = resolveMaxImageBytes();

const resolveOpenAiImageQuality = (value?: string | null): OpenAiImageQuality => {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "auto"
  ) {
    return normalized;
  }
  return DEFAULT_OPENAI_IMAGE_QUALITY;
};

const supportsOpenAiInputFidelity = (imageModel: string) =>
  imageModel.trim().toLowerCase() !== "gpt-image-1-mini";

const resolveProviderConfig = () => {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return null;
  }

  const imageModel =
    process.env.PRODUCT_IMAGE_STUDIO_IMAGE_MODEL?.trim() ||
    process.env.OPENAI_IMAGE_MODEL?.trim() ||
    DEFAULT_OPENAI_IMAGE_MODEL;

  return {
    apiKey,
    model: process.env.PRODUCT_IMAGE_STUDIO_AI_MODEL?.trim() || DEFAULT_OPENAI_AI_MODEL,
    imageModel,
    imageQuality: resolveOpenAiImageQuality(process.env.PRODUCT_IMAGE_STUDIO_IMAGE_QUALITY),
  };
};

const normalizeOrgPath = (organizationId: string) =>
  organizationId.replace(/[^a-zA-Z0-9_-]/g, "").trim() || "default";

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const resolveManagedLocalImagePath = (sourceUrl: string) => {
  try {
    const parsed = new URL(sourceUrl, "https://local.invalid");
    if (!parsed.pathname.startsWith(MANAGED_UPLOAD_PREFIX)) {
      return null;
    }
    const candidatePath = resolve(publicRootDir, parsed.pathname.slice(1));
    const rootPrefix = publicRootDir.endsWith(sep) ? publicRootDir : `${publicRootDir}${sep}`;
    if (candidatePath !== publicRootDir && !candidatePath.startsWith(rootPrefix)) {
      return null;
    }
    return candidatePath;
  } catch {
    return null;
  }
};

const resolveMimeTypeFromExtension = (sourcePath: string) =>
  imageMimeByExtension[extname(sourcePath).toLowerCase()] ?? null;

const detectMimeTypeFromBuffer = async (buffer: Buffer, fallback?: string | null) => {
  try {
    const metadata = await sharp(buffer).metadata();
    const bySharp = metadata.format ? imageMimeBySharpFormat[metadata.format] : null;
    return bySharp ?? fallback ?? "image/jpeg";
  } catch {
    return fallback ?? "image/jpeg";
  }
};

const readProductImageSource = async (sourceUrl: string) => {
  const managedLocalPath = resolveManagedLocalImagePath(sourceUrl);
  if (managedLocalPath) {
    const contentType = resolveMimeTypeFromExtension(managedLocalPath);
    if (!contentType) {
      return null;
    }
    try {
      const buffer = await readFile(managedLocalPath);
      if (!buffer.length) {
        return null;
      }
      return {
        buffer,
        contentType,
      };
    } catch {
      return null;
    }
  }

  return downloadRemoteImage(sourceUrl);
};

const ownedManagedProductImageUrl = (organizationId: string, rawUrl: string) => {
  const normalized = normalizeProductImageUrl(rawUrl);
  if (!normalized || !isManagedProductImageUrl(normalized)) {
    return null;
  }

  const orgPath = normalizeOrgPath(organizationId);
  const localPrefix = `${MANAGED_UPLOAD_PREFIX}${orgPath}/products/`;
  const r2Prefix = `/retails/${orgPath}/products/`;

  if (normalized.startsWith(localPrefix)) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.pathname.startsWith(localPrefix) || parsed.pathname.startsWith(r2Prefix)) {
      return normalized;
    }
  } catch {
    if (normalized.startsWith(`retails/${orgPath}/products/`) || normalized.startsWith(r2Prefix)) {
      return normalized;
    }
  }

  return null;
};

const ensureProductAccess = async (organizationId: string, productId?: string | null) => {
  if (!productId) {
    return null;
  }

  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      organizationId,
      isDeleted: false,
    },
    select: {
      id: true,
      sku: true,
      name: true,
      photoUrl: true,
      images: {
        select: { id: true, url: true, position: true, isAiGenerated: true },
        orderBy: { position: "asc" },
      },
    },
  });

  if (!product) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }

  return product;
};

type AccessibleProduct = NonNullable<Awaited<ReturnType<typeof ensureProductAccess>>>;

export const validatePresetSelection = (input: ProductImageStudioPresetInput) => {
  if (input.outputFormat !== ProductImageStudioOutputFormat.SQUARE) {
    throw new AppError("productImageStudioInvalidPreset", "BAD_REQUEST", 400);
  }
  if (!input.centered || !input.improveVisibility) {
    throw new AppError("productImageStudioInvalidPreset", "BAD_REQUEST", 400);
  }
};

export const ensurePromptPreservesProductIdentity = (instruction: string) =>
  [
    instruction.trim(),
    "Preserve the exact same real product from the source image.",
    "Do not change the product variant, color, material, proportions, branding, packaging text, or visible features.",
    "Do not invent missing details, remove real details, add props, add extra products, or stylize the product.",
    "Keep the result realistic, faithful, and suitable for a marketplace catalog.",
  ]
    .filter(Boolean)
    .join("\n");

export const buildProductImageEditInstruction = (
  input: ProductImageStudioPresetInput & {
    productName?: string | null;
  },
) => {
  const backgroundText =
    input.backgroundMode === ProductImageStudioBackground.LIGHT_GRAY
      ? "a clean light gray studio background"
      : "a clean white studio background";
  const optionalEnhancements = [
    input.softShadow ? "Add a soft, natural studio shadow under the product." : null,
    input.tighterCrop
      ? "Crop slightly tighter while keeping the entire product fully visible with comfortable padding."
      : "Keep comfortable padding around the fully visible product.",
    input.brighterPresentation
      ? "Make the presentation slightly brighter while keeping materials and colors realistic."
      : null,
  ].filter(Boolean);

  const baseInstruction = [
    "Edit the provided product photo into a marketplace-ready studio catalog image.",
    input.productName ? `The product shown is "${input.productName}".` : null,
    `Remove any messy or distracting background and place the product on ${backgroundText}.`,
    "Center the product in a square composition.",
    "Improve clarity, visibility, and overall presentation while staying faithful to the source.",
    ...optionalEnhancements,
    "Return one clean catalog image only.",
  ]
    .filter(Boolean)
    .join("\n");

  return ensurePromptPreservesProductIdentity(baseInstruction);
};

export const buildStructuredEnhancementPrompt = buildProductImageEditInstruction;

const validateSourceImageOwnership = (organizationId: string, sourceImageUrl: string) => {
  const normalized = ownedManagedProductImageUrl(organizationId, sourceImageUrl);
  if (!normalized) {
    throw new AppError("productImageStudioSourceImageAccessDenied", "FORBIDDEN", 403);
  }
  return normalized;
};

export const validateUploadedImage = async (input: {
  organizationId: string;
  sourceImageUrl: string;
}) => {
  const normalizedUrl = validateSourceImageOwnership(input.organizationId, input.sourceImageUrl);
  const sourceImage = await readProductImageSource(normalizedUrl);

  if (!sourceImage?.buffer.length) {
    throw new AppError("productImageStudioSourceImageMissing", "BAD_REQUEST", 400);
  }
  if (sourceImage.buffer.length > PRODUCT_IMAGE_STUDIO_MAX_BYTES) {
    throw new AppError("imageTooLarge", "BAD_REQUEST", 400);
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(sourceImage.buffer).metadata();
  } catch {
    throw new AppError("productImageStudioImageUnreadable", "BAD_REQUEST", 400);
  }

  if (!metadata.width || !metadata.height) {
    throw new AppError("productImageStudioImageUnreadable", "BAD_REQUEST", 400);
  }
  if (
    metadata.width < PRODUCT_IMAGE_STUDIO_MIN_DIMENSION ||
    metadata.height < PRODUCT_IMAGE_STUDIO_MIN_DIMENSION
  ) {
    throw new AppError("productImageStudioImageTooSmall", "BAD_REQUEST", 400);
  }

  return {
    normalizedUrl,
    buffer: sourceImage.buffer,
    mimeType: await detectMimeTypeFromBuffer(sourceImage.buffer, sourceImage.contentType),
    bytes: sourceImage.buffer.length,
    width: metadata.width,
    height: metadata.height,
  } satisfies ProductImageStudioSourceImage;
};

const sanitizeProviderResponseSummary = (body: unknown) => {
  if (!isObject(body)) {
    return null;
  }

  const output = Array.isArray(body.output)
    ? body.output
        .map((item) => {
          if (!isObject(item)) {
            return null;
          }
          return {
            id: typeof item.id === "string" ? item.id : null,
            type: typeof item.type === "string" ? item.type : null,
            status: typeof item.status === "string" ? item.status : null,
            revised_prompt: typeof item.revised_prompt === "string" ? item.revised_prompt : null,
          };
        })
        .filter(Boolean)
    : [];

  return {
    id: typeof body.id === "string" ? body.id : null,
    status: typeof body.status === "string" ? body.status : null,
    incomplete_details: isObject(body.incomplete_details)
      ? {
          reason:
            typeof body.incomplete_details.reason === "string"
              ? body.incomplete_details.reason
              : null,
        }
      : null,
    error: isObject(body.error)
      ? {
          message: typeof body.error.message === "string" ? body.error.message : null,
          type: typeof body.error.type === "string" ? body.error.type : null,
        }
      : null,
    output,
  };
};

const extractGeneratedImageResult = (body: OpenAiImageResponseBody | null) => {
  const outputItem = body?.output?.find(
    (item) => item?.type === "image_generation_call" && typeof item.result === "string",
  );
  return typeof outputItem?.result === "string" && outputItem.result.trim()
    ? {
        imageBase64: outputItem.result.trim(),
        revisedPrompt:
          typeof outputItem.revised_prompt === "string" ? outputItem.revised_prompt.trim() : null,
        providerJobId: typeof outputItem.id === "string" ? outputItem.id : null,
      }
    : null;
};

export const normalizeProviderError = (input: {
  status?: number | null;
  body?: unknown;
  error?: unknown;
}) => {
  const messageFromBody =
    isObject(input.body) &&
    isObject(input.body.error) &&
    typeof input.body.error.message === "string"
      ? input.body.error.message
      : isObject(input.body) && typeof input.body.detail === "string"
        ? input.body.detail
        : null;
  const message =
    messageFromBody ||
    (input.error instanceof Error ? input.error.message : null) ||
    "OpenAI image request failed.";
  const status = Number.isFinite(input.status) ? Number(input.status) : null;
  const code: ProductImageStudioProviderErrorCode =
    status === 429 ? "RATE_LIMITED" : "API_REQUEST_FAILED";
  const retryable =
    status === null || status === 408 || status === 409 || status === 429 || status >= 500;

  return {
    code,
    status,
    message,
    retryable,
    body: sanitizeProviderResponseSummary(input.body),
  };
};

const callOpenAiImageEnhancement = async (input: {
  jobId: string;
  sourceImage: ProductImageStudioSourceImage;
  prompt: string;
  presets: ProductImageStudioPresetInput;
}) => {
  const config = resolveProviderConfig();
  if (!config) {
    throw new AppError("productImageStudioNotConfigured", "INTERNAL_SERVER_ERROR", 500);
  }

  const imageDataUrl = `data:${input.sourceImage.mimeType};base64,${input.sourceImage.buffer.toString(
    "base64",
  )}`;
  const imageGenerationTool: Record<string, string | number> = {
    type: "image_generation",
    model: config.imageModel,
    action: "edit",
    size: "1024x1024",
    quality: config.imageQuality,
    output_format: "jpeg",
    output_compression: 90,
    background: "opaque",
  };
  if (supportsOpenAiInputFidelity(config.imageModel)) {
    imageGenerationTool.input_fidelity = "high";
  }

  const requestSummary = {
    model: config.model,
    sourceImageBytes: input.sourceImage.bytes,
    sourceImageMimeType: input.sourceImage.mimeType,
    tool: imageGenerationTool,
    presets: {
      backgroundMode: input.presets.backgroundMode,
      outputFormat: input.presets.outputFormat,
      centered: input.presets.centered,
      improveVisibility: input.presets.improveVisibility,
      softShadow: input.presets.softShadow,
      tighterCrop: input.presets.tighterCrop,
      brighterPresentation: input.presets.brighterPresentation,
    },
  } satisfies Record<string, unknown>;

  const requestBody = {
    model: config.model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: input.prompt,
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
          },
        ],
      },
    ],
    tool_choice: { type: "image_generation" },
    tools: [imageGenerationTool],
  };

  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    let responseBody: OpenAiImageResponseBody | null = null;

    try {
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
      responseBody = (await response.json().catch(() => null)) as OpenAiImageResponseBody | null;
    } catch (error) {
      const normalized = normalizeProviderError({ error });
      if (!normalized.retryable || attempt === OPENAI_MAX_ATTEMPTS) {
        throw new AppError(
          normalized.message || "productImageStudioProviderFailed",
          "INTERNAL_SERVER_ERROR",
          502,
        );
      }
      await sleep(250 * attempt);
      continue;
    }

    if (!response.ok) {
      const normalized = normalizeProviderError({
        status: response.status,
        body: responseBody,
      });
      if (!normalized.retryable || attempt === OPENAI_MAX_ATTEMPTS) {
        throw new AppError(
          normalized.message || "productImageStudioProviderFailed",
          "INTERNAL_SERVER_ERROR",
          502,
        );
      }
      await sleep(250 * attempt);
      continue;
    }

    const generated = extractGeneratedImageResult(responseBody);
    if (!generated) {
      if (attempt === OPENAI_MAX_ATTEMPTS) {
        throw new AppError("productImageStudioProviderOutputMissing", "INTERNAL_SERVER_ERROR", 502);
      }
      await sleep(250 * attempt);
      continue;
    }

    const imageBuffer = Buffer.from(generated.imageBase64, "base64");
    if (!imageBuffer.length) {
      throw new AppError("productImageStudioProviderOutputMissing", "INTERNAL_SERVER_ERROR", 502);
    }

    const mimeType = await detectMimeTypeFromBuffer(imageBuffer, "image/jpeg");

    return {
      imageBuffer,
      mimeType,
      requestSummary,
      responseSummary: {
        ...sanitizeProviderResponseSummary(responseBody),
        revisedPrompt: generated.revisedPrompt,
      },
      providerJobId: generated.providerJobId,
    };
  }

  throw new AppError("productImageStudioProviderFailed", "INTERNAL_SERVER_ERROR", 502);
};

const persistGeneratedImage = async (input: {
  organizationId: string;
  jobId: string;
  buffer: Buffer;
  mimeType: string;
}) => {
  try {
    const uploaded = await uploadProductImageBuffer({
      organizationId: input.organizationId,
      buffer: input.buffer,
      contentType: input.mimeType,
      sourceFileName: `product-image-studio-${input.jobId}.${input.mimeType.split("/")[1] ?? "jpg"}`,
    });
    return {
      url: uploaded.url,
      mimeType: input.mimeType,
      bytes: input.buffer.length,
    };
  } catch (error) {
    throw new AppError("productImageStudioOutputPersistFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};

const attachGeneratedImageToProduct = async (input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  product: AccessibleProduct;
  imageUrl: string;
  setAsPrimary: boolean;
}) => {
  const currentImages = input.product.images;
  const existingImage = currentImages.find((image) => image.url === input.imageUrl) ?? null;

  if (!existingImage) {
    if (input.setAsPrimary) {
      const created = await input.tx.productImage.create({
        data: {
          organizationId: input.organizationId,
          productId: input.product.id,
          url: input.imageUrl,
          position: 0,
          isAiGenerated: true,
        },
      });

      for (const image of currentImages) {
        await input.tx.productImage.update({
          where: { id: image.id },
          data: { position: image.position + 1 },
        });
      }

      await input.tx.product.update({
        where: { id: input.product.id },
        data: { photoUrl: input.imageUrl },
      });

      return created.id;
    }

    const created = await input.tx.productImage.create({
      data: {
        organizationId: input.organizationId,
        productId: input.product.id,
        url: input.imageUrl,
        position: currentImages.length,
        isAiGenerated: true,
      },
    });

    if (!input.product.photoUrl) {
      await input.tx.product.update({
        where: { id: input.product.id },
        data: { photoUrl: input.imageUrl },
      });
    }

    return created.id;
  }

  await input.tx.productImage.update({
    where: { id: existingImage.id },
    data: { isAiGenerated: true },
  });

  if (!input.setAsPrimary) {
    if (!input.product.photoUrl) {
      await input.tx.product.update({
        where: { id: input.product.id },
        data: { photoUrl: input.imageUrl },
      });
    }
    return existingImage.id;
  }

  const reordered = [
    existingImage,
    ...currentImages.filter((image) => image.id !== existingImage.id),
  ];
  for (const [index, image] of reordered.entries()) {
    await input.tx.productImage.update({
      where: { id: image.id },
      data: {
        position: index,
        ...(image.id === existingImage.id ? { isAiGenerated: true } : {}),
      },
    });
  }

  await input.tx.product.update({
    where: { id: input.product.id },
    data: { photoUrl: input.imageUrl },
  });

  return existingImage.id;
};

const productImageStudioJobSelect = {
  id: true,
  productId: true,
  status: true,
  sourceImageUrl: true,
  sourceImageMimeType: true,
  sourceImageBytes: true,
  outputImageUrl: true,
  outputImageMimeType: true,
  outputImageBytes: true,
  backgroundMode: true,
  outputFormat: true,
  centered: true,
  improveVisibility: true,
  softShadow: true,
  tighterCrop: true,
  brighterPresentation: true,
  provider: true,
  providerJobId: true,
  requestPrompt: true,
  providerRequestJson: true,
  providerResponseJson: true,
  errorMessage: true,
  savedProductImageId: true,
  savedAsPrimary: true,
  savedAt: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  createdBy: {
    select: {
      id: true,
      name: true,
    },
  },
  product: {
    select: {
      id: true,
      sku: true,
      name: true,
      images: {
        select: { url: true },
        orderBy: { position: "asc" },
        take: 1,
      },
    },
  },
} satisfies Prisma.ProductImageStudioJobSelect;

const serializeJob = (
  job: Prisma.ProductImageStudioJobGetPayload<{ select: typeof productImageStudioJobSelect }>,
) => ({
  ...job,
  sourcePreviewPath: `/api/product-image-studio/jobs/${job.id}/image?kind=source`,
  outputPreviewPath: job.outputImageUrl
    ? `/api/product-image-studio/jobs/${job.id}/image?kind=output`
    : null,
  canRetry:
    job.status === ProductImageStudioJobStatus.FAILED ||
    job.status === ProductImageStudioJobStatus.SUCCEEDED,
  canSaveToProduct:
    job.status === ProductImageStudioJobStatus.SUCCEEDED && Boolean(job.outputImageUrl),
  productImageUrl: job.product?.images[0]?.url ?? null,
});

export const getProductImageStudioOverview = async (organizationId: string) => {
  const providerConfigured = Boolean(resolveProviderConfig());
  const [jobs, latestJob] = await Promise.all([
    prisma.productImageStudioJob.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: { _all: true },
    }),
    prisma.productImageStudioJob.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  ]);

  const counts = jobs.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  const totalJobs = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const succeededJobs = counts[ProductImageStudioJobStatus.SUCCEEDED] ?? 0;
  const failedJobs = counts[ProductImageStudioJobStatus.FAILED] ?? 0;
  const queuedJobs = counts[ProductImageStudioJobStatus.QUEUED] ?? 0;
  const processingJobs = counts[ProductImageStudioJobStatus.PROCESSING] ?? 0;

  const status: ProductImageStudioOverviewStatus = !providerConfigured
    ? "NOT_CONFIGURED"
    : latestJob?.status === ProductImageStudioJobStatus.FAILED
      ? "ERROR"
      : "READY";

  return {
    configured: providerConfigured,
    status,
    totalJobs,
    succeededJobs,
    failedJobs,
    queuedJobs,
    processingJobs,
    lastGeneratedAt: latestJob?.completedAt ?? null,
    lastRequestedAt: latestJob?.createdAt ?? null,
  };
};

export const listProductImageStudioJobs = async (organizationId: string, limit = 50) => {
  const jobs = await prisma.productImageStudioJob.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: productImageStudioJobSelect,
  });

  return jobs.map(serializeJob);
};

export const getProductImageStudioJob = async (organizationId: string, jobId: string) => {
  const job = await prisma.productImageStudioJob.findFirst({
    where: {
      id: jobId,
      organizationId,
    },
    select: productImageStudioJobSelect,
  });

  if (!job) {
    throw new AppError("productImageStudioJobNotFound", "NOT_FOUND", 404);
  }

  return serializeJob(job);
};

export const createProductImageStudioJob = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  sourceImageUrl: string;
  productId?: string | null;
  backgroundMode: ProductImageStudioBackground;
  outputFormat: ProductImageStudioOutputFormat;
  centered: boolean;
  improveVisibility: boolean;
  softShadow?: boolean;
  tighterCrop?: boolean;
  brighterPresentation?: boolean;
}) => {
  const presets: ProductImageStudioPresetInput = {
    backgroundMode: input.backgroundMode,
    outputFormat: input.outputFormat,
    centered: input.centered,
    improveVisibility: input.improveVisibility,
    softShadow: Boolean(input.softShadow),
    tighterCrop: Boolean(input.tighterCrop),
    brighterPresentation: Boolean(input.brighterPresentation),
  };
  validatePresetSelection(presets);

  const [product, sourceImage] = await Promise.all([
    ensureProductAccess(input.organizationId, input.productId),
    validateUploadedImage({
      organizationId: input.organizationId,
      sourceImageUrl: input.sourceImageUrl,
    }),
  ]);

  const activeJob = await prisma.productImageStudioJob.findFirst({
    where: {
      organizationId: input.organizationId,
      sourceImageUrl: sourceImage.normalizedUrl,
      productId: product?.id ?? null,
      backgroundMode: presets.backgroundMode,
      outputFormat: presets.outputFormat,
      centered: presets.centered,
      improveVisibility: presets.improveVisibility,
      softShadow: presets.softShadow,
      tighterCrop: presets.tighterCrop,
      brighterPresentation: presets.brighterPresentation,
      status: {
        in: [ProductImageStudioJobStatus.QUEUED, ProductImageStudioJobStatus.PROCESSING],
      },
    },
    select: { id: true },
  });

  if (activeJob) {
    return { jobId: activeJob.id, deduplicated: true };
  }

  const prompt = buildStructuredEnhancementPrompt({
    ...presets,
    productName: product?.name ?? null,
  });

  const job = await prisma.productImageStudioJob.create({
    data: {
      organizationId: input.organizationId,
      productId: product?.id ?? null,
      createdById: input.actorId,
      status: ProductImageStudioJobStatus.QUEUED,
      sourceImageUrl: sourceImage.normalizedUrl,
      sourceImageMimeType: sourceImage.mimeType,
      sourceImageBytes: sourceImage.bytes,
      backgroundMode: presets.backgroundMode,
      outputFormat: presets.outputFormat,
      centered: presets.centered,
      improveVisibility: presets.improveVisibility,
      softShadow: presets.softShadow,
      tighterCrop: presets.tighterCrop,
      brighterPresentation: presets.brighterPresentation,
      provider: PROVIDER_NAME,
      requestPrompt: prompt,
    },
    select: { id: true },
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "PRODUCT_IMAGE_STUDIO_JOB_CREATED",
    entity: "ProductImageStudioJob",
    entityId: job.id,
    requestId: input.requestId,
    after: {
      jobId: job.id,
      productId: product?.id ?? null,
      backgroundMode: presets.backgroundMode,
      outputFormat: presets.outputFormat,
    },
  });

  await runJob(PRODUCT_IMAGE_STUDIO_JOB_NAME, {
    jobId: job.id,
  });

  return { jobId: job.id, deduplicated: false };
};

export const retryProductImageStudioJob = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  jobId: string;
}) => {
  const job = await prisma.productImageStudioJob.findFirst({
    where: {
      id: input.jobId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      productId: true,
      status: true,
      sourceImageUrl: true,
      backgroundMode: true,
      outputFormat: true,
      centered: true,
      improveVisibility: true,
      softShadow: true,
      tighterCrop: true,
      brighterPresentation: true,
    },
  });

  if (!job) {
    throw new AppError("productImageStudioJobNotFound", "NOT_FOUND", 404);
  }
  if (
    job.status !== ProductImageStudioJobStatus.FAILED &&
    job.status !== ProductImageStudioJobStatus.SUCCEEDED
  ) {
    throw new AppError("productImageStudioRetryUnavailable", "BAD_REQUEST", 400);
  }

  return createProductImageStudioJob({
    organizationId: input.organizationId,
    actorId: input.actorId,
    requestId: input.requestId,
    sourceImageUrl: job.sourceImageUrl,
    productId: job.productId,
    backgroundMode: job.backgroundMode,
    outputFormat: job.outputFormat,
    centered: job.centered,
    improveVisibility: job.improveVisibility,
    softShadow: job.softShadow,
    tighterCrop: job.tighterCrop,
    brighterPresentation: job.brighterPresentation,
  });
};

export const saveGeneratedImageToProduct = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  jobId: string;
  productId?: string | null;
  setAsPrimary?: boolean;
}) => {
  const job = await prisma.productImageStudioJob.findFirst({
    where: {
      id: input.jobId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      productId: true,
      status: true,
      outputImageUrl: true,
      savedProductImageId: true,
    },
  });

  if (!job) {
    throw new AppError("productImageStudioJobNotFound", "NOT_FOUND", 404);
  }
  if (job.status !== ProductImageStudioJobStatus.SUCCEEDED || !job.outputImageUrl) {
    throw new AppError("productImageStudioAttachFailed", "BAD_REQUEST", 400);
  }

  const targetProductId = input.productId?.trim() || job.productId;
  if (!targetProductId) {
    throw new AppError("productImageStudioProductRequired", "BAD_REQUEST", 400);
  }

  const product = await ensureProductAccess(input.organizationId, targetProductId);
  if (!product) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }
  const outputImageUrl = job.outputImageUrl;
  if (!outputImageUrl) {
    throw new AppError("productImageStudioAttachFailed", "BAD_REQUEST", 400);
  }
  const setAsPrimary = Boolean(input.setAsPrimary);

  const result = await prisma.$transaction(async (tx) => {
    const savedProductImageId = await attachGeneratedImageToProduct({
      tx,
      organizationId: input.organizationId,
      product,
      imageUrl: outputImageUrl,
      setAsPrimary,
    });

    await tx.productImageStudioJob.update({
      where: { id: job.id },
      data: {
        productId: product.id,
        savedProductImageId,
        savedAsPrimary: setAsPrimary,
        savedAt: new Date(),
      },
    });

    return {
      productId: product.id,
      productImageId: savedProductImageId,
    };
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "PRODUCT_IMAGE_STUDIO_JOB_SAVED",
    entity: "ProductImageStudioJob",
    entityId: job.id,
    requestId: input.requestId,
    after: {
      jobId: job.id,
      productId: result.productId,
      productImageId: result.productImageId,
      setAsPrimary,
    },
  });

  return {
    jobId: job.id,
    productId: result.productId,
    productImageId: result.productImageId,
  };
};

export const setGeneratedImageAsPrimary = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  jobId: string;
  productId?: string | null;
}) =>
  saveGeneratedImageToProduct({
    ...input,
    setAsPrimary: true,
  });

const processQueuedProductImageStudioJob = async (jobId?: string) => {
  const job = jobId
    ? await prisma.productImageStudioJob.findFirst({
        where: {
          id: jobId,
          status: ProductImageStudioJobStatus.QUEUED,
        },
      })
    : await prisma.productImageStudioJob.findFirst({
        where: { status: ProductImageStudioJobStatus.QUEUED },
        orderBy: { createdAt: "asc" },
      });

  if (!job) {
    return {
      job: jobId ?? "unknown",
      status: "skipped" as const,
      details: { reason: "no-queued-job" },
    };
  }

  const running = await prisma.productImageStudioJob.update({
    where: { id: job.id },
    data: {
      status: ProductImageStudioJobStatus.PROCESSING,
      errorMessage: null,
      providerRequestJson: Prisma.DbNull,
      providerResponseJson: Prisma.DbNull,
      completedAt: null,
    },
  });

  try {
    const sourceImage = await validateUploadedImage({
      organizationId: running.organizationId,
      sourceImageUrl: running.sourceImageUrl,
    });
    const providerResult = await callOpenAiImageEnhancement({
      jobId: running.id,
      sourceImage,
      prompt:
        running.requestPrompt ||
        buildStructuredEnhancementPrompt({
          backgroundMode: running.backgroundMode,
          outputFormat: running.outputFormat,
          centered: running.centered,
          improveVisibility: running.improveVisibility,
          softShadow: running.softShadow,
          tighterCrop: running.tighterCrop,
          brighterPresentation: running.brighterPresentation,
        }),
      presets: {
        backgroundMode: running.backgroundMode,
        outputFormat: running.outputFormat,
        centered: running.centered,
        improveVisibility: running.improveVisibility,
        softShadow: running.softShadow,
        tighterCrop: running.tighterCrop,
        brighterPresentation: running.brighterPresentation,
      },
    });
    const persistedOutput = await persistGeneratedImage({
      organizationId: running.organizationId,
      jobId: running.id,
      buffer: providerResult.imageBuffer,
      mimeType: providerResult.mimeType,
    });

    const finished = await prisma.productImageStudioJob.update({
      where: { id: running.id },
      data: {
        status: ProductImageStudioJobStatus.SUCCEEDED,
        outputImageUrl: persistedOutput.url,
        outputImageMimeType: persistedOutput.mimeType,
        outputImageBytes: persistedOutput.bytes,
        providerJobId: providerResult.providerJobId,
        providerRequestJson: providerResult.requestSummary,
        providerResponseJson: providerResult.responseSummary,
        completedAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      organizationId: finished.organizationId,
      actorId: finished.createdById,
      action: "PRODUCT_IMAGE_STUDIO_JOB_SUCCEEDED",
      entity: "ProductImageStudioJob",
      entityId: finished.id,
      requestId: randomUUID(),
      after: {
        jobId: finished.id,
        outputImageUrl: finished.outputImageUrl,
      },
    });

    return {
      job: finished.id,
      status: "ok" as const,
      details: {
        status: finished.status,
      },
    };
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError("productImageStudioProviderFailed", "INTERNAL_SERVER_ERROR", 502);
    const failed = await prisma.productImageStudioJob.update({
      where: { id: running.id },
      data: {
        status: ProductImageStudioJobStatus.FAILED,
        errorMessage: appError.message,
        completedAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      organizationId: failed.organizationId,
      actorId: failed.createdById,
      action: "PRODUCT_IMAGE_STUDIO_JOB_FAILED",
      entity: "ProductImageStudioJob",
      entityId: failed.id,
      requestId: randomUUID(),
      after: {
        jobId: failed.id,
        errorMessage: failed.errorMessage,
      },
    });

    return {
      job: failed.id,
      status: "ok" as const,
      details: {
        status: failed.status,
      },
    };
  }
};

const runProductImageStudioJob = async (payload?: JobPayload) => {
  const requestedJobId =
    isObject(payload) && "jobId" in payload && typeof payload.jobId === "string"
      ? payload.jobId
      : undefined;
  return processQueuedProductImageStudioJob(requestedJobId);
};

registerJob(PRODUCT_IMAGE_STUDIO_JOB_NAME, {
  handler: runProductImageStudioJob,
});
