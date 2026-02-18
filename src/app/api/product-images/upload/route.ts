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
  if (!file.type.toLowerCase().startsWith("image/")) {
    return Response.json({ message: "imageInvalidType" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadProductImageBuffer({
      organizationId: String(token.organizationId),
      productId,
      buffer,
      contentType: file.type,
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
