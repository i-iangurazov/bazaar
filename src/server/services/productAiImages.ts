import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

import sharp from "sharp";

import {
  downloadRemoteImage,
  normalizeProductImageUrl,
} from "@/server/services/productImageStorage";

const MAX_INPUT_IMAGES = 3;
const AI_IMAGE_MAX_DIMENSION = 1024;
const AI_IMAGE_TARGET_BYTES = 350_000;
const MANAGED_UPLOAD_PREFIX = "/uploads/imported-products/";
const publicRootDir = resolve(process.cwd(), "public");

type DownloadedImage = {
  buffer: Buffer;
  contentType: string;
};

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

const readManagedLocalImage = async (sourceUrl: string): Promise<DownloadedImage | null> => {
  const filePath = resolveManagedLocalImagePath(sourceUrl);
  if (!filePath) {
    return null;
  }

  const contentType = imageMimeByExtension[extname(filePath).toLowerCase()];
  if (!contentType) {
    return null;
  }

  try {
    const buffer = await readFile(filePath);
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
};

const loadImageForPrompt = async (rawUrl: string) => {
  const normalizedUrl = normalizeProductImageUrl(rawUrl);
  if (!normalizedUrl) {
    return null;
  }

  if (normalizedUrl.startsWith(MANAGED_UPLOAD_PREFIX)) {
    return readManagedLocalImage(normalizedUrl);
  }

  if (normalizedUrl.startsWith("data:image/")) {
    return null;
  }

  return downloadRemoteImage(normalizedUrl);
};

const toDataUrl = (image: DownloadedImage) =>
  `data:${image.contentType};base64,${image.buffer.toString("base64")}`;

const optimizeImageForModel = async (image: DownloadedImage): Promise<DownloadedImage> => {
  const sourceBytes = image.buffer.byteLength;
  if (sourceBytes <= AI_IMAGE_TARGET_BYTES / 2 && image.contentType === "image/jpeg") {
    return image;
  }

  const candidates: Array<{ maxDimension: number; quality: number }> = [
    { maxDimension: AI_IMAGE_MAX_DIMENSION, quality: 72 },
    { maxDimension: AI_IMAGE_MAX_DIMENSION, quality: 60 },
    { maxDimension: 896, quality: 56 },
    { maxDimension: 768, quality: 50 },
    { maxDimension: 640, quality: 44 },
  ];

  let bestBuffer: Buffer | null = null;
  for (const candidate of candidates) {
    try {
      const nextBuffer = await sharp(image.buffer, { pages: 1 })
        .rotate()
        .resize({
          width: candidate.maxDimension,
          height: candidate.maxDimension,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({
          quality: candidate.quality,
          mozjpeg: true,
        })
        .toBuffer();

      if (!bestBuffer || nextBuffer.byteLength < bestBuffer.byteLength) {
        bestBuffer = nextBuffer;
      }
      if (nextBuffer.byteLength <= AI_IMAGE_TARGET_BYTES) {
        bestBuffer = nextBuffer;
        break;
      }
    } catch {
      return image;
    }
  }

  if (!bestBuffer || bestBuffer.byteLength >= sourceBytes) {
    return image;
  }

  return {
    buffer: bestBuffer,
    contentType: "image/jpeg",
  };
};

const prepareImageForModel = async (url: string) => {
  const source = await loadImageForPrompt(url);
  if (!source) return null;
  const optimized = await optimizeImageForModel(source);
  return {
    dataUrl: toDataUrl(optimized),
    sourceBytes: source.buffer.byteLength,
    payloadBytes: optimized.buffer.byteLength,
  };
};

export type ProductAiImagePreparer = typeof prepareImageForModel;

// One product operation may generate both its description and its specs.
export const createProductAiImagePreparer = (): ProductAiImagePreparer => {
  const preparations = new Map<string, ReturnType<ProductAiImagePreparer>>();
  return (url) => {
    const existing = preparations.get(url);
    if (existing) return existing;
    const preparation = prepareImageForModel(url).then(
      (result) => {
        if (!result) preparations.delete(url);
        return result;
      },
      (error) => {
        preparations.delete(url);
        throw error;
      },
    );
    if (preparations.size < MAX_INPUT_IMAGES) preparations.set(url, preparation);
    return preparation;
  };
};

export const prepareProductAiImages = async (
  urls: string[],
  prepare: ProductAiImagePreparer = prepareImageForModel,
) => {
  const normalizedUrls = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, MAX_INPUT_IMAGES);
  const startedAt = Date.now();
  const preparedImages = await Promise.all(
    normalizedUrls.map(async (url) => {
      const imageStartedAt = Date.now();
      const image = await prepare(url);
      return {
        image,
        metrics: {
          url,
          durationMs: Date.now() - imageStartedAt,
          ok: Boolean(image),
          bytes: image?.sourceBytes ?? 0,
        },
      };
    }),
  );
  const images = preparedImages.flatMap(({ image }) => (image ? [image] : []));
  return {
    imageDataUrls: images.map((image) => image.dataUrl),
    imageLoadMetrics: preparedImages.map(({ metrics }) => metrics),
    imageLoadDurationMs: Date.now() - startedAt,
    sourceImageBytes: images.reduce((total, image) => total + image.sourceBytes, 0),
    payloadImageBytes: images.reduce((total, image) => total + image.payloadBytes, 0),
    imageCount: normalizedUrls.length,
  };
};

export const prepareProductAiImage = async (url: string) => {
  const image = await loadImageForPrompt(url);
  if (!image || image.buffer.length > 5 * 1024 * 1024) return null;
  return toDataUrl(await optimizeImageForModel(image));
};
