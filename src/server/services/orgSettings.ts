import type { LegalEntityType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

type OrgSettingsScope = {
  organizationId: string;
  actorId: string;
  requestId: string;
};

type GetBusinessProfileInput = OrgSettingsScope & {
  storeId?: string | null;
};

type UpdateBusinessProfileInput = OrgSettingsScope & {
  organizationName: string;
  storeId: string;
  legalEntityType?: LegalEntityType | null;
  legalName?: string | null;
  inn?: string | null;
  address?: string | null;
  phone?: string | null;
};

const normalizeOptional = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const getBusinessProfile = async (input: GetBusinessProfileInput) => {
  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true },
  });

  if (!organization) {
    throw new AppError("organizationNotFound", "NOT_FOUND", 404);
  }

  const stores = await prisma.store.findMany({
    where: { organizationId: input.organizationId },
    select: {
      id: true,
      name: true,
      code: true,
      legalEntityType: true,
      legalName: true,
      inn: true,
      address: true,
      phone: true,
    },
    orderBy: { name: "asc" },
  });

  const selectedStore =
    stores.find((store) => store.id === input.storeId) ??
    stores[0] ??
    null;

  return {
    organization,
    stores: stores.map((store) => ({ id: store.id, name: store.name, code: store.code })),
    selectedStore,
  };
};

export const updateBusinessProfile = async (input: UpdateBusinessProfileInput) =>
  prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, name: true },
    });
    if (!organization) {
      throw new AppError("organizationNotFound", "NOT_FOUND", 404);
    }

    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      select: {
        id: true,
        organizationId: true,
        legalEntityType: true,
        legalName: true,
        inn: true,
        address: true,
        phone: true,
      },
    });
    if (!store || store.organizationId !== input.organizationId) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }

    const inn = normalizeOptional(input.inn);
    if (inn && !/^\d{10,14}$/.test(inn)) {
      throw new AppError("invalidInn", "BAD_REQUEST", 400);
    }

    const updatedOrganization = await tx.organization.update({
      where: { id: input.organizationId },
      data: { name: input.organizationName.trim() },
      select: { id: true, name: true },
    });

    const updatedStore = await tx.store.update({
      where: { id: input.storeId },
      data: {
        legalEntityType: input.legalEntityType ?? null,
        legalName: normalizeOptional(input.legalName),
        inn,
        address: normalizeOptional(input.address),
        phone: normalizeOptional(input.phone),
      },
      select: {
        id: true,
        name: true,
        code: true,
        legalEntityType: true,
        legalName: true,
        inn: true,
        address: true,
        phone: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "BUSINESS_PROFILE_UPDATE",
      entity: "Organization",
      entityId: input.organizationId,
      before: toJson({
        organization,
        store: {
          id: store.id,
          legalEntityType: store.legalEntityType,
          legalName: store.legalName,
          inn: store.inn,
          address: store.address,
          phone: store.phone,
        },
      }),
      after: toJson({
        organization: updatedOrganization,
        store: updatedStore,
      }),
      requestId: input.requestId,
    });

    return {
      organization: updatedOrganization,
      selectedStore: updatedStore,
    };
  });
