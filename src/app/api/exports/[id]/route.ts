import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { getServerAuthToken } from "@/server/auth/token";
import { AppError } from "@/server/services/errors";
import { resolveExportJobDownload } from "@/server/services/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: {
    id: string;
  };
};

const textResponse = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const buildContentDisposition = (fileName: string) => {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\\r\n]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export const GET = async (_request: Request, { params }: RouteParams) => {
  const token = await getServerAuthToken();
  if (!token?.sub || !token.organizationId) {
    return textResponse("unauthorized", 401);
  }

  try {
    const download = await resolveExportJobDownload({
      organizationId: String(token.organizationId),
      jobId: params.id,
      user: {
        id: token.sub,
        organizationId: String(token.organizationId),
        role: String(token.role ?? "STAFF"),
        isOrgOwner: Boolean((token as { isOrgOwner?: boolean | null }).isOrgOwner),
        isPlatformOwner: Boolean((token as { isPlatformOwner?: boolean | null }).isPlatformOwner),
      },
    });

    const stream = createReadStream(download.storagePath);
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": download.mimeType,
        "Content-Disposition": buildContentDisposition(download.fileName),
        "Content-Length": String(download.fileSize),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return textResponse(error.message, error.status);
    }
    return textResponse("exportDownloadFailed", 500);
  }
};
