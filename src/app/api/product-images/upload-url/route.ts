import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { createProductImageDirectUploadTarget } from "@/server/services/productImageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toMessage = (value: unknown) => (value instanceof Error ? value.message : "genericMessage");

type UploadUrlRequestBody = {
  fileName?: unknown;
  contentType?: unknown;
  fileSize?: unknown;
  productId?: unknown;
};

const parseBody = async (request: Request): Promise<UploadUrlRequestBody | null> => {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" ? (body as UploadUrlRequestBody) : null;
};

export const POST = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token) {
    return Response.json({ message: "unauthorized" }, { status: 401 });
  }
  if (!token.organizationId || (token.role !== "ADMIN" && token.role !== "MANAGER")) {
    return Response.json({ message: "forbidden" }, { status: 403 });
  }

  const body = await parseBody(request);
  if (!body) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const contentType = typeof body.contentType === "string" ? body.contentType.trim() : "";
  const fileSize = Number(body.fileSize);
  const productId =
    typeof body.productId === "string" && body.productId.trim().length > 0
      ? body.productId.trim()
      : undefined;

  if (!fileName || !contentType || !Number.isFinite(fileSize)) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { organizationId: true },
    });
    if (!product || product.organizationId !== token.organizationId) {
      return Response.json({ message: "forbidden" }, { status: 403 });
    }
  }

  try {
    const target = await createProductImageDirectUploadTarget({
      organizationId: String(token.organizationId),
      productId,
      contentType,
      fileSize,
      sourceFileName: fileName,
    });

    if (!target) {
      return Response.json({ message: "directUploadUnavailable" }, { status: 409 });
    }

    return Response.json(target, { status: 200 });
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
