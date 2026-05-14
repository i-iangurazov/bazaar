export const supportedImageExtensions = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "svg",
  "heic",
  "heif",
  "heics",
  "heifs",
  "hif",
]);

export const supportedProductImageUploadMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const supportedProductImageMimeByExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const normalizeImageMimeType = (value: string) => {
  const normalized = value.toLowerCase().split(";")[0]?.trim() ?? "";
  if (normalized === "image/jpg" || normalized === "image/pjpeg") {
    return "image/jpeg";
  }
  if (normalized === "image/heic-sequence" || normalized === "image/x-heic") {
    return "image/heic";
  }
  if (normalized === "image/heics" || normalized === "image/x-heics") {
    return "image/heic";
  }
  if (normalized === "image/heif-sequence" || normalized === "image/x-heif") {
    return "image/heif";
  }
  if (normalized === "image/heifs" || normalized === "image/x-heifs") {
    return "image/heif";
  }
  return normalized;
};

const hasSupportedImageExtension = (fileName: string) => {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return Boolean(ext && supportedImageExtensions.has(ext));
};

export const resolveProductImageUploadMimeType = (file: File) => {
  const normalizedType = normalizeImageMimeType(file.type);
  if (supportedProductImageUploadMimeTypes.has(normalizedType)) {
    return normalizedType;
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext ? (supportedProductImageMimeByExtension[ext] ?? "") : "";
};

export const isHeicLikeFile = (file: File) => {
  const normalizedType = normalizeImageMimeType(file.type);
  if (normalizedType.includes("heic") || normalizedType.includes("heif")) {
    return true;
  }
  return /\.(heic|heics|heif|heifs|hif)$/i.test(file.name);
};

export const isImageLikeFile = (file: File) => {
  if (normalizeImageMimeType(file.type).startsWith("image/")) {
    return true;
  }
  return hasSupportedImageExtension(file.name);
};

export const resolvePrimaryImageUrl = (images: Array<{ url?: string | null }>) => {
  for (const image of images) {
    const normalized = image.url?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
};

const defaultProductImageUploadTimeoutMs = 45_000;
const defaultProductImageDirectUploadTimeoutMs = 120_000;

export class ProductImageUploadTimeoutError extends Error {
  constructor() {
    super("imageUploadTimedOut");
    this.name = "ProductImageUploadTimeoutError";
  }
}

export const resolveProductImageUploadTimeoutMs = (value?: string | null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : defaultProductImageUploadTimeoutMs;
};

export const resolveProductImageDirectUploadTimeoutMs = (value?: string | null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000
    ? parsed
    : defaultProductImageDirectUploadTimeoutMs;
};

const fetchWithTimeout = async ({
  url,
  timeoutMs,
  fetchImpl = fetch,
  init,
}: {
  url: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  init: RequestInit;
}) => {
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<Response>((_, reject) => {
    timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ProductImageUploadTimeoutError());
    }, timeoutMs);
  });
  const request = fetchImpl(url, {
    ...init,
    signal: controller.signal,
  });

  try {
    return await Promise.race([request, timeoutPromise]);
  } catch (error) {
    if (timedOut || controller.signal.aborted) {
      throw new ProductImageUploadTimeoutError();
    }
    throw error;
  } finally {
    if (timeout) {
      globalThis.clearTimeout(timeout);
    }
  }
};

export const fetchProductImageUpload = async ({
  url,
  formData,
  timeoutMs = resolveProductImageUploadTimeoutMs(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS),
  fetchImpl = fetch,
}: {
  url: string;
  formData: FormData;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) =>
  fetchWithTimeout({
    url,
    timeoutMs,
    fetchImpl,
    init: {
      method: "POST",
      body: formData,
    },
  });

export type ProductImageDirectUploadTarget = {
  method: "PUT";
  uploadUrl: string;
  url: string;
  headers?: Record<string, string>;
  expiresIn?: number;
};

export const fetchProductImageDirectUploadTarget = async ({
  file,
  productId,
  timeoutMs = resolveProductImageUploadTimeoutMs(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS),
  fetchImpl = fetch,
}: {
  file: File;
  productId?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) =>
  fetchWithTimeout({
    url: "/api/product-images/upload-url",
    timeoutMs,
    fetchImpl,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName: file.name,
        contentType: resolveProductImageUploadMimeType(file) || normalizeImageMimeType(file.type),
        fileSize: file.size,
        productId: productId || undefined,
      }),
    },
  });

export const putProductImageDirectUpload = async ({
  target,
  file,
  timeoutMs = resolveProductImageDirectUploadTimeoutMs(
    process.env.NEXT_PUBLIC_PRODUCT_IMAGE_DIRECT_UPLOAD_TIMEOUT_MS ??
      process.env.NEXT_PUBLIC_PRODUCT_IMAGE_UPLOAD_TIMEOUT_MS,
  ),
  fetchImpl = fetch,
}: {
  target: ProductImageDirectUploadTarget;
  file: File;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) =>
  fetchWithTimeout({
    url: target.uploadUrl,
    timeoutMs,
    fetchImpl,
    init: {
      method: target.method,
      headers: target.headers,
      body: file,
    },
  });

type PrepareProductImageFileInput = {
  file: File;
  maxImageBytes: number;
  maxInputImageBytes: number;
  convertHeicToJpeg: (file: File) => Promise<File | null>;
  optimizeImageToLimit: (file: File) => Promise<File | null>;
};

export type PrepareProductImageFileError =
  | "imageTooLargeInput"
  | "imageCompressionFailed"
  | "imageInvalidType"
  | "imageTooLargeAfterCompression";

export type PrepareProductImageFileResult =
  | { ok: true; file: File }
  | { ok: false; code: PrepareProductImageFileError; reason: string };

export const prepareProductImageFileForUpload = async (
  input: PrepareProductImageFileInput,
): Promise<PrepareProductImageFileResult> => {
  const { maxImageBytes, maxInputImageBytes } = input;
  if (input.file.size < 1) {
    return {
      ok: false,
      code: "imageInvalidType",
      reason: "empty-file",
    };
  }

  if (input.file.size > maxInputImageBytes) {
    return {
      ok: false,
      code: "imageTooLargeInput",
      reason: `input-size:${input.file.size}>${maxInputImageBytes}`,
    };
  }

  let file = input.file;
  if (isHeicLikeFile(file)) {
    const converted = await input.convertHeicToJpeg(file);
    if (!converted) {
      return {
        ok: false,
        code: "imageCompressionFailed",
        reason: `heic-conversion-failed:${normalizeImageMimeType(file.type) || "unknown"}`,
      };
    }
    file = converted;
  }

  const uploadMimeType = resolveProductImageUploadMimeType(file);
  if (!uploadMimeType) {
    return {
      ok: false,
      code: "imageInvalidType",
      reason: `invalid-type:${normalizeImageMimeType(file.type) || "unknown"}`,
    };
  }
  if (normalizeImageMimeType(file.type) !== uploadMimeType) {
    file = new File([file], file.name, {
      type: uploadMimeType,
      lastModified: file.lastModified || Date.now(),
    });
  }

  if (file.size <= maxImageBytes) {
    return { ok: true, file };
  }

  const optimized = await input.optimizeImageToLimit(file);
  if (!optimized) {
    return {
      ok: false,
      code: "imageCompressionFailed",
      reason: "optimization-failed",
    };
  }
  if (optimized.size > maxImageBytes) {
    return {
      ok: false,
      code: "imageTooLargeAfterCompression",
      reason: `optimized-size:${optimized.size}>${maxImageBytes}`,
    };
  }

  return { ok: true, file: optimized };
};
