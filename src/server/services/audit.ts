import { Prisma, type PrismaClient } from "@prisma/client";
import { recordBaamExecutionReceipt } from "./baamExecutionContext";

export type AuditParams = {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
  after?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
  requestId: string;
};

export const writeAuditLog = async (
  tx: Prisma.TransactionClient | PrismaClient,
  params: AuditParams,
) => {
  const entry = await tx.auditLog.create({
    data: {
      organizationId: params.organizationId,
      actorId: params.actorId ?? null,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      before: params.before ?? Prisma.DbNull,
      after: params.after ?? Prisma.DbNull,
      requestId: params.requestId,
    },
  });
  await recordBaamExecutionReceipt(tx, params, entry?.id);
};
