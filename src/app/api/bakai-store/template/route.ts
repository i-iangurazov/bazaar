import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";
import { saveBakaiStoreTemplateWorkbook } from "@/server/services/bakaiStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = MAX_TEMPLATE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;

const allowedTemplateMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/octet-stream",
]);

const allowedTemplateExtensions = new Set([".xlsx", ".xls", ".xlsm"]);

const isManagerOrAdmin = (role: unknown) => role === "ADMIN" || role === "MANAGER";

const resolveTemplateMimeType = (file: File) => {
  const normalized = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (allowedTemplateMimeTypes.has(normalized)) {
    return normalized;
  }
  const fileName = file.name.toLowerCase();
  for (const extension of allowedTemplateExtensions) {
    if (fileName.endsWith(extension)) {
      return normalized || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
  }
  return null;
};

export const GET = async () => {
  const token = await getServerAuthToken();
  if (!token?.organizationId) {
    return new Response(null, { status: 401 });
  }

  const integration = await prisma.bakaiStoreIntegration.findUnique({
    where: { orgId: String(token.organizationId) },
    select: {
      id: true,
      templateFileName: true,
      templateMimeType: true,
      templateStoragePath: true,
    },
  });

  if (!integration?.templateStoragePath) {
    return new Response(null, { status: 404 });
  }

  let fileSize: number;
  try {
    const stats = await stat(integration.templateStoragePath);
    if (!stats.isFile()) {
      return new Response(null, { status: 404 });
    }
    fileSize = stats.size;
  } catch {
    return new Response(null, { status: 404 });
  }

  const fileName = integration.templateFileName ?? `bakai-store-template-${integration.id}.xlsx`;
  const stream = createReadStream(integration.templateStoragePath);
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":
        integration.templateMimeType ??
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(fileSize),
      "X-Content-Type-Options": "nosniff",
    },
  });
};

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
      return Response.json({ message: "bakaiStoreTemplateTooLarge" }, { status: 413 });
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
  if (file.size > MAX_TEMPLATE_BYTES) {
    return Response.json({ message: "bakaiStoreTemplateTooLarge" }, { status: 413 });
  }

  const mimeType = resolveTemplateMimeType(file);
  if (!mimeType) {
    return Response.json({ message: "bakaiStoreTemplateInvalidType" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveBakaiStoreTemplateWorkbook({
      organizationId: String(token.organizationId),
      actorId: token.sub ?? "",
      requestId: request.headers.get("x-request-id") ?? randomUUID(),
      upload: {
        fileName: file.name,
        mimeType,
        buffer,
      },
    });

    return Response.json(saved, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "genericMessage";
    if (message === "bakaiStoreTemplateInvalid") {
      return Response.json({ message }, { status: 400 });
    }
    if (message === "bakaiStoreTemplateTooLarge") {
      return Response.json({ message }, { status: 413 });
    }
    if (message === "forbidden") {
      return Response.json({ message }, { status: 403 });
    }
    return Response.json({ message: "genericMessage" }, { status: 500 });
  }
};
