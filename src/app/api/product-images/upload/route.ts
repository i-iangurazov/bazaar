import { getServerAuthToken } from "@/server/auth/token";
import { uploadProductImageBuffer } from "@/server/services/productImageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toMessage = (value: unknown) => (value instanceof Error ? value.message : "genericMessage");
const resolveMaxImageBytes = () => {
  const parsed = Number(process.env.PRODUCT_IMAGE_MAX_BYTES);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 5 * 1024 * 1024;
};
const MAX_IMAGE_BYTES = resolveMaxImageBytes();
const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = MAX_IMAGE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
const imageMimeByExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  heics: "image/heic",
  heifs: "image/heif",
  hif: "image/heif",
};

const normalizeImageMimeType = (value: string) => {
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

const resolveUploadContentType = (file: File) => {
  const normalizedType = normalizeImageMimeType(file.type);
  if (normalizedType.startsWith("image/")) {
    return normalizedType;
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext) {
    return null;
  }
  const byExtension = imageMimeByExtension[ext];
  return byExtension ? normalizeImageMimeType(byExtension) : null;
};

export const POST = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token) {
    return Response.json({ message: "unauthorized" }, { status: 401 });
  }
  if (!token.organizationId || token.role !== "ADMIN") {
    return Response.json({ message: "forbidden" }, { status: 403 });
  }

  const contentLengthRaw = request.headers.get("content-length");
  if (contentLengthRaw) {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_REQUEST_BYTES) {
      return Response.json({ message: "imageTooLarge" }, { status: 413 });
    }
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  const file = formData.get("file");
  const productIdRaw = formData.get("productId");
  const productId =
    typeof productIdRaw === "string" && productIdRaw.trim().length > 0
      ? productIdRaw.trim()
      : undefined;

  if (!(file instanceof File)) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json({ message: "imageTooLarge" }, { status: 413 });
  }
  const contentType = resolveUploadContentType(file);
  if (!contentType) {
    return Response.json({ message: "imageInvalidType" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadProductImageBuffer({
      organizationId: String(token.organizationId),
      productId,
      buffer,
      contentType,
      sourceFileName: file.name,
    });
    return Response.json({ url: uploaded.url }, { status: 200 });
  } catch (error) {
    const message = toMessage(error);
    if (message === "imageTooLarge") {
      return Response.json({ message }, { status: 413 });
    }
    if (message === "imageInvalidType" || message === "invalidInput") {
      return Response.json({ message }, { status: 400 });
    }
    if (message === "forbidden") {
      return Response.json({ message }, { status: 403 });
    }
    return Response.json({ message: "genericMessage" }, { status: 500 });
  }
};
