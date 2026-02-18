import { Prisma } from "@prisma/client";
import type { TaxReferenceDocumentType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { toJson } from "@/server/services/json";

type BaseInput = {
  organizationId: string;
  storeId: string;
};

const ensureStore = async (input: BaseInput) => {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
};

const getStoreCompliance = async (input: BaseInput) => {
  const profile = await prisma.storeComplianceProfile.findUnique({
    where: { storeId: input.storeId },
    select: { enableEttn: true, enableEsf: true },
  });
  return {
    enableEttn: profile?.enableEttn ?? false,
    enableEsf: profile?.enableEsf ?? false,
  };
};

export const listEttnReferences = async (input: {
  organizationId: string;
  storeId?: string;
  documentType?: TaxReferenceDocumentType;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}) => {
  const where: Prisma.EttnReferenceWhereInput = {
    organizationId: input.organizationId,
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.documentType ? { documentType: input.documentType } : {}),
    ...((input.dateFrom || input.dateTo)
      ? {
          createdAt: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {}),
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.ettnReference.count({ where }),
    prisma.ettnReference.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, email: true } },
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

export const upsertEttnReference = async (input: {
  organizationId: string;
  storeId: string;
  documentType: TaxReferenceDocumentType;
  documentId: string;
  ettnNumber: string;
  ettnDate?: Date | null;
  notes?: string | null;
  actorId: string;
  requestId: string;
}) => {
  await ensureStore({ organizationId: input.organizationId, storeId: input.storeId });
  const compliance = await getStoreCompliance({
    organizationId: input.organizationId,
    storeId: input.storeId,
  });
  if (!compliance.enableEttn) {
    throw new AppError("ettnDisabled", "CONFLICT", 409);
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.ettnReference.findUnique({
      where: {
        organizationId_storeId_documentType_documentId: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          documentType: input.documentType,
          documentId: input.documentId,
        },
      },
    });

    const saved = await tx.ettnReference.upsert({
      where: {
        organizationId_storeId_documentType_documentId: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          documentType: input.documentType,
          documentId: input.documentId,
        },
      },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        documentType: input.documentType,
        documentId: input.documentId,
        ettnNumber: input.ettnNumber,
        ettnDate: input.ettnDate ?? null,
        notes: input.notes ?? null,
        createdById: input.actorId,
      },
      update: {
        ettnNumber: input.ettnNumber,
        ettnDate: input.ettnDate ?? null,
        notes: input.notes ?? null,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: existing ? "ETTN_REFERENCE_UPDATED" : "ETTN_REFERENCE_CREATED",
      entity: "EttnReference",
      entityId: saved.id,
      before: existing ? toJson(existing) : Prisma.DbNull,
      after: toJson(saved),
      requestId: input.requestId,
    });

    return saved;
  });
};

export const listEsfReferences = async (input: {
  organizationId: string;
  storeId?: string;
  documentType?: TaxReferenceDocumentType;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}) => {
  const where: Prisma.EsfReferenceWhereInput = {
    organizationId: input.organizationId,
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.documentType ? { documentType: input.documentType } : {}),
    ...((input.dateFrom || input.dateTo)
      ? {
          createdAt: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {}),
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.esfReference.count({ where }),
    prisma.esfReference.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true, email: true } },
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

export const upsertEsfReference = async (input: {
  organizationId: string;
  storeId: string;
  documentType: TaxReferenceDocumentType;
  documentId: string;
  esfNumber: string;
  esfDate?: Date | null;
  counterpartyName?: string | null;
  actorId: string;
  requestId: string;
}) => {
  await ensureStore({ organizationId: input.organizationId, storeId: input.storeId });
  const compliance = await getStoreCompliance({
    organizationId: input.organizationId,
    storeId: input.storeId,
  });
  if (!compliance.enableEsf) {
    throw new AppError("esfDisabled", "CONFLICT", 409);
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.esfReference.findUnique({
      where: {
        organizationId_storeId_documentType_documentId: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          documentType: input.documentType,
          documentId: input.documentId,
        },
      },
    });

    const saved = await tx.esfReference.upsert({
      where: {
        organizationId_storeId_documentType_documentId: {
          organizationId: input.organizationId,
          storeId: input.storeId,
          documentType: input.documentType,
          documentId: input.documentId,
        },
      },
      create: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        documentType: input.documentType,
        documentId: input.documentId,
        esfNumber: input.esfNumber,
        esfDate: input.esfDate ?? null,
        counterpartyName: input.counterpartyName ?? null,
        createdById: input.actorId,
      },
      update: {
        esfNumber: input.esfNumber,
        esfDate: input.esfDate ?? null,
        counterpartyName: input.counterpartyName ?? null,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: existing ? "ESF_REFERENCE_UPDATED" : "ESF_REFERENCE_CREATED",
      entity: "EsfReference",
      entityId: saved.id,
      before: existing ? toJson(existing) : Prisma.DbNull,
      after: toJson(saved),
      requestId: input.requestId,
    });

    return saved;
  });
};
