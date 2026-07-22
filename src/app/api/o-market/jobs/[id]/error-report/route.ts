import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import {
  assertCommercePermission,
  resolveCommerceAccessibleStoreIds,
} from "@/server/services/commerceAccess";

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
  const accessUser = {
    id: String(token.sub ?? ""),
    organizationId: String(token.organizationId),
    role: String(token.role ?? ""),
    isOrgOwner: Boolean(token.isOrgOwner),
    isPlatformOwner: Boolean(token.isPlatformOwner),
  };
  let accessibleStoreIds: string[] | null;
  try {
    assertCommercePermission(accessUser, "manageIntegrations");
    accessibleStoreIds = await resolveCommerceAccessibleStoreIds(prisma, accessUser);
  } catch {
    return new Response(null, { status: 403 });
  }

  const job = await prisma.oMarketExportJob.findFirst({
    where: {
      id: params.id,
      orgId: String(token.organizationId),
      ...(accessibleStoreIds ? { storeId: { in: accessibleStoreIds } } : {}),
    },
    select: {
      id: true,
      storeId: true,
      jobType: true,
      errorReportJson: true,
      payloadStatsJson: true,
      responseJson: true,
    },
  });

  if (!job || (!job.errorReportJson && !job.payloadStatsJson && !job.responseJson)) {
    return new Response(null, { status: 404 });
  }

  const existingReport = asRecord(job.errorReportJson) ?? {};
  const report = {
    ...existingReport,
    ...(hasOwn(existingReport, "jobId") ? {} : { jobId: job.id }),
    ...(hasOwn(existingReport, "jobType") ? {} : { jobType: job.jobType }),
    ...(hasOwn(existingReport, "payloadStats") || !job.payloadStatsJson
      ? {}
      : { payloadStats: job.payloadStatsJson }),
    ...(hasOwn(existingReport, "response") || !job.responseJson
      ? {}
      : { response: job.responseJson }),
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="o-market-export-error-${job.id}.json"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
};
