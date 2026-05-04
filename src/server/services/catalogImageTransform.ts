import sharp from "sharp";

const CATALOG_IMAGE_ASPECT_RATIO = 1;
const CATALOG_IMAGE_PADDING_RATIO = 0.1;
const WEBP_EFFORT = 4;
const TRIM_THRESHOLD = 10;

const transparentBackground = { r: 0, g: 0, b: 0, alpha: 0 };

export const shouldFrameCatalogProductImage = (input: {
  metadata: Pick<sharp.Metadata, "format" | "hasAlpha">;
  sourceMimeType: string;
}) => {
  return input.metadata.hasAlpha === true;
};

const hasTransparentPixels = async (sourceBuffer: Buffer) => {
  try {
    const alpha = await sharp(sourceBuffer)
      .rotate()
      .ensureAlpha()
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    return alpha.some((value) => value < 250);
  } catch {
    return false;
  }
};

const resizeCatalogImage = async (input: {
  sourceBuffer: Buffer;
  width: number;
  height: number;
  trim: boolean;
}) => {
  const resize = (source: Buffer) =>
    sharp(source)
      .rotate()
      .resize({
        width: Math.max(1, Math.round(input.width * (1 - CATALOG_IMAGE_PADDING_RATIO * 2))),
        height: Math.max(1, Math.round(input.height * (1 - CATALOG_IMAGE_PADDING_RATIO * 2))),
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });

  if (!input.trim) {
    return resize(input.sourceBuffer);
  }

  try {
    const trimmed = await sharp(input.sourceBuffer)
      .rotate()
      .trim({ threshold: TRIM_THRESHOLD })
      .png()
      .toBuffer();
    return await resize(trimmed);
  } catch {
    return resize(input.sourceBuffer);
  }
};

export const transformCatalogImageToWebp = async (input: {
  sourceBuffer: Buffer;
  width: number;
  quality: number;
  sourceMimeType: string;
}) => {
  const metadata = await sharp(input.sourceBuffer).metadata();
  const canFrame = shouldFrameCatalogProductImage({
    metadata,
    sourceMimeType: input.sourceMimeType,
  });
  const shouldFrame = canFrame && (await hasTransparentPixels(input.sourceBuffer));

  if (!shouldFrame) {
    return sharp(input.sourceBuffer)
      .rotate()
      .resize({
        width: input.width,
        height: input.width,
        fit: "cover",
        position: "center",
      })
      .webp({
        quality: input.quality,
        effort: WEBP_EFFORT,
      })
      .toBuffer();
  }

  const canvasWidth = input.width;
  const canvasHeight = Math.max(1, Math.round(canvasWidth / CATALOG_IMAGE_ASPECT_RATIO));
  const resized = await resizeCatalogImage({
    sourceBuffer: input.sourceBuffer,
    width: canvasWidth,
    height: canvasHeight,
    trim: true,
  });

  return sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: transparentBackground,
    },
  })
    .composite([
      {
        input: resized.data,
        left: Math.max(0, Math.round((canvasWidth - resized.info.width) / 2)),
        top: Math.max(0, Math.round((canvasHeight - resized.info.height) / 2)),
      },
    ])
    .webp({
      quality: input.quality,
      effort: WEBP_EFFORT,
    })
    .toBuffer();
};
