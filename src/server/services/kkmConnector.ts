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
import {
  extractFiscalMetadata,
  resolveFiscalMetadataFromResult,
} from "@/server/services/fiscalReceiptMetadata";
import { toJson } from "@/server/services/json";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  type StoreAccessUser,
} from "@/server/services/storeAccess";

const toTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

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

const adapterRetryLeaseMs = 5 * 60 * 1000;
const adapterRetryWaitMs = 10_000;
const adapterRetryPollMs = 25;
const connectorProcessingLeaseMs = 5 * 60 * 1000;

type AdapterRetryAudit = {
  actorId: string | null;
  action: string;
  entity: "CustomerOrder" | "FiscalReceipt";
  requestId: string;
};

const waitForAdapterReceiptOutcome = async (receiptId: string) => {
  const deadline = Date.now() + adapterRetryWaitMs;
  let receipt = await prisma.fiscalReceipt.findUnique({ where: { id: receiptId } });
  while (receipt?.status === FiscalReceiptStatus.PROCESSING && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, adapterRetryPollMs));
    receipt = await prisma.fiscalReceipt.findUnique({ where: { id: receiptId } });
  }
  if (!receipt) {
    throw new AppError("kkmReceiptNotFound", "NOT_FOUND", 404);
  }
  return receipt;
};

export const processAdapterFiscalReceipt = async (input: {
  receiptId: string;
  trigger: "initial" | "manual" | "scheduled";
  waitForInProgress?: boolean;
  audit?: AdapterRetryAudit;
}) => {
  const now = new Date();
  const claim = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "FiscalReceipt" WHERE id = ${input.receiptId} FOR UPDATE
    `;
    const receipt = await tx.fiscalReceipt.findUnique({ where: { id: input.receiptId } });
    if (!receipt) {
      throw new AppError("kkmReceiptNotFound", "NOT_FOUND", 404);
    }
    if (receipt.mode !== KkmMode.ADAPTER) {
      throw new AppError("kkmRetryUnsupportedMode", "CONFLICT", 409);
    }
    if (receipt.status === FiscalReceiptStatus.SENT) {
      return { receipt, claimed: false, previous: receipt };
    }

    const draft = asFiscalDraft(receipt.payloadJson);
    if (!draft) {
      throw new AppError("kkmReceiptPayloadInvalid", "CONFLICT", 409);
    }

    const activeClaim =
      receipt.status === FiscalReceiptStatus.PROCESSING &&
      receipt.nextAttemptAt !== null &&
      receipt.nextAttemptAt > now;
    const withinBackoff = receipt.nextAttemptAt !== null && receipt.nextAttemptAt > now;
    const firstManualRetry =
      input.trigger === "manual" &&
      receipt.status === FiscalReceiptStatus.FAILED &&
      receipt.attemptCount <= 1;
    const scheduled =
      receipt.status !== FiscalReceiptStatus.PROCESSING &&
      withinBackoff &&
      input.trigger !== "initial" &&
      !firstManualRetry;
    if (activeClaim || scheduled) {
      return { receipt, claimed: false, previous: receipt };
    }

    const claimed = await tx.fiscalReceipt.update({
      where: { id: receipt.id },
      data: {
        status: FiscalReceiptStatus.PROCESSING,
        nextAttemptAt: new Date(now.getTime() + adapterRetryLeaseMs),
        attemptCount: { increment: 1 },
      },
    });
    return { receipt: claimed, claimed: true, previous: receipt, draft };
  });

  if (!claim.claimed) {
    const receipt =
      claim.receipt.status === FiscalReceiptStatus.PROCESSING && input.waitForInProgress !== false
        ? await waitForAdapterReceiptOutcome(claim.receipt.id)
        : claim.receipt;
    return {
      receipt,
      providerCalled: false,
      finalized: false,
      previous: claim.previous,
    };
  }

  const finalize = async (result: {
    status: typeof FiscalReceiptStatus.SENT | typeof FiscalReceiptStatus.FAILED;
    errorMessage: string | null;
    providerReceiptId?: string | null;
    fiscalNumber?: string | null;
    kkmFactoryNumber?: string | null;
    kkmRegistrationNumber?: string | null;
    fiscalModeStatus?: "NOT_SENT" | "SENT" | "FAILED" | null;
    upfdOrFiscalMemory?: string | null;
    qrPayload?: string | null;
    fiscalizedAt?: Date | null;
    rawJson?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
  }) => {
    const finalized = await prisma.$transaction(async (tx) => {
      const updated = await tx.fiscalReceipt.updateMany({
        where: {
          id: claim.receipt.id,
          status: FiscalReceiptStatus.PROCESSING,
          attemptCount: claim.receipt.attemptCount,
        },
        data:
          result.status === FiscalReceiptStatus.SENT
            ? {
                status: FiscalReceiptStatus.SENT,
                lastError: null,
                nextAttemptAt: null,
                sentAt: result.fiscalizedAt,
                fiscalizedAt: result.fiscalizedAt,
                providerReceiptId: result.providerReceiptId,
                fiscalNumber: result.fiscalNumber,
                kkmFactoryNumber: result.kkmFactoryNumber,
                kkmRegistrationNumber: result.kkmRegistrationNumber,
                fiscalModeStatus: result.fiscalModeStatus ?? "SENT",
                upfdOrFiscalMemory: result.upfdOrFiscalMemory,
                qrPayload: result.qrPayload,
                qr: result.qrPayload,
              }
            : {
                status: FiscalReceiptStatus.FAILED,
                fiscalModeStatus: "FAILED",
                lastError: result.errorMessage,
                nextAttemptAt: new Date(Date.now() + 60_000),
              },
      });
      if (!updated.count) {
        return false;
      }

      await tx.customerOrder.update({
        where: { id: claim.receipt.customerOrderId },
        data:
          result.status === FiscalReceiptStatus.SENT
            ? {
                kkmStatus: "SENT",
                kkmReceiptId: result.providerReceiptId,
                kkmRawJson: result.rawJson ?? Prisma.DbNull,
              }
            : {
                kkmStatus: "FAILED",
                kkmReceiptId: null,
                kkmRawJson: toJson({
                  message: result.errorMessage,
                  attemptCount: claim.receipt.attemptCount,
                }) as Prisma.InputJsonValue,
              },
      });

      if (input.audit) {
        await writeAuditLog(tx, {
          organizationId: claim.receipt.organizationId,
          actorId: input.audit.actorId,
          action: input.audit.action,
          entity: input.audit.entity,
          entityId:
            input.audit.entity === "CustomerOrder"
              ? claim.receipt.customerOrderId
              : claim.receipt.id,
          before: toJson({
            status: claim.previous.status,
            attemptCount: claim.previous.attemptCount,
          }),
          after: toJson({
            status: result.status,
            attemptCount: claim.receipt.attemptCount,
            providerReceiptId: result.providerReceiptId ?? null,
            errorMessage: result.errorMessage,
          }),
          requestId: input.audit.requestId,
        });
      }
      return true;
    });

    const receipt = await prisma.fiscalReceipt.findUniqueOrThrow({
      where: { id: claim.receipt.id },
    });
    if (!finalized && receipt.status === FiscalReceiptStatus.PROCESSING) {
      return {
        receipt:
          input.waitForInProgress === false
            ? receipt
            : await waitForAdapterReceiptOutcome(receipt.id),
        finalized,
      };
    }
    return { receipt, finalized };
  };

  const draft = claim.draft;
  if (!draft) {
    throw new AppError("kkmReceiptPayloadInvalid", "CONFLICT", 409);
  }

  const adapter = getKkmAdapter(claim.receipt.providerKey);
  if (!adapter.supportsIdempotentFiscalization) {
    const result = await finalize({
      status: FiscalReceiptStatus.FAILED,
      errorMessage: "kkmAdapterIdempotencyUnsupported",
    });
    if (result.finalized) {
      incrementCounter(kkmReceiptsFailedTotal, { mode: KkmMode.ADAPTER });
    }
    return {
      ...result,
      providerCalled: false,
      previous: claim.previous,
    };
  }

  let fiscalized: Awaited<ReturnType<typeof adapter.fiscalizeReceipt>>;
  try {
    fiscalized = await adapter.fiscalizeReceipt(draft, {
      providerCommandId: claim.receipt.idempotencyKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result = await finalize({
      status: FiscalReceiptStatus.FAILED,
      errorMessage: message,
    });
    if (result.finalized) {
      incrementCounter(kkmReceiptsFailedTotal, { mode: KkmMode.ADAPTER });
    }
    return {
      ...result,
      providerCalled: true,
      previous: claim.previous,
    };
  }

  const fiscalMeta = resolveFiscalMetadataFromResult({
    result: fiscalized,
    fallbackStatus: "SENT",
  });
  const fiscalizedAt = fiscalized.fiscalizedAt ?? new Date();
  const result = await finalize({
    status: FiscalReceiptStatus.SENT,
    errorMessage: null,
    providerReceiptId: fiscalized.providerReceiptId,
    fiscalNumber: fiscalized.fiscalNumber ?? null,
    kkmFactoryNumber: fiscalMeta.kkmFactoryNumber,
    kkmRegistrationNumber: fiscalMeta.kkmRegistrationNumber,
    fiscalModeStatus: fiscalMeta.fiscalModeStatus ?? "SENT",
    upfdOrFiscalMemory: fiscalMeta.upfdOrFiscalMemory,
    qrPayload: fiscalMeta.qrPayload,
    fiscalizedAt,
    rawJson: fiscalized.rawJson ?? null,
  });
  if (result.finalized) {
    incrementCounter(kkmReceiptsSentTotal, { mode: KkmMode.ADAPTER });
  }
  return {
    ...result,
    providerCalled: true,
    previous: claim.previous,
  };
};

const assertKkmFeatureEnabled = async (organizationId: string) => {
  await assertFeatureEnabled({ organizationId, feature: "kkm" });
};

export const queueFiscalReceipt = async (input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  storeId: string;
  customerOrderId: string;
  idempotencyKey: string;
  mode: KkmMode;
  providerKey?: string | null;
  currencyCode?: string | null;
  currencyRateKgsPerUnit?: number | string | Prisma.Decimal | null;
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
      currencyCode: input.currencyCode ?? null,
      currencyRateKgsPerUnit: input.currencyRateKgsPerUnit ?? null,
      status: FiscalReceiptStatus.QUEUED,
      payloadJson: toJson(input.payload) as Prisma.InputJsonValue,
      fiscalModeStatus: "NOT_SENT",
    },
    update: {
      payloadJson: toJson(input.payload) as Prisma.InputJsonValue,
      mode: input.mode,
      providerKey: input.providerKey ?? null,
      currencyCode: input.currencyCode ?? null,
      currencyRateKgsPerUnit: input.currencyRateKgsPerUnit ?? null,
      status: FiscalReceiptStatus.QUEUED,
      fiscalModeStatus: "NOT_SENT",
      kkmFactoryNumber: null,
      kkmRegistrationNumber: null,
      upfdOrFiscalMemory: null,
      qrPayload: null,
      fiscalizedAt: null,
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
  user: StoreAccessUser;
}) => {
  await assertKkmFeatureEnabled(input.organizationId);

  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, store.id);

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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
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

export const pairConnectorDevice = async (input: { code: string; deviceName: string }) => {
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
    await assertKkmFeatureEnabled(pairing.organizationId);

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
  await assertKkmFeatureEnabled(device.organizationId);
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
  const leaseExpiresAt = new Date(now.getTime() + connectorProcessingLeaseMs);

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
        AND (
          (
            "status" = ${FiscalReceiptStatus.QUEUED}::"FiscalReceiptStatus"
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          )
          OR (
            "status" = ${FiscalReceiptStatus.PROCESSING}::"FiscalReceiptStatus"
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          )
        )
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
        OR: [
          {
            status: FiscalReceiptStatus.QUEUED,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: FiscalReceiptStatus.PROCESSING,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
        ],
      },
      data: {
        status: FiscalReceiptStatus.PROCESSING,
        connectorDeviceId: device.id,
        attemptCount: { increment: 1 },
        nextAttemptAt: leaseExpiresAt,
      },
    });

    return receipts.map((receipt) => ({
      id: receipt.id,
      customerOrderId: receipt.customerOrderId,
      idempotencyKey: receipt.idempotencyKey,
      claimAttempt: receipt.attemptCount + 1,
      payload: receipt.payloadJson,
      createdAt: receipt.createdAt,
    }));
  });
};

export const connectorPushResult = async (input: {
  token: string;
  receiptId: string;
  claimAttempt: number;
  status: "SENT" | "FAILED";
  providerReceiptId?: string | null;
  fiscalNumber?: string | null;
  qr?: string | null;
  kkmFactoryNumber?: string | null;
  kkmRegistrationNumber?: string | null;
  upfdOrFiscalMemory?: string | null;
  qrPayload?: string | null;
  errorMessage?: string | null;
}) => {
  if (!Number.isSafeInteger(input.claimAttempt) || input.claimAttempt < 1) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const device = await resolveConnectorDevice(input.token);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const nextStatus =
      input.status === "SENT" ? FiscalReceiptStatus.SENT : FiscalReceiptStatus.FAILED;
    const connectorMetadata = extractFiscalMetadata({
      kkmFactoryNumber: input.kkmFactoryNumber ?? null,
      kkmRegistrationNumber: input.kkmRegistrationNumber ?? null,
      upfdOrFiscalMemory: input.upfdOrFiscalMemory ?? null,
      qrPayload: input.qrPayload ?? input.qr ?? null,
    });
    const claimed = await tx.fiscalReceipt.updateMany({
      where: {
        id: input.receiptId,
        organizationId: device.organizationId,
        storeId: device.storeId,
        mode: KkmMode.CONNECTOR,
        status: FiscalReceiptStatus.PROCESSING,
        connectorDeviceId: device.id,
        attemptCount: input.claimAttempt,
        nextAttemptAt: { gt: now },
      },
      data: {
        status: nextStatus,
        providerReceiptId: input.providerReceiptId ?? null,
        fiscalNumber: input.fiscalNumber ?? null,
        kkmFactoryNumber: input.status === "SENT" ? connectorMetadata.kkmFactoryNumber : null,
        kkmRegistrationNumber:
          input.status === "SENT" ? connectorMetadata.kkmRegistrationNumber : null,
        fiscalModeStatus: input.status,
        upfdOrFiscalMemory: input.status === "SENT" ? connectorMetadata.upfdOrFiscalMemory : null,
        qrPayload: input.status === "SENT" ? connectorMetadata.qrPayload : null,
        qr: input.status === "SENT" ? (input.qr ?? connectorMetadata.qrPayload) : null,
        fiscalizedAt: input.status === "SENT" ? now : null,
        lastError: input.status === "FAILED" ? (input.errorMessage ?? "connectorFailed") : null,
        nextAttemptAt: input.status === "FAILED" ? new Date(Date.now() + 30_000) : null,
        sentAt: input.status === "SENT" ? now : null,
        connectorDeviceId: device.id,
      },
    });
    if (claimed.count !== 1) {
      const current = await tx.fiscalReceipt.findFirst({
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
      if (current?.status === FiscalReceiptStatus.SENT) {
        return { receipt: current, finalized: false, status: current.status };
      }
      throw new AppError("kkmReceiptNotFound", "NOT_FOUND", 404);
    }

    const updated = await tx.fiscalReceipt.findUniqueOrThrow({
      where: { id: input.receiptId },
    });

    await tx.customerOrder.update({
      where: { id: updated.customerOrderId },
      data: {
        kkmStatus: input.status,
        kkmReceiptId: input.providerReceiptId ?? null,
        kkmRawJson:
          input.status === "SENT"
            ? toJson({
                connectorDeviceId: device.id,
                fiscalNumber: input.fiscalNumber ?? null,
                kkmFactoryNumber: connectorMetadata.kkmFactoryNumber,
                kkmRegistrationNumber: connectorMetadata.kkmRegistrationNumber,
                upfdOrFiscalMemory: connectorMetadata.upfdOrFiscalMemory,
                qrPayload: connectorMetadata.qrPayload,
                qr: input.qr ?? connectorMetadata.qrPayload,
              })
            : toJson({
                connectorDeviceId: device.id,
                errorMessage: input.errorMessage ?? "connectorFailed",
              }),
      },
    });

    await writeAuditLog(tx, {
      organizationId: device.organizationId,
      actorId: null,
      action: "KKM_CONNECTOR_RESULT",
      entity: "FiscalReceipt",
      entityId: updated.id,
      before: toJson({
        status: FiscalReceiptStatus.PROCESSING,
        attemptCount: input.claimAttempt,
        connectorDeviceId: device.id,
      }),
      after: toJson({
        status: updated.status,
        attemptCount: updated.attemptCount,
        connectorDeviceId: updated.connectorDeviceId,
        providerReceiptId: updated.providerReceiptId,
      }),
      requestId: `kkm-connector-result:${updated.id}:${input.claimAttempt}`,
    });

    return { receipt: updated, finalized: true, status: nextStatus };
  });

  if (result.finalized) {
    setGauge(connectorOnlineGauge, { storeId: device.storeId }, 1);
    incrementCounter(
      result.status === FiscalReceiptStatus.SENT
        ? kkmReceiptsSentTotal
        : kkmReceiptsFailedTotal,
      { mode: KkmMode.CONNECTOR },
    );
  }

  return {
    id: result.receipt.id,
    status: result.receipt.status,
    customerOrderId: result.receipt.customerOrderId,
  };
};

export const listFiscalReceipts = async (input: {
  organizationId: string;
  storeId?: string;
  status?: FiscalReceiptStatus;
  page: number;
  pageSize: number;
  user: StoreAccessUser;
}) => {
  const accessibleStoreIds = await resolveAccessibleStoreIds(prisma, input.user);
  if (input.storeId && !accessibleStoreIds.includes(input.storeId)) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  const where = {
    organizationId: input.organizationId,
    storeId: input.storeId ?? { in: accessibleStoreIds },
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
  user: StoreAccessUser;
}) => {
  const receipt = await prisma.fiscalReceipt.findFirst({
    where: { id: input.receiptId, organizationId: input.organizationId },
  });
  if (!receipt) {
    throw new AppError("kkmReceiptNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(prisma, input.user, receipt.storeId);

  if (receipt.mode === KkmMode.CONNECTOR) {
    const updated = await prisma.fiscalReceipt.update({
      where: { id: receipt.id },
      data: {
        status: FiscalReceiptStatus.QUEUED,
        fiscalModeStatus: "NOT_SENT",
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

  const result = await processAdapterFiscalReceipt({
    receiptId: receipt.id,
    trigger: "manual",
    waitForInProgress: true,
    audit: {
      actorId: input.actorId,
      action: "KKM_RECEIPT_RETRY",
      entity: "FiscalReceipt",
      requestId: input.requestId,
    },
  });
  return {
    id: result.receipt.id,
    status: result.receipt.status,
    ...(result.receipt.status === FiscalReceiptStatus.FAILED
      ? { errorMessage: result.receipt.lastError }
      : {}),
  };
};

export const runKkmRetryJob = async () => {
  const now = new Date();
  const candidates = await prisma.fiscalReceipt.findMany({
    where: {
      mode: KkmMode.ADAPTER,
      OR: [
        {
          status: { in: [FiscalReceiptStatus.FAILED, FiscalReceiptStatus.QUEUED] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        {
          status: FiscalReceiptStatus.PROCESSING,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });

  let sent = 0;
  let failedCount = 0;
  let processed = 0;
  for (const receipt of candidates) {
    try {
      const result = await processAdapterFiscalReceipt({
        receiptId: receipt.id,
        trigger: "scheduled",
        waitForInProgress: false,
        audit: {
          actorId: null,
          action: "KKM_RECEIPT_RETRY_JOB",
          entity: "FiscalReceipt",
          requestId: `kkm-retry-job:${receipt.id}`,
        },
      });
      if (!result.finalized) {
        continue;
      }
      processed += 1;
      if (result.receipt.status === FiscalReceiptStatus.SENT) {
        sent += 1;
      } else if (result.receipt.status === FiscalReceiptStatus.FAILED) {
        failedCount += 1;
      }
    } catch {
      processed += 1;
      failedCount += 1;
    }
  }

  const result: JobResult = {
    job: "kkm-retry-receipts",
    status: "ok",
    details: { processed, sent, failed: failedCount },
  };
  return result;
};

registerJob("kkm-retry-receipts", {
  handler: runKkmRetryJob,
  maxAttempts: 2,
  baseDelayMs: 1000,
});
