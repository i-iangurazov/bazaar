import { randomUUID } from "node:crypto";

import type { DiagnosticsReport as DiagnosticsReportRecord, Prisma } from "@prisma/client";
import { ExportType } from "@prisma/client";

import { eventBus } from "@/server/events/eventBus";
import { prisma } from "@/server/db/prisma";
import { assertEmailConfigured, sendInviteEmail } from "@/server/services/email";
import { AppError } from "@/server/services/errors";
import { requestExport } from "@/server/services/exports";
import { runJob, registerJob } from "@/server/jobs";
import { getBillingSummary } from "@/server/services/billing";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import { getRedisPublisher, redisConfigured } from "@/server/redis";
import { buildPriceTagsPdf } from "@/server/services/priceTagsPdf";
import { isProductionRuntime } from "@/server/config/runtime";
import { toJson } from "@/server/services/json";

export const diagnosticsCheckTypes = [
  "database",
  "redis",
  "sse",
  "email",
  "exports",
  "pdf",
  "jobs",
  "subscription",
] as const;

export type DiagnosticsCheckType = (typeof diagnosticsCheckTypes)[number];
export type DiagnosticsStatus = "ok" | "warning" | "error";

export type DiagnosticsCheckResult = {
  type: DiagnosticsCheckType;
  status: DiagnosticsStatus;
  code: string;
  details: Record<string, unknown>;
  ranAt: string;
  durationMs: number;
};

export type DiagnosticsSummary = {
  overallStatus: DiagnosticsStatus;
  generatedAt: string;
  checks: DiagnosticsCheckResult[];
};

type DiagnosticsRunOptions = {
  organizationId: string;
  userId: string;
  userEmail: string;
  requestId: string;
  checks: DiagnosticsCheckType[];
  sendEmailTest: boolean;
  confirmEmailInProduction: boolean;
};

const DIAGNOSTICS_JOB_NAME = "diagnostics-noop";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

registerJob(DIAGNOSTICS_JOB_NAME, {
  handler: async () => {
    await sleep(150);
    return { job: DIAGNOSTICS_JOB_NAME, status: "ok", details: { probe: true } };
  },
  maxAttempts: 1,
  baseDelayMs: 1,
});

const toNumber = (value: unknown) => {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const getEmailProvider = () => {
  const configured = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (configured) {
    return configured;
  }
  if (process.env.RESEND_API_KEY) {
    return "resend";
  }
  return "log";
};

const runDatabaseCheck = async (): Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">> => {
  const ping = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1::int AS ok`;
  const migrations = await prisma.$queryRaw<Array<{ total: number; failed: number }>>`
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(
        CASE
          WHEN finished_at IS NULL OR rolled_back_at IS NOT NULL THEN 1
          ELSE 0
        END
      ), 0)::int AS failed
    FROM "_prisma_migrations"
  `;
  const total = toNumber(migrations[0]?.total);
  const failed = toNumber(migrations[0]?.failed);
  if (ping[0]?.ok !== 1) {
    return { status: "error", code: "databaseQueryFailed", details: { migrationsTotal: total, migrationsFailed: failed } };
  }
  if (failed > 0) {
    return {
      status: "warning",
      code: "databaseMigrationsWarning",
      details: { migrationsTotal: total, migrationsFailed: failed },
    };
  }
  return {
    status: "ok",
    code: "databaseOk",
    details: { migrationsTotal: total, migrationsFailed: failed },
  };
};

const runRedisCheck = async (
  organizationId: string,
): Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">> => {
  if (!redisConfigured()) {
    return { status: "warning", code: "redisDisconnected", details: { connected: false, pingOk: false, pubSubOk: false } };
  }

  const publisher = getRedisPublisher();
  if (!publisher) {
    return { status: "warning", code: "redisDisconnected", details: { connected: false, pingOk: false, pubSubOk: false } };
  }

  const pingOk = (await publisher.ping()) === "PONG";
  if (!pingOk) {
    return { status: "warning", code: "redisPingFailed", details: { connected: true, pingOk: false, pubSubOk: false } };
  }

  const channel = `diagnostics:${organizationId}:${randomUUID()}`;
  const token = randomUUID();
  let pubSubOk = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const subscriber = publisher.duplicate();

  try {
    await subscriber.connect();
    pubSubOk = await new Promise<boolean>(async (resolve) => {
      const handleMessage = (incomingChannel: string, message: string) => {
        if (incomingChannel === channel && message === token) {
          if (timer) {
            clearTimeout(timer);
          }
          subscriber.off("message", handleMessage);
          resolve(true);
        }
      };

      timer = setTimeout(() => {
        subscriber.off("message", handleMessage);
        resolve(false);
      }, 1500);

      subscriber.on("message", handleMessage);
      await subscriber.subscribe(channel);
      await publisher.publish(channel, token);
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    await subscriber.unsubscribe(channel).catch(() => null);
    await subscriber.quit().catch(() => {
      subscriber.disconnect();
    });
  }

  if (!pubSubOk) {
    return { status: "warning", code: "redisPubSubFailed", details: { connected: true, pingOk: true, pubSubOk } };
  }

  return { status: "ok", code: "redisOk", details: { connected: true, pingOk: true, pubSubOk } };
};

const runSseCheck = async (): Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">> => {
  const probeStore = `diagnostics-${randomUUID()}`;
  const probeProduct = `diagnostics-${randomUUID()}`;

  const eventReceived = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, 1500);

    const unsubscribe = eventBus.subscribe((event) => {
      if (
        event.type === "inventory.updated" &&
        event.payload.storeId === probeStore &&
        event.payload.productId === probeProduct
      ) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(true);
      }
    });

    eventBus.publish({
      type: "inventory.updated",
      payload: {
        storeId: probeStore,
        productId: probeProduct,
      },
    });
  });

  if (!eventReceived) {
    return {
      status: "warning",
      code: "sseStreamUnavailable",
      details: { heartbeatOk: false, eventPipelineOk: false },
    };
  }

  return {
    status: "ok",
    code: "sseOk",
    details: { heartbeatOk: true, eventPipelineOk: true },
  };
};

const runEmailCheck = async (input: {
  userEmail: string;
  sendEmailTest: boolean;
  confirmEmailInProduction: boolean;
}): Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">> => {
  const provider = getEmailProvider();
  try {
    assertEmailConfigured();
  } catch (error) {
    return { status: "warning", code: "emailNotConfigured", details: { provider } };
  }

  const canSendTest = !isProductionRuntime() || input.confirmEmailInProduction;
  if (!input.sendEmailTest) {
    return { status: "ok", code: "emailConfigured", details: { provider, testSent: false } };
  }
  if (!canSendTest) {
    return {
      status: "warning",
      code: "emailTestConfirmationRequired",
      details: { provider, testSent: false },
    };
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  try {
    await sendInviteEmail({
      email: input.userEmail,
      inviteLink: `${baseUrl}/help`,
    });
    return {
      status: "ok",
      code: "emailTestSent",
      details: { provider, testSent: true },
    };
  } catch (error) {
    return {
      status: "error",
      code: "emailTestFailed",
      details: { provider, testSent: false },
    };
  }
};

const runExportsCheck = async (input: {
  organizationId: string;
  userId: string;
  requestId: string;
}): Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">> => {
  const store = await prisma.store.findFirst({
    where: { organizationId: input.organizationId },
    select: { id: true },
  });
  if (!store) {
    return { status: "warning", code: "exportsNoStore", details: { jobStatus: "skipped" } };
  }

  try {
    await assertFeatureEnabled({ organizationId: input.organizationId, feature: "exports" });
  } catch (error) {
    if (error instanceof AppError && error.message === "planFeatureUnavailable") {
      return { status: "warning", code: "planFeatureUnavailable", details: { jobStatus: "skipped" } };
    }
    throw error;
  }

  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const job = await requestExport({
    organizationId: input.organizationId,
    storeId: store.id,
    type: ExportType.INVENTORY_ON_HAND,
    periodStart: start,
    periodEnd: end,
    requestedById: input.userId,
    requestId: input.requestId,
    format: "csv",
  });

  await runJob("export-job", {
    jobId: job.id,
    organizationId: input.organizationId,
    requestId: input.requestId,
  });

  const updated = await prisma.exportJob.findUnique({ where: { id: job.id } });
  if (!updated) {
    return { status: "error", code: "exportsFailed", details: { jobStatus: "missing" } };
  }
  if (updated.status === "DONE") {
    return { status: "ok", code: "exportsOk", details: { jobStatus: updated.status, jobId: updated.id } };
  }
  if (updated.status === "FAILED") {
    return { status: "error", code: "exportsFailed", details: { jobStatus: updated.status, jobId: updated.id } };
  }
  return { status: "warning", code: "exportsPending", details: { jobStatus: updated.status, jobId: updated.id } };
};

const runPdfCheck = async (): Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">> => {
  const pdf = await buildPriceTagsPdf({
    labels: [
      {
        name: "Diagnostics Product",
        sku: "DIAG-001",
        barcode: "123456789012",
        price: 1,
      },
    ],
    template: "3x8",
    locale: "ru",
    storeName: null,
    noPriceLabel: "N/A",
    noBarcodeLabel: "N/A",
    skuLabel: "SKU",
  });
  if (!pdf.byteLength) {
    return { status: "error", code: "pdfFailed", details: { sizeBytes: 0 } };
  }
  return { status: "ok", code: "pdfOk", details: { sizeBytes: pdf.byteLength } };
};

const runJobsCheck = async (
  input: Pick<DiagnosticsRunOptions, "organizationId" | "requestId">,
): Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">> => {
  const [first, second] = await Promise.all([
    runJob(DIAGNOSTICS_JOB_NAME, { organizationId: input.organizationId, requestId: input.requestId }),
    runJob(DIAGNOSTICS_JOB_NAME, { organizationId: input.organizationId, requestId: input.requestId }),
  ]);

  const both = [first, second];
  const hasOk = both.some((result) => result.status === "ok");
  const hasLocked = both.some(
    (result) =>
      result.status === "skipped" &&
      result.details &&
      typeof result.details === "object" &&
      "reason" in result.details &&
      result.details.reason === "locked",
  );

  if (hasOk && hasLocked) {
    return { status: "ok", code: "jobsOk", details: { lockVerified: true } };
  }
  return { status: "warning", code: "jobsLockWarning", details: { lockVerified: false } };
};

const runSubscriptionCheck = async (
  organizationId: string,
): Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">> => {
  const summary = await getBillingSummary({ organizationId });
  if (!summary) {
    return { status: "error", code: "subscriptionMissing", details: {} };
  }

  const details = {
    plan: summary.plan,
    planTier: summary.planTier,
    status: summary.subscriptionStatus,
    trialEndsAt: summary.trialEndsAt?.toISOString() ?? null,
    currentPeriodEndsAt: summary.currentPeriodEndsAt?.toISOString() ?? null,
    trialExpired: summary.trialExpired,
    usage: summary.usage,
    limits: summary.limits,
    features: summary.features,
    monthlyPriceKgs: summary.monthlyPriceKgs,
  };

  if (summary.subscriptionStatus !== "ACTIVE" || summary.trialExpired) {
    return { status: "warning", code: "subscriptionWarning", details };
  }

  return { status: "ok", code: "subscriptionOk", details };
};

const finalizeCheck = async (
  type: DiagnosticsCheckType,
  runner: () => Promise<Omit<DiagnosticsCheckResult, "type" | "ranAt" | "durationMs">>,
): Promise<DiagnosticsCheckResult> => {
  const startedAt = Date.now();
  const ranAt = new Date().toISOString();
  try {
    const result = await runner();
    return {
      type,
      status: result.status,
      code: result.code,
      details: result.details,
      ranAt,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const code = error instanceof AppError ? error.message : "diagnosticsCheckFailed";
    return {
      type,
      status: "error",
      code,
      details: {},
      ranAt,
      durationMs: Date.now() - startedAt,
    };
  }
};

const runCheck = async (type: DiagnosticsCheckType, input: DiagnosticsRunOptions) => {
  switch (type) {
    case "database":
      return finalizeCheck(type, () => runDatabaseCheck());
    case "redis":
      return finalizeCheck(type, () => runRedisCheck(input.organizationId));
    case "sse":
      return finalizeCheck(type, () => runSseCheck());
    case "email":
      return finalizeCheck(type, () =>
        runEmailCheck({
          userEmail: input.userEmail,
          sendEmailTest: input.sendEmailTest,
          confirmEmailInProduction: input.confirmEmailInProduction,
        }),
      );
    case "exports":
      return finalizeCheck(type, () =>
        runExportsCheck({
          organizationId: input.organizationId,
          userId: input.userId,
          requestId: input.requestId,
        }),
      );
    case "pdf":
      return finalizeCheck(type, () => runPdfCheck());
    case "jobs":
      return finalizeCheck(type, () =>
        runJobsCheck({ organizationId: input.organizationId, requestId: input.requestId }),
      );
    case "subscription":
      return finalizeCheck(type, () => runSubscriptionCheck(input.organizationId));
  }
};

const computeOverallStatus = (checks: DiagnosticsCheckResult[]): DiagnosticsStatus => {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }
  return "ok";
};

const parseSummary = (record: DiagnosticsReportRecord | null) => {
  if (!record) {
    return null;
  }

  const data = record.resultsJson as Prisma.JsonObject;
  const generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : record.createdAt.toISOString();
  const overallStatus =
    data.overallStatus === "error" || data.overallStatus === "warning" ? data.overallStatus : "ok";
  const checks = Array.isArray(data.checks) ? (data.checks as DiagnosticsCheckResult[]) : [];

  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    generatedAt,
    overallStatus,
    checks,
  };
};

export const runDiagnosticsChecks = async (input: DiagnosticsRunOptions) => {
  const checks: DiagnosticsCheckResult[] = [];
  for (const checkType of input.checks) {
    checks.push(await runCheck(checkType, input));
  }

  const summary: DiagnosticsSummary = {
    overallStatus: computeOverallStatus(checks),
    generatedAt: new Date().toISOString(),
    checks,
  };

  const record = await prisma.diagnosticsReport.create({
    data: {
      organizationId: input.organizationId,
      createdById: input.userId,
      resultsJson: toJson(summary),
    },
  });

  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    ...summary,
  };
};

export const getLastDiagnosticsReport = async (organizationId: string) => {
  const record = await prisma.diagnosticsReport.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
  return parseSummary(record);
};
