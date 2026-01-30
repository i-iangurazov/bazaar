import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

export type CreateSupplierInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export const createSupplier = async (input: CreateSupplierInput) =>
  prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SUPPLIER_CREATE",
      entity: "Supplier",
      entityId: supplier.id,
      before: null,
      after: toJson(supplier),
      requestId: input.requestId,
    });

    return supplier;
  });

export type UpdateSupplierInput = {
  supplierId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export const updateSupplier = async (input: UpdateSupplierInput) =>
  prisma.$transaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!before || before.organizationId !== input.organizationId) {
      throw new AppError("supplierNotFound", "NOT_FOUND", 404);
    }

    const supplier = await tx.supplier.update({
      where: { id: input.supplierId },
      data: {
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SUPPLIER_UPDATE",
      entity: "Supplier",
      entityId: supplier.id,
      before: toJson(before),
      after: toJson(supplier),
      requestId: input.requestId,
    });

    return supplier;
  });

export type DeleteSupplierInput = {
  supplierId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
};

export const deleteSupplier = async (input: DeleteSupplierInput) =>
  prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.organizationId !== input.organizationId) {
      throw new AppError("supplierNotFound", "NOT_FOUND", 404);
    }

    const [productsCount, poCount] = await Promise.all([
      tx.product.count({ where: { supplierId: input.supplierId } }),
      tx.purchaseOrder.count({ where: { supplierId: input.supplierId } }),
    ]);

    if (productsCount > 0 || poCount > 0) {
      throw new AppError("supplierInUse", "CONFLICT", 409);
    }

    await tx.supplier.delete({ where: { id: input.supplierId } });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SUPPLIER_DELETE",
      entity: "Supplier",
      entityId: supplier.id,
      before: toJson(supplier),
      after: null,
      requestId: input.requestId,
    });

    return supplier;
  });

export type BulkDeleteSuppliersInput = {
  supplierIds: string[];
  organizationId: string;
  actorId: string;
  requestId: string;
};

export const bulkDeleteSuppliers = async (input: BulkDeleteSuppliersInput) =>
  prisma.$transaction(async (tx) => {
    const uniqueIds = Array.from(new Set(input.supplierIds));
    const suppliers = await tx.supplier.findMany({
      where: {
        id: { in: uniqueIds },
        organizationId: input.organizationId,
      },
    });

    if (suppliers.length !== uniqueIds.length) {
      throw new AppError("supplierNotFound", "NOT_FOUND", 404);
    }

    const [productsCount, poCount] = await Promise.all([
      tx.product.count({ where: { supplierId: { in: uniqueIds } } }),
      tx.purchaseOrder.count({ where: { supplierId: { in: uniqueIds } } }),
    ]);

    if (productsCount > 0 || poCount > 0) {
      throw new AppError("supplierInUse", "CONFLICT", 409);
    }

    await tx.supplier.deleteMany({ where: { id: { in: uniqueIds } } });

    await Promise.all(
      suppliers.map((supplier) =>
        writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "SUPPLIER_DELETE",
          entity: "Supplier",
          entityId: supplier.id,
          before: toJson(supplier),
          after: null,
          requestId: input.requestId,
        }),
      ),
    );

    return { deleted: suppliers.length };
  });
