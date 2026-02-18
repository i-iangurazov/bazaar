import { Prisma, type KkmMode, type MarkingMode } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

type ComplianceUpdateInput = {
  organizationId: string;
  storeId: string;
  updatedById: string;
  requestId: string;
  defaultLocale?: string | null;
  taxRegime?: string | null;
  enableKkm: boolean;
  kkmMode: KkmMode;
  enableEsf: boolean;
  enableEttn: boolean;
  enableMarking: boolean;
  markingMode: MarkingMode;
  kkmProviderKey?: string | null;
  kkmSettings?: Record<string, unknown> | null;
};

const normalizeJson = (value: Record<string, unknown> | null | undefined) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.DbNull;
  }
  return toJson(value);
};

export const getStoreComplianceProfile = async (organizationId: string, storeId: string) => {
  return prisma.storeComplianceProfile.findFirst({
    where: { organizationId, storeId },
  });
};

export const upsertStoreComplianceProfile = async (input: ComplianceUpdateInput) => {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true },
  });

  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const existing = await prisma.storeComplianceProfile.findFirst({
    where: { organizationId: input.organizationId, storeId: input.storeId },
  });

  const result = await prisma.storeComplianceProfile.upsert({
    where: { storeId: input.storeId },
    create: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      defaultLocale: input.defaultLocale ?? null,
      taxRegime: input.taxRegime ?? null,
      enableKkm: input.enableKkm,
      kkmMode: input.kkmMode,
      enableEsf: input.enableEsf,
      enableEttn: input.enableEttn,
      enableMarking: input.enableMarking,
      markingMode: input.markingMode,
      kkmProviderKey: input.kkmProviderKey ?? null,
      kkmSettings: normalizeJson(input.kkmSettings) ?? Prisma.DbNull,
      updatedById: input.updatedById,
    },
    update: {
      defaultLocale: input.defaultLocale ?? null,
      taxRegime: input.taxRegime ?? null,
      enableKkm: input.enableKkm,
      kkmMode: input.kkmMode,
      enableEsf: input.enableEsf,
      enableEttn: input.enableEttn,
      enableMarking: input.enableMarking,
      markingMode: input.markingMode,
      kkmProviderKey: input.kkmProviderKey ?? null,
      kkmSettings: normalizeJson(input.kkmSettings),
      updatedById: input.updatedById,
    },
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.updatedById,
    action: existing ? "COMPLIANCE_UPDATED" : "COMPLIANCE_CREATED",
    entity: "StoreComplianceProfile",
    entityId: result.id,
    before: existing ? toJson(existing) : Prisma.DbNull,
    after: toJson(result),
    requestId: input.requestId,
  });

  return result;
};
