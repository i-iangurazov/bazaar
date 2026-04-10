import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: {
    id: string;
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const hasOwn = (value: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

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
      errorReportJson: true,
      payloadStatsJson: true,
    },
  });

  if (!job || (!job.errorReportJson && !job.payloadStatsJson)) {
    return new Response(null, { status: 404 });
  }

  const existingReport = asRecord(job.errorReportJson) ?? {};
  const report = {
    ...existingReport,
    ...(hasOwn(existingReport, "jobId") ? {} : { jobId: job.id }),
    ...(hasOwn(existingReport, "payloadStats") || !job.payloadStatsJson
      ? {}
      : { payloadStats: job.payloadStatsJson }),
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bakai-store-export-error-${job.id}.json"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
};
