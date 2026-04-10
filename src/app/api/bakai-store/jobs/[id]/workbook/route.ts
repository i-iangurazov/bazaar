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
  if (!token?.organizationId) {
    return new Response(null, { status: 401 });
  }

  const job = await prisma.bakaiStoreExportJob.findFirst({
    where: {
      id: params.id,
      orgId: String(token.organizationId),
    },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
    },
  });

  if (!job?.storagePath) {
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

  const stream = createReadStream(job.storagePath);
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  const fileName = job.fileName ?? `bakai-store-export-${job.id}.xlsx`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":
        job.mimeType ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(fileSize),
      "X-Content-Type-Options": "nosniff",
    },
  });
};
