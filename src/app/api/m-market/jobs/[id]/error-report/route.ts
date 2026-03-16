import type { MMarketEnvironment } from "@prisma/client";

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

const MMARKET_IMPORT_ENDPOINTS: Record<MMarketEnvironment, string> = {
  DEV: "https://dev.m-market.kg/api/crm/products/import_products/",
  PROD: "https://market.mbank.kg/api/crm/products/import_products/",
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
      environment: true,
      requestIdempotencyKey: true,
      errorReportJson: true,
      payloadStatsJson: true,
      responseJson: true,
    },
  });

  if (!job || (!job.errorReportJson && !job.payloadStatsJson && !job.responseJson)) {
    return new Response(null, { status: 404 });
  }

  const fileName = `mmarket-export-error-${job.id}.json`;
  const existingReport = asRecord(job.errorReportJson) ?? {};
  const report = {
    ...existingReport,
    ...(hasOwn(existingReport, "jobId") ? {} : { jobId: job.id }),
    ...(hasOwn(existingReport, "environment") ? {} : { environment: job.environment }),
    ...(hasOwn(existingReport, "endpoint")
      ? {}
      : { endpoint: MMARKET_IMPORT_ENDPOINTS[job.environment] }),
    ...(hasOwn(existingReport, "requestIdempotencyKey")
      ? {}
      : { requestIdempotencyKey: job.requestIdempotencyKey }),
    ...(hasOwn(existingReport, "payloadStats") || !job.payloadStatsJson
      ? {}
      : { payloadStats: job.payloadStatsJson }),
    ...(hasOwn(existingReport, "remoteResponse") || !job.responseJson
      ? {}
      : { remoteResponse: job.responseJson }),
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
};
