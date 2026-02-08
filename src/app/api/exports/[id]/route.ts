import { readFile } from "node:fs/promises";

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

  let file: Buffer;
  try {
    file = await readFile(job.storagePath);
  } catch {
    return new Response(null, { status: 404 });
  }
  const defaultExtension =
    job.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ? "xlsx"
      : "csv";
  const fileName = job.fileName ?? `export-${job.id}.${defaultExtension}`;

  return new Response(new Uint8Array(file), {
    status: 200,
    headers: {
      "Content-Type": job.mimeType ?? "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
    },
  });
};
