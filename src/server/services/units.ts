import { defaultUnitPrecision } from "@/lib/quantity";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

export const listUnits = async (organizationId: string) =>
  prisma.unit.findMany({
    where: { organizationId },
    orderBy: { code: "asc" },
  });

export const createUnit = async (input: {
  organizationId: string;
  actorId: string;
  requestId: string;
  code: string;
  labelRu: string;
  labelKg: string;
  quantityPrecision?: 0 | 3;
}) =>
  prisma.$transaction(async (tx) => {
    const existing = await tx.unit.findUnique({
      where: { organizationId_code: { organizationId: input.organizationId, code: input.code } },
    });
    if (existing) {
      throw new AppError("unitCodeExists", "CONFLICT", 409);
    }

    const unit = await tx.unit.create({
      data: {
        organizationId: input.organizationId,
        code: input.code,
        labelRu: input.labelRu,
        labelKg: input.labelKg,
        quantityPrecision: input.quantityPrecision ?? defaultUnitPrecision(input.code, input.labelRu),
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "UNIT_CREATE",
      entity: "Unit",
      entityId: unit.id,
      before: null,
      after: toJson(unit),
      requestId: input.requestId,
    });

    return unit;
  });

export const updateUnit = async (input: {
  unitId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  labelRu: string;
  labelKg: string;
  quantityPrecision?: 0 | 3;
}) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.unit.findUnique({ where: { id: input.unitId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("unitNotFound", "NOT_FOUND", 404);
    }

    if (input.quantityPrecision === 0 && before.quantityPrecision > 0 && await tx.product.count({ where: { baseUnitId: before.id } })) {
      throw new AppError("unitInUse", "CONFLICT", 409);
    }
    const unit = await tx.unit.update({
      where: { id: input.unitId },
      data: { labelRu: input.labelRu, labelKg: input.labelKg, quantityPrecision: input.quantityPrecision },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "UNIT_UPDATE",
      entity: "Unit",
      entityId: unit.id,
      before: toJson(before),
      after: toJson(unit),
      requestId: input.requestId,
    });

    return unit;
  });

export const removeUnit = async (input: {
  unitId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
}) =>
  prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUnique({ where: { id: input.unitId } });
    if (!unit || unit.organizationId !== input.organizationId) {
      throw new AppError("unitNotFound", "NOT_FOUND", 404);
    }

    const inUse = await tx.product.count({ where: { baseUnitId: unit.id } });
    if (inUse > 0) {
      throw new AppError("unitInUse", "CONFLICT", 409);
    }

    await tx.unit.delete({ where: { id: unit.id } });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "UNIT_REMOVE",
      entity: "Unit",
      entityId: unit.id,
      before: toJson(unit),
      after: null,
      requestId: input.requestId,
    });

    return unit;
  });
