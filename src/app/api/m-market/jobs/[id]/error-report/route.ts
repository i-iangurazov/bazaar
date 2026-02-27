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

  const job = await prisma.mMarketExportJob.findFirst({
    where: {
      id: params.id,
      orgId: token.organizationId as string,
    },
    select: {
      id: true,
      errorReportJson: true,
    },
  });

  if (!job || !job.errorReportJson) {
    return new Response(null, { status: 404 });
  }

  const fileName = `mmarket-export-error-${job.id}.json`;
  const body = `${JSON.stringify(job.errorReportJson, null, 2)}\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
};
