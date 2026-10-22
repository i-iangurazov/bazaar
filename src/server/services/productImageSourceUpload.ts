import sharp from "sharp";
import { resolveProductPhotoSourceMimeType } from "@/lib/productImageUpload";
import { normalizeProductImageUpload } from "./productImageStorage";

// Decode raster sources, never publish SVG/HTML or trust a filename as proof
// of image contents. Apple HEIF is decoded by the storage codec fallback.
export async function prepareProductStudioSource(file: File) {
  const contentType = resolveProductPhotoSourceMimeType(file);
  if (!contentType) throw new Error("imageInvalidType");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (contentType === "image/heic" || contentType === "image/heif")
    return normalizeProductImageUpload({ buffer, contentType });
  try {
    const image = sharp(buffer, { pages: 1, limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      !["jpeg", "png", "webp", "avif", "heif", "gif", "tiff", "bmp"].includes(metadata.format ?? "")
    )
      throw new Error("imageInvalidType");
    if (["jpeg", "png", "webp"].includes(metadata.format!))
      return { buffer, contentType: `image/${metadata.format}` };
    return {
      buffer: await image
        .rotate()
        .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "white" })
        .jpeg({ quality: 92 })
        .toBuffer(),
      contentType: "image/jpeg",
    };
  } catch {
    throw new Error("imageInvalidType");
  }
}
