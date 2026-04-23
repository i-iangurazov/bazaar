import {
  normalizeImageMimeType,
  prepareProductImageFileForUpload,
  type PrepareProductImageFileResult,
} from "@/lib/productImageUpload";

export const defaultProductImageMaxBytes = 5 * 1024 * 1024;
export const defaultProductImageMaxInputBytes = 10 * 1024 * 1024;

export const resolveClientImageMaxBytes = () => {
  const parsed = Number(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_MAX_BYTES);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return defaultProductImageMaxBytes;
};

export const resolveClientImageMaxInputBytes = (maxImageBytes: number) => {
  const parsed = Number(process.env.NEXT_PUBLIC_PRODUCT_IMAGE_MAX_INPUT_BYTES);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(Math.trunc(parsed), maxImageBytes);
  }
  return Math.max(defaultProductImageMaxInputBytes, maxImageBytes);
};

type ImagePrepLogger = (step: string, details?: Record<string, unknown>, error?: unknown) => void;

const replaceFileExtension = (fileName: string, extension: string) => {
  if (!fileName.includes(".")) {
    return `${fileName}.${extension}`;
  }
  return fileName.replace(/\.[^.]+$/, `.${extension}`);
};

const resolveImageExtensionByMime = (mimeType: string) => {
  const normalizedMimeType = normalizeImageMimeType(mimeType);
  if (normalizedMimeType === "image/png") {
    return "png";
  }
  if (normalizedMimeType === "image/heic") {
    return "heic";
  }
  if (normalizedMimeType === "image/heif") {
    return "heif";
  }
  if (normalizedMimeType === "image/webp") {
    return "webp";
  }
  if (normalizedMimeType === "image/gif") {
    return "gif";
  }
  if (normalizedMimeType === "image/avif") {
    return "avif";
  }
  if (normalizedMimeType === "image/bmp") {
    return "bmp";
  }
  if (normalizedMimeType === "image/tiff") {
    return "tiff";
  }
  return "jpg";
};

const resolveHeicLikeMimeType = (file: File) => {
  const normalizedType = normalizeImageMimeType(file.type);
  if (normalizedType === "image/heic" || normalizedType === "image/heif") {
    return normalizedType;
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "heic" || ext === "heics") {
    return "image/heic";
  }
  if (ext === "heif" || ext === "heifs" || ext === "hif") {
    return "image/heif";
  }
  return "";
};

const encodeCanvasToFile = async (input: {
  canvas: HTMLCanvasElement;
  fileName: string;
  lastModified: number;
  type: "image/jpeg" | "image/png" | "image/webp";
  quality?: number;
}) => {
  const blob = await new Promise<Blob | null>((resolve) => {
    if (input.type === "image/jpeg" || input.type === "image/webp") {
      input.canvas.toBlob(resolve, input.type, input.quality ?? 1);
      return;
    }
    input.canvas.toBlob(resolve, input.type);
  });
  if (!blob) {
    return null;
  }
  return new File([blob], input.fileName, {
    type: input.type,
    lastModified: input.lastModified,
  });
};

const logErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string") {
      return candidate;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error ?? "");
};

const convertBrowserReadableImageToJpeg = async (file: File) => {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("imageReadFailed"));
      nextImage.src = objectUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return encodeCanvasToFile({
      canvas,
      fileName: replaceFileExtension(file.name, "jpg"),
      lastModified: file.lastModified || Date.now(),
      type: "image/jpeg",
      quality: 0.95,
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const createImageOptimizer = (input: {
  maxImageBytes: number;
  logger?: ImagePrepLogger;
}) => {
  const { logger, maxImageBytes } = input;

  return async (file: File) => {
    const normalizedType = normalizeImageMimeType(file.type);
    if (!["image/jpeg", "image/png", "image/webp"].includes(normalizedType)) {
      logger?.("optimize-unsupported-type", {
        fileName: file.name,
        size: file.size,
        type: file.type,
        normalizedType,
      });
      return null;
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("imageCompressionFailed"));
        nextImage.src = objectUrl;
      });

      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        logger?.("optimize-invalid-dimensions", {
          fileName: file.name,
          size: file.size,
          width,
          height,
        });
        return null;
      }

      const optimizeFromDimensions = async (
        targetWidth: number,
        targetHeight: number,
        allowAggressiveQuality = false,
      ) => {
        const canvas = document.createElement("canvas");
        const safeWidth = Math.max(1, Math.round(targetWidth));
        const safeHeight = Math.max(1, Math.round(targetHeight));
        canvas.width = safeWidth;
        canvas.height = safeHeight;

        const context = canvas.getContext("2d");
        if (!context) {
          return null;
        }
        context.drawImage(image, 0, 0, safeWidth, safeHeight);

        const candidates: File[] = [];
        const pushCandidate = (candidate: File | null) => {
          if (candidate) {
            candidates.push(candidate);
          }
        };

        pushCandidate(
          await encodeCanvasToFile({
            canvas,
            fileName: file.name,
            lastModified: file.lastModified || Date.now(),
            type: normalizedType as "image/jpeg" | "image/png" | "image/webp",
            quality: 1,
          }),
        );
        pushCandidate(
          await encodeCanvasToFile({
            canvas,
            fileName: file.name,
            lastModified: file.lastModified || Date.now(),
            type: "image/webp",
            quality: 1,
          }),
        );
        if (normalizedType !== "image/png") {
          pushCandidate(
            await encodeCanvasToFile({
              canvas,
              fileName: file.name,
              lastModified: file.lastModified || Date.now(),
              type: "image/jpeg",
              quality: 1,
            }),
          );
        }

        if (!candidates.length) {
          logger?.("optimize-no-candidates", {
            fileName: file.name,
            targetWidth: safeWidth,
            targetHeight: safeHeight,
          });
          return null;
        }

        let best = candidates.reduce((smallest, candidate) =>
          candidate.size < smallest.size ? candidate : smallest,
        );
        if (best.size <= maxImageBytes) {
          return best;
        }

        const fallbackType: "image/jpeg" | "image/webp" =
          normalizedType === "image/png" ? "image/webp" : "image/jpeg";
        const qualitySteps = allowAggressiveQuality
          ? ([0.98, 0.95, 0.92, 0.9, 0.88, 0.85, 0.82, 0.78, 0.74, 0.7, 0.66, 0.62, 0.58] as const)
          : ([0.98, 0.95, 0.92, 0.9, 0.88, 0.85, 0.82] as const);

        for (const quality of qualitySteps) {
          const optimized = await encodeCanvasToFile({
            canvas,
            fileName: file.name,
            lastModified: file.lastModified || Date.now(),
            type: fallbackType,
            quality,
          });
          if (!optimized) {
            continue;
          }
          if (optimized.size < best.size) {
            best = optimized;
          }
          if (optimized.size <= maxImageBytes) {
            return optimized;
          }
        }

        return best;
      };

      const maxCanvasPixels = 28_000_000;
      const maxCanvasSide = 8192;
      const areaScale =
        width * height > maxCanvasPixels ? Math.sqrt(maxCanvasPixels / (width * height)) : 1;
      const sideScale =
        Math.max(width, height) > maxCanvasSide ? maxCanvasSide / Math.max(width, height) : 1;
      const safeBaseScale = Math.min(1, areaScale, sideScale);
      let targetWidth = Math.max(1, Math.round(width * safeBaseScale));
      let targetHeight = Math.max(1, Math.round(height * safeBaseScale));

      let best = await optimizeFromDimensions(targetWidth, targetHeight, false);
      if (best?.size && best.size <= maxImageBytes) {
        return best;
      }

      const minDimension = 320;
      const maxResizePasses = 8;
      for (let pass = 0; pass < maxResizePasses; pass += 1) {
        const referenceSize = best?.size ?? file.size;
        if (referenceSize <= maxImageBytes) {
          return best;
        }
        if (targetWidth <= minDimension && targetHeight <= minDimension) {
          break;
        }

        const predictedScale = Math.sqrt(maxImageBytes / Math.max(referenceSize, 1));
        const stepScale = Math.min(0.9, Math.max(0.55, predictedScale * 0.98));
        const nextTargetWidth = Math.max(minDimension, Math.round(targetWidth * stepScale));
        const nextTargetHeight = Math.max(minDimension, Math.round(targetHeight * stepScale));

        if (nextTargetWidth === targetWidth && nextTargetHeight === targetHeight) {
          break;
        }

        targetWidth = nextTargetWidth;
        targetHeight = nextTargetHeight;
        const resized = await optimizeFromDimensions(targetWidth, targetHeight, true);
        if (!resized) {
          continue;
        }
        if (!best || resized.size < best.size) {
          best = resized;
        }
        if (resized.size <= maxImageBytes) {
          return resized;
        }
      }

      return best;
    } catch (error) {
      logger?.(
        "optimize-failed",
        {
          fileName: file.name,
          size: file.size,
          type: file.type,
        },
        error,
      );
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };
};

const createHeicConverter = (logger?: ImagePrepLogger) => {
  return async (file: File) => {
    const browserConverted = await convertBrowserReadableImageToJpeg(file);
    if (browserConverted) {
      logger?.("heic-convert-browser-decoded", {
        fileName: file.name,
        size: file.size,
        type: file.type,
        outputSize: browserConverted.size,
      });
      return browserConverted;
    }

    try {
      const heic2anyModule = await import("heic2any");
      const topLevelDefault = (heic2anyModule as { default?: unknown }).default;
      const nestedDefault =
        topLevelDefault && typeof topLevelDefault === "object"
          ? (topLevelDefault as { default?: unknown }).default
          : undefined;
      const convertCandidate =
        typeof topLevelDefault === "function"
          ? topLevelDefault
          : typeof nestedDefault === "function"
            ? nestedDefault
            : typeof (heic2anyModule as unknown) === "function"
              ? (heic2anyModule as unknown)
              : null;

      if (typeof convertCandidate !== "function") {
        logger?.("heic-convert-missing-function", {
          fileName: file.name,
          type: file.type,
          moduleKeys: Object.keys(heic2anyModule as Record<string, unknown>),
          defaultType: typeof topLevelDefault,
          nestedDefaultType: typeof nestedDefault,
        });
        return null;
      }

      const convert = convertCandidate as (options: {
        blob: Blob;
        toType: string;
        quality?: number;
      }) => Promise<Blob | Blob[]>;

      const converted = await convert({
        blob: file,
        toType: "image/jpeg",
        quality: 0.95,
      });
      const outputBlob = Array.isArray(converted) ? converted[0] : converted;
      if (!(outputBlob instanceof Blob)) {
        logger?.("heic-convert-invalid-output", {
          fileName: file.name,
          type: file.type,
          outputType: typeof outputBlob,
          isArray: Array.isArray(converted),
        });
        return null;
      }

      return new File([outputBlob], replaceFileExtension(file.name, "jpg"), {
        type: "image/jpeg",
        lastModified: file.lastModified || Date.now(),
      });
    } catch (error) {
      const rawMessage = logErrorMessage(error);
      const browserReadableMatch = rawMessage.match(
        /Image is already browser readable:\s*(image\/[a-zA-Z0-9.+-]+)/i,
      );
      const browserReadableMimeType = browserReadableMatch?.[1]
        ? normalizeImageMimeType(browserReadableMatch[1])
        : "";

      if (browserReadableMimeType.startsWith("image/")) {
        const browserReadableConverted = await convertBrowserReadableImageToJpeg(file);
        if (browserReadableConverted) {
          logger?.("heic-convert-browser-readable-decoded", {
            fileName: file.name,
            originalType: file.type,
            fallbackType: browserReadableMimeType,
            fallbackSize: browserReadableConverted.size,
            message: rawMessage,
          });
          return browserReadableConverted;
        }

        const fallbackFile = new File(
          [file],
          replaceFileExtension(file.name, resolveImageExtensionByMime(browserReadableMimeType)),
          {
            type: browserReadableMimeType,
            lastModified: file.lastModified || Date.now(),
          },
        );
        logger?.("heic-convert-browser-readable-fallback", {
          fileName: file.name,
          originalType: file.type,
          fallbackType: browserReadableMimeType,
          fallbackSize: fallbackFile.size,
          message: rawMessage,
        });
        return fallbackFile;
      }

      if (/ERR_LIBHEIF\b.*format not supported/i.test(rawMessage)) {
        const heicLikeMimeType = resolveHeicLikeMimeType(file);
        if (heicLikeMimeType) {
          const passThroughFile = new File(
            [file],
            replaceFileExtension(file.name, resolveImageExtensionByMime(heicLikeMimeType)),
            {
              type: heicLikeMimeType,
              lastModified: file.lastModified || Date.now(),
            },
          );
          logger?.("heic-convert-pass-through", {
            fileName: file.name,
            originalType: file.type,
            fallbackType: heicLikeMimeType,
            fallbackSize: passThroughFile.size,
            message: rawMessage,
          });
          return passThroughFile;
        }
      }

      logger?.(
        "heic-convert-failed",
        {
          fileName: file.name,
          size: file.size,
          type: file.type,
          message: rawMessage,
        },
        error,
      );
      return null;
    }
  };
};

export const prepareManagedProductImageForUpload = async (input: {
  file: File;
  maxImageBytes: number;
  maxInputImageBytes: number;
  logger?: ImagePrepLogger;
}): Promise<PrepareProductImageFileResult> => {
  const { file, logger, maxImageBytes, maxInputImageBytes } = input;

  return prepareProductImageFileForUpload({
    file,
    maxImageBytes,
    maxInputImageBytes,
    convertHeicToJpeg: createHeicConverter(logger),
    optimizeImageToLimit: createImageOptimizer({ maxImageBytes, logger }),
  });
};
