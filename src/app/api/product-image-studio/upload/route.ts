import { getServerAuthToken } from "@/server/auth/token";
import { normalizeImageMimeType } from "@/lib/productImageUpload";
import { uploadProductImageBuffer } from "@/server/services/productImageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const allowedExtensions = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["heic", "image/heic"],
  ["heics", "image/heic"],
  ["heif", "image/heif"],
  ["heifs", "image/heif"],
  ["hif", "image/heif"],
]);

const resolveUploadContentType = (file: File) => {
  const normalizedType = normalizeImageMimeType(file.type);
  if (allowedMimeTypes.has(normalizedType)) {
    return normalizedType;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return allowedExtensions.get(extension) ?? null;
};

const isManagerOrAdmin = (role: unknown) => role === "ADMIN" || role === "MANAGER";

export const POST = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token) {
    return Response.json({ message: "unauthorized" }, { status: 401 });
  }
  if (!token.organizationId || !isManagerOrAdmin(token.role)) {
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
  if (!(file instanceof File)) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json({ message: "imageTooLarge" }, { status: 413 });
  }

  const contentType = resolveUploadContentType(file);
  if (!contentType) {
    return Response.json({ message: "productImageStudioUnsupportedFileType" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadProductImageBuffer({
      organizationId: String(token.organizationId),
      buffer,
      contentType,
      sourceFileName: file.name,
    });
    return Response.json(
      {
        url: uploaded.url,
        size: file.size,
        fileName: file.name,
        mimeType: contentType,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "genericMessage";
    if (message === "imageTooLarge") {
      return Response.json({ message }, { status: 413 });
    }
    if (message === "imageInvalidType" || message === "invalidInput") {
      return Response.json({ message }, { status: 400 });
    }
    return Response.json({ message: "genericMessage" }, { status: 500 });
  }
};
