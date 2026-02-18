import { createHash, randomInt, randomUUID } from "node:crypto";

import { FiscalReceiptStatus, KkmMode, Prisma } from "@prisma/client";

import { registerJob, type JobResult } from "@/server/jobs";
import { prisma } from "@/server/db/prisma";
import type { FiscalReceiptDraft } from "@/server/kkm/adapter";
import { getKkmAdapter } from "@/server/kkm/registry";
import {
  connectorOnlineGauge,
  incrementCounter,
  kkmReceiptsQueuedTotal,
  kkmReceiptsFailedTotal,
  kkmReceiptsSentTotal,
  setGauge,
} from "@/server/metrics/metrics";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";

const toTokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const pairingCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const pairingCodeLength = 8;

const createPairingCode = () =>
  Array.from(
    { length: pairingCodeLength },
    () => pairingCodeAlphabet[randomInt(0, pairingCodeAlphabet.length)],
  ).join("");

const asFiscalDraft = (value: Prisma.JsonValue): FiscalReceiptDraft | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (!candidate.storeId || !candidate.lines || !Array.isArray(candidate.lines)) {
    return null;
  }
  return candidate as unknown as FiscalReceiptDraft;
};

export const queueFiscalReceipt = async (input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  storeId: string;
  customerOrderId: string;
  idempotencyKey: string;
  mode: KkmMode;
  providerKey?: string | null;
  payload: FiscalReceiptDraft;
}) => {
  return input.tx.fiscalReceipt.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      customerOrderId: input.customerOrderId,
      idempotencyKey: input.idempotencyKey,
      mode: input.mode,
      providerKey: input.providerKey ?? null,
      status: FiscalReceiptStatus.QUEUED,
      payloadJson: toJson(input.payload) as Prisma.InputJsonValue,
    },
    update: {
      payloadJson: toJson(input.payload) as Prisma.InputJsonValue,
      mode: input.mode,
      providerKey: input.providerKey ?? null,
      status: FiscalReceiptStatus.QUEUED,
      lastError: null,
      nextAttemptAt: null,
    },
  });
};

export const createConnectorPairingCode = async (input: {
  organizationId: string;
  storeId: string;
  actorId: string;
  requestId: string;
}) => {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  let created: Awaited<ReturnType<typeof prisma.kkmConnectorPairingCode.create>> | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createPairingCode();
    try {
      created = await prisma.kkmConnectorPairingCode.create({
        data: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          code,
          expiresAt,
          createdById: input.actorId,
        },
      });
      break;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }
  if (!created) {
    throw new AppError("unexpectedError", "INTERNAL_SERVER_ERROR", 500);
  }

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "KKM_CONNECTOR_PAIR_CODE_CREATED",
    entity: "KkmConnectorPairingCode",
    entityId: created.id,
    before: null,
    after: toJson({ storeId: created.storeId, expiresAt: created.expiresAt }),
    requestId: input.requestId,
  });

  return { id: created.id, code: created.code, expiresAt: created.expiresAt };
};

export const pairConnectorDevice = async (input: {
  code: string;
  deviceName: string;
}) => {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const pairing = await tx.kkmConnectorPairingCode.findFirst({
      where: {
        code: input.code.trim().toUpperCase(),
        consumedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (!pairing) {
      throw new AppError("kkmPairingCodeInvalid", "BAD_REQUEST", 400);
    }

    const rawToken = randomUUID();
    const tokenHash = toTokenHash(rawToken);
    const device = await tx.kkmConnectorDevice.create({
      data: {
        organizationId: pairing.organizationId,
        storeId: pairing.storeId,
        name: input.deviceName.trim() || "Connector",
        tokenHash,
        pairedAt: now,
        lastSeenAt: now,
      },
      select: {
        id: true,
        organizationId: true,
        storeId: true,
        name: true,
      },
    });

    await tx.kkmConnectorPairingCode.update({
      where: { id: pairing.id },
      data: { consumedAt: now },
    });

    setGauge(connectorOnlineGauge, { storeId: pairing.storeId }, 1);

    return { token: rawToken, device };
  });
};

const resolveConnectorDevice = async (token: string) => {
  if (!token?.trim()) {
    throw new AppError("unauthorized", "UNAUTHORIZED", 401);
  }
  const tokenHash = toTokenHash(token.trim());
  const device = await prisma.kkmConnectorDevice.findFirst({
    where: { tokenHash, isActive: true },
    select: {
      id: true,
      organizationId: true,
      storeId: true,
      name: true,
    },
  });
  if (!device) {
    throw new AppError("unauthorized", "UNAUTHORIZED", 401);
  }
  return device;
};

export const connectorHeartbeat = async (token: string) => {
  const device = await resolveConnectorDevice(token);
  await prisma.kkmConnectorDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });
  setGauge(connectorOnlineGauge, { storeId: device.storeId }, 1);
  return { ok: true };
};

export const connectorPullQueue = async (input: { token: string; limit?: number }) => {
  const device = await resolveConnectorDevice(input.token);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.kkmConnectorDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: now },
    });
    setGauge(connectorOnlineGauge, { storeId: device.storeId }, 1);

    const claimRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "FiscalReceipt"
      WHERE "organizationId" = ${device.organizationId}
        AND "storeId" = ${device.storeId}
        AND "mode" = ${KkmMode.CONNECTOR}::"KkmMode"
        AND "status" = ${FiscalReceiptStatus.QUEUED}::"FiscalReceiptStatus"
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);

    if (!claimRows.length) {
      return [];
    }

    const ids = claimRows.map((item) => item.id);
    const receipts = await tx.fiscalReceipt.findMany({
      where: {
        id: { in: ids },
        organizationId: device.organizationId,
        storeId: device.storeId,
        mode: KkmMode.CONNECTOR,
      },
      orderBy: { createdAt: "asc" },
    });

    await tx.fiscalReceipt.updateMany({
      where: {
        id: { in: ids },
        status: FiscalReceiptStatus.QUEUED,
      },
      data: {
        status: FiscalReceiptStatus.PROCESSING,
        connectorDeviceId: device.id,
        attemptCount: { increment: 1 },
      },
    });

    return receipts.map((receipt) => ({
      id: receipt.id,
      customerOrderId: receipt.customerOrderId,
      idempotencyKey: receipt.idempotencyKey,
      payload: receipt.payloadJson,
      createdAt: receipt.createdAt,
    }));
  });
};

export const connectorPushResult = async (input: {
  token: string;
  receiptId: string;
  status: "SENT" | "FAILED";
  providerReceiptId?: string | null;
  fiscalNumber?: string | null;
  qr?: string | null;
  errorMessage?: string | null;
}) => {
  const device = await resolveConnectorDevice(input.token);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const receipt = await tx.fiscalReceipt.findFirst({
      where: {
        id: input.receiptId,
        organizationId: device.organizationId,
        storeId: device.storeId,
        mode: KkmMode.CONNECTOR,
      },
      select: {
        id: true,
        customerOrderId: true,
        status: true,
      },
    });
    if (!receipt) {
      throw new AppError("kkmReceiptNotFound", "NOT_FOUND", 404);
    }
    if (receipt.status === FiscalReceiptStatus.SENT) {
      return {
        id: receipt.id,
        status: receipt.status,
        customerOrderId: receipt.customerOrderId,
      };
    }

    const nextStatus =
      input.status === "SENT" ? FiscalReceiptStatus.SENT : FiscalReceiptStatus.FAILED;
    const updated = await tx.fiscalReceipt.update({
      where: { id: receipt.id },
      data: {
        status: nextStatus,
        providerReceiptId: input.providerReceiptId ?? null,
        fiscalNumber: input.fiscalNumber ?? null,
        qr: input.qr ?? null,
        lastError: input.status === "FAILED" ? input.errorMessage ?? "connectorFailed" : null,
        nextAttemptAt:
          input.status === "FAILED" ? new Date(Date.now() + 30_000) : null,
        sentAt: input.status === "SENT" ? now : null,
        connectorDeviceId: device.id,
      },
    });
    setGauge(connectorOnlineGauge, { storeId: device.storeId }, 1);

    await tx.customerOrder.update({
      where: { id: receipt.customerOrderId },
      data: {
        kkmStatus: input.status,
        kkmReceiptId: input.providerReceiptId ?? null,
        kkmRawJson:
          input.status === "SENT"
            ? toJson({
                connectorDeviceId: device.id,
                fiscalNumber: input.fiscalNumber ?? null,
                qr: input.qr ?? null,
              })
            : toJson({
                connectorDeviceId: device.id,
                errorMessage: input.errorMessage ?? "connectorFailed",
              }),
      },
    });

    if (input.status === "SENT") {
      incrementCounter(kkmReceiptsSentTotal, {
        mode: KkmMode.CONNECTOR,
      });
    } else {
      incrementCounter(kkmReceiptsFailedTotal, {
        mode: KkmMode.CONNECTOR,
      });
    }

    return {
      id: updated.id,
      status: updated.status,
      customerOrderId: updated.customerOrderId,
    };
  });
};

export const listFiscalReceipts = async (input: {
  organizationId: string;
  storeId?: string;
  status?: FiscalReceiptStatus;
  page: number;
  pageSize: number;
}) => {
  const where = {
    organizationId: input.organizationId,
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.fiscalReceipt.count({ where }),
    prisma.fiscalReceipt.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, code: true } },
        customerOrder: { select: { id: true, number: true, totalKgs: true } },
        connectorDevice: { select: { id: true, name: true, lastSeenAt: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const retryFiscalReceipt = async (input: {
  organizationId: string;
  receiptId: string;
  actorId: string;
  requestId: string;
}) => {
  const receipt = await prisma.fiscalReceipt.findFirst({
    where: { id: input.receiptId, organizationId: input.organizationId },
  });
  if (!receipt) {
    throw new AppError("kkmReceiptNotFound", "NOT_FOUND", 404);
  }

  if (receipt.mode === KkmMode.CONNECTOR) {
    const updated = await prisma.fiscalReceipt.update({
      where: { id: receipt.id },
      data: {
        status: FiscalReceiptStatus.QUEUED,
        lastError: null,
        nextAttemptAt: null,
      },
    });
    incrementCounter(kkmReceiptsQueuedTotal, { mode: KkmMode.CONNECTOR });
    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "KKM_RECEIPT_RETRY",
      entity: "FiscalReceipt",
      entityId: updated.id,
      before: toJson(receipt),
      after: toJson(updated),
      requestId: input.requestId,
    });
    return { id: updated.id, status: updated.status };
  }

  if (receipt.mode !== KkmMode.ADAPTER) {
    throw new AppError("kkmRetryUnsupportedMode", "CONFLICT", 409);
  }

  const draft = asFiscalDraft(receipt.payloadJson);
  if (!draft) {
    throw new AppError("kkmReceiptPayloadInvalid", "CONFLICT", 409);
  }
  const adapter = getKkmAdapter(receipt.providerKey);
  try {
    const fiscalized = await adapter.fiscalizeReceipt(draft);
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.fiscalReceipt.update({
        where: { id: receipt.id },
        data: {
          status: FiscalReceiptStatus.SENT,
          lastError: null,
          nextAttemptAt: null,
          sentAt: new Date(),
          providerReceiptId: fiscalized.providerReceiptId,
          fiscalNumber: fiscalized.fiscalNumber ?? null,
          qr:
            fiscalized.rawJson && typeof fiscalized.rawJson === "object" && "qr" in fiscalized.rawJson
              ? String((fiscalized.rawJson as Record<string, unknown>).qr ?? "")
              : null,
          attemptCount: { increment: 1 },
        },
      });
      await tx.customerOrder.update({
        where: { id: receipt.customerOrderId },
        data: {
          kkmStatus: "SENT",
          kkmReceiptId: fiscalized.providerReceiptId,
          kkmRawJson: fiscalized.rawJson ?? Prisma.DbNull,
        },
      });
      return next;
    });
    incrementCounter(kkmReceiptsSentTotal, { mode: KkmMode.ADAPTER });

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "KKM_RECEIPT_RETRY",
      entity: "FiscalReceipt",
      entityId: updated.id,
      before: toJson(receipt),
      after: toJson(updated),
      requestId: input.requestId,
    });
    return { id: updated.id, status: updated.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await prisma.fiscalReceipt.update({
      where: { id: receipt.id },
      data: {
        status: FiscalReceiptStatus.FAILED,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + 60_000),
        attemptCount: { increment: 1 },
      },
    });
    incrementCounter(kkmReceiptsFailedTotal, { mode: KkmMode.ADAPTER });
    return { id: updated.id, status: updated.status, errorMessage: message };
  }
};

export const runKkmRetryJob = async () => {
  const now = new Date();
  const failed = await prisma.fiscalReceipt.findMany({
    where: {
      mode: KkmMode.ADAPTER,
      status: FiscalReceiptStatus.FAILED,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });

  let sent = 0;
  let failedCount = 0;
  for (const receipt of failed) {
    const draft = asFiscalDraft(receipt.payloadJson);
    if (!draft) {
      failedCount += 1;
      continue;
    }
    try {
      const adapter = getKkmAdapter(receipt.providerKey);
      const fiscalized = await adapter.fiscalizeReceipt(draft);
      await prisma.$transaction(async (tx) => {
        await tx.fiscalReceipt.update({
          where: { id: receipt.id },
          data: {
            status: FiscalReceiptStatus.SENT,
            lastError: null,
            nextAttemptAt: null,
            sentAt: new Date(),
            providerReceiptId: fiscalized.providerReceiptId,
            fiscalNumber: fiscalized.fiscalNumber ?? null,
            attemptCount: { increment: 1 },
          },
        });
        await tx.customerOrder.update({
          where: { id: receipt.customerOrderId },
          data: {
            kkmStatus: "SENT",
            kkmReceiptId: fiscalized.providerReceiptId,
            kkmRawJson: fiscalized.rawJson ?? Prisma.DbNull,
          },
        });
      });
      sent += 1;
      incrementCounter(kkmReceiptsSentTotal, { mode: KkmMode.ADAPTER });
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      await prisma.fiscalReceipt.update({
        where: { id: receipt.id },
        data: {
          status: FiscalReceiptStatus.FAILED,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + 60_000),
          attemptCount: { increment: 1 },
        },
      });
      incrementCounter(kkmReceiptsFailedTotal, { mode: KkmMode.ADAPTER });
    }
  }

  const result: JobResult = {
    job: "kkm-retry-receipts",
    status: "ok",
    details: { processed: failed.length, sent, failed: failedCount },
  };
  return result;
};

registerJob("kkm-retry-receipts", {
  handler: runKkmRetryJob,
  maxAttempts: 2,
  baseDelayMs: 1000,
});
