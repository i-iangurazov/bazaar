import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: {
    id: string;
  };
};

export const GET = async (_request: Request, { params }: RouteParams) => {
  const token = await getServerAuthToken();
  if (!token) {
    return new Response(null, { status: 401 });
  }

  const job = await prisma.exportJob.findFirst({
    where: { id: params.id, organizationId: token.organizationId as string },
  });

  if (!job || !job.storagePath) {
    return new Response(null, { status: 404 });
  }

  let fileSize: number;
  try {
    const stats = await stat(job.storagePath);
    if (!stats.isFile()) {
      return new Response(null, { status: 404 });
    }
    fileSize = stats.size;
  } catch {
    return new Response(null, { status: 404 });
  }
  const defaultExtension =
    job.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ? "xlsx"
      : "csv";
  const fileName = job.fileName ?? `export-${job.id}.${defaultExtension}`;

  const stream = createReadStream(job.storagePath);
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": job.mimeType ?? "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      "Content-Length": String(fileSize),
      "X-Content-Type-Options": "nosniff",
    },
  });
};
