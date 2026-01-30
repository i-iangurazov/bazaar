import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExportJobStatus, ExportType, Prisma, StockMovementType } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toCsv } from "@/server/services/csv";
import { toJson } from "@/server/services/json";

type ExportRequestInput = {
  organizationId: string;
  storeId: string;
  type: ExportType;
  periodStart: Date;
  periodEnd: Date;
  requestedById: string;
  requestId: string;
};

type ComplianceFlags = {
  enableMarking: boolean;
  enableEttn: boolean;
};

const formatDay = (date: Date) => date.toISOString().slice(0, 10);

const ensureExportDir = async () => {
  const directory = join(tmpdir(), "exports");
  await fs.mkdir(directory, { recursive: true });
  return directory;
};

const buildFileName = (type: ExportType, jobId: string) =>
  `${type.toLowerCase()}-${jobId}.csv`;

const resolveComplianceFlags = async (
  organizationId: string,
  storeId: string,
): Promise<ComplianceFlags> => {
  const profile = await prisma.storeComplianceProfile.findFirst({
    where: { organizationId, storeId },
    select: { enableMarking: true, enableEttn: true },
  });
  return {
    enableMarking: profile?.enableMarking ?? false,
    enableEttn: profile?.enableEttn ?? false,
  };
};

const loadComplianceFlags = async (organizationId: string, productIds: string[]) => {
  if (!productIds.length) {
    return new Map<string, { requiresMarking: boolean; requiresEttn: boolean; markingType: string | null }>();
  }
  const flags = await prisma.productComplianceFlags.findMany({
    where: { organizationId, productId: { in: productIds } },
    select: { productId: true, requiresMarking: true, requiresEttn: true, markingType: true },
  });
  return new Map(flags.map((flag) => [flag.productId, flag]));
};

const buildSalesSummaryRows = async (
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
) => {
  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId,
      type: StockMovementType.SALE,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    select: { qtyDelta: true, createdAt: true },
  });

  const byDay = new Map<string, { totalQty: number; movementCount: number }>();
  movements.forEach((movement) => {
    const day = formatDay(movement.createdAt);
    const entry = byDay.get(day) ?? { totalQty: 0, movementCount: 0 };
    entry.totalQty += Math.abs(movement.qtyDelta);
    entry.movementCount += 1;
    byDay.set(day, entry);
  });

  return Array.from(byDay.entries()).map(([day, entry]) => ({
    date: day,
    store: storeName,
    totalQty: entry.totalQty,
    movementCount: entry.movementCount,
  }));
};

const buildStockMovementsRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
  compliance: ComplianceFlags,
) => {
  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      variant: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const productIds = movements.map((movement) => movement.product.id);
  const flagsMap = await loadComplianceFlags(organizationId, productIds);

  return movements.map((movement) => {
    const flags = flagsMap.get(movement.product.id);
    const row: Record<string, unknown> = {
      date: movement.createdAt.toISOString(),
      store: storeName,
      sku: movement.product.sku,
      product: movement.product.name,
      variant: movement.variant?.name ?? "",
      movementType: movement.type,
      qtyDelta: movement.qtyDelta,
      reference: [movement.referenceType, movement.referenceId].filter(Boolean).join(":"),
      actor: movement.createdBy?.name ?? "",
    };
    if (compliance.enableMarking) {
      row.markingRequired = flags?.requiresMarking ?? false;
      row.markingType = flags?.markingType ?? "";
    }
    if (compliance.enableEttn) {
      row.ettnRequired = flags?.requiresEttn ?? false;
    }
    return row;
  });
};

const buildPurchasesRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
  compliance: ComplianceFlags,
) => {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      organizationId,
      storeId,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: {
      supplier: true,
      lines: { include: { product: { select: { id: true, sku: true, name: true } }, variant: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const productIds = orders.flatMap((order) => order.lines.map((line) => line.product.id));
  const flagsMap = await loadComplianceFlags(organizationId, productIds);

  return orders.flatMap((order) =>
    order.lines.map((line) => {
      const flags = flagsMap.get(line.product.id);
      const unitCost = line.unitCost ? Number(line.unitCost) : null;
      const row: Record<string, unknown> = {
        poId: order.id,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        receivedAt: order.receivedAt ? order.receivedAt.toISOString() : "",
        store: storeName,
        supplier: order.supplier.name,
        sku: line.product.sku,
        product: line.product.name,
        variant: line.variant?.name ?? "",
        qtyOrdered: line.qtyOrdered,
        qtyReceived: line.qtyReceived,
        unitCostKgs: unitCost ?? "",
        lineTotalKgs: unitCost ? unitCost * line.qtyReceived : "",
      };
      if (compliance.enableMarking) {
        row.markingRequired = flags?.requiresMarking ?? false;
        row.markingType = flags?.markingType ?? "";
      }
      if (compliance.enableEttn) {
        row.ettnRequired = flags?.requiresEttn ?? false;
      }
      return row;
    }),
  );
};

const buildInventoryRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  compliance: ComplianceFlags,
) => {
  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { storeId },
    include: {
      product: { select: { id: true, sku: true, name: true, basePriceKgs: true } },
      variant: { select: { id: true, name: true } },
    },
  });
  const policies = await prisma.reorderPolicy.findMany({
    where: { storeId },
    select: { productId: true, minStock: true },
  });
  const policyMap = new Map(policies.map((policy) => [policy.productId, policy.minStock]));

  const storePrices = await prisma.storePrice.findMany({
    where: { storeId },
    select: { productId: true, variantId: true, priceKgs: true },
  });

  const productIds = snapshots.map((snapshot) => snapshot.product.id);
  const flagsMap = await loadComplianceFlags(organizationId, productIds);

  return snapshots.map((snapshot) => {
    const priceOverride =
      storePrices.find(
        (price) =>
          price.productId === snapshot.product.id &&
          (price.variantId ?? null) === (snapshot.variantId ?? null),
      ) ?? storePrices.find((price) => price.productId === snapshot.product.id && !price.variantId);
    const basePrice = snapshot.product.basePriceKgs ? Number(snapshot.product.basePriceKgs) : null;
    const effectivePrice = priceOverride ? Number(priceOverride.priceKgs) : basePrice;
    const flags = flagsMap.get(snapshot.product.id);

    const row: Record<string, unknown> = {
      store: storeName,
      sku: snapshot.product.sku,
      product: snapshot.product.name,
      variant: snapshot.variant?.name ?? "",
      onHand: snapshot.onHand,
      onOrder: snapshot.onOrder,
      minStock: policyMap.get(snapshot.product.id) ?? 0,
      reorderPoint: policyMap.get(snapshot.product.id) ?? 0,
      effectivePriceKgs: effectivePrice ?? "",
    };

    if (compliance.enableMarking) {
      row.markingRequired = flags?.requiresMarking ?? false;
      row.markingType = flags?.markingType ?? "";
    }
    if (compliance.enableEttn) {
      row.ettnRequired = flags?.requiresEttn ?? false;
    }

    return row;
  });
};

const buildPeriodCloseRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
) => {
  const close = await prisma.periodClose.findFirst({
    where: { organizationId, storeId, periodStart, periodEnd },
  });
  if (!close) {
    throw new AppError("periodNotClosed", "NOT_FOUND", 404);
  }
  const totals = (close.totals as Record<string, unknown> | null) ?? {};
  return [
    {
      store: storeName,
      periodStart: formatDay(periodStart),
      periodEnd: formatDay(periodEnd),
      closedAt: close.closedAt.toISOString(),
      movementCount: totals.movementCount ?? 0,
      skuCount: totals.skuCount ?? 0,
      salesTotalKgs: totals.salesTotalKgs ?? "",
      purchasesTotalKgs: totals.purchasesTotalKgs ?? "",
    },
  ];
};

const buildReceiptsRows = async (
  organizationId: string,
  storeId: string,
  storeName: string,
  periodStart: Date,
  periodEnd: Date,
  compliance: ComplianceFlags,
) => {
  const movements = await prisma.stockMovement.findMany({
    where: {
      storeId,
      type: StockMovementType.SALE,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
    include: { product: { select: { id: true, sku: true, name: true } }, variant: true },
  });

  const productIds = movements.map((movement) => movement.product.id);
  const flagsMap = await loadComplianceFlags(organizationId, productIds);

  return movements.map((movement) => {
    const flags = flagsMap.get(movement.product.id);
    const row: Record<string, unknown> = {
      receiptId: movement.id,
      date: movement.createdAt.toISOString(),
      store: storeName,
      sku: movement.product.sku,
      product: movement.product.name,
      variant: movement.variant?.name ?? "",
      qty: Math.abs(movement.qtyDelta),
    };
    if (compliance.enableMarking) {
      row.markingRequired = flags?.requiresMarking ?? false;
      row.markingType = flags?.markingType ?? "";
    }
    if (compliance.enableEttn) {
      row.ettnRequired = flags?.requiresEttn ?? false;
    }
    return row;
  });
};

const buildExportData = async (
  input: ExportRequestInput,
  storeName: string,
  compliance: ComplianceFlags,
) => {
  switch (input.type) {
    case ExportType.SALES_SUMMARY: {
      const rows = await buildSalesSummaryRows(
        input.storeId,
        storeName,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: ["date", "store", "totalQty", "movementCount"],
        keys: ["date", "store", "totalQty", "movementCount"],
        rows,
      };
    }
    case ExportType.STOCK_MOVEMENTS: {
      const rows = await buildStockMovementsRows(
        input.organizationId,
        input.storeId,
        storeName,
        input.periodStart,
        input.periodEnd,
        compliance,
      );
      const header = [
        "date",
        "store",
        "sku",
        "product",
        "variant",
        "movementType",
        "qtyDelta",
        "reference",
        "actor",
      ];
      const keys = [
        "date",
        "store",
        "sku",
        "product",
        "variant",
        "movementType",
        "qtyDelta",
        "reference",
        "actor",
      ];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    case ExportType.PURCHASES: {
      const rows = await buildPurchasesRows(
        input.organizationId,
        input.storeId,
        storeName,
        input.periodStart,
        input.periodEnd,
        compliance,
      );
      const header = [
        "poId",
        "status",
        "createdAt",
        "receivedAt",
        "store",
        "supplier",
        "sku",
        "product",
        "variant",
        "qtyOrdered",
        "qtyReceived",
        "unitCostKgs",
        "lineTotalKgs",
      ];
      const keys = [
        "poId",
        "status",
        "createdAt",
        "receivedAt",
        "store",
        "supplier",
        "sku",
        "product",
        "variant",
        "qtyOrdered",
        "qtyReceived",
        "unitCostKgs",
        "lineTotalKgs",
      ];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    case ExportType.INVENTORY_ON_HAND: {
      const rows = await buildInventoryRows(
        input.organizationId,
        input.storeId,
        storeName,
        compliance,
      );
      const header = [
        "store",
        "sku",
        "product",
        "variant",
        "onHand",
        "onOrder",
        "minStock",
        "reorderPoint",
        "effectivePriceKgs",
      ];
      const keys = [
        "store",
        "sku",
        "product",
        "variant",
        "onHand",
        "onOrder",
        "minStock",
        "reorderPoint",
        "effectivePriceKgs",
      ];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    case ExportType.PERIOD_CLOSE_REPORT: {
      const rows = await buildPeriodCloseRows(
        input.organizationId,
        input.storeId,
        storeName,
        input.periodStart,
        input.periodEnd,
      );
      return {
        header: [
          "store",
          "periodStart",
          "periodEnd",
          "closedAt",
          "movementCount",
          "skuCount",
          "salesTotalKgs",
          "purchasesTotalKgs",
        ],
        keys: [
          "store",
          "periodStart",
          "periodEnd",
          "closedAt",
          "movementCount",
          "skuCount",
          "salesTotalKgs",
          "purchasesTotalKgs",
        ],
        rows,
      };
    }
    case ExportType.RECEIPTS_FOR_KKM: {
      const rows = await buildReceiptsRows(
        input.organizationId,
        input.storeId,
        storeName,
        input.periodStart,
        input.periodEnd,
        compliance,
      );
      const header = ["receiptId", "date", "store", "sku", "product", "variant", "qty"];
      const keys = ["receiptId", "date", "store", "sku", "product", "variant", "qty"];
      if (compliance.enableMarking) {
        header.push("markingRequired", "markingType");
        keys.push("markingRequired", "markingType");
      }
      if (compliance.enableEttn) {
        header.push("ettnRequired");
        keys.push("ettnRequired");
      }
      return { header, keys, rows };
    }
    default:
      throw new AppError("exportTypeInvalid", "BAD_REQUEST", 400);
  }
};

export const listExportJobs = async (organizationId: string, storeId?: string) => {
  return prisma.exportJob.findMany({
    where: { organizationId, ...(storeId ? { storeId } : {}) },
    orderBy: { createdAt: "desc" },
  });
};

export const getExportJob = async (organizationId: string, jobId: string) => {
  return prisma.exportJob.findFirst({
    where: { id: jobId, organizationId },
  });
};

export const requestExport = async (input: ExportRequestInput) => {
  const store = await prisma.store.findFirst({
    where: { id: input.storeId, organizationId: input.organizationId },
    select: { id: true, name: true },
  });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }

  const job = await prisma.exportJob.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      type: input.type,
      status: ExportJobStatus.RUNNING,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      requestedById: input.requestedById,
    },
  });

  await writeAuditLog(prisma, {
    organizationId: input.organizationId,
    actorId: input.requestedById,
    action: "EXPORT_REQUESTED",
    entity: "ExportJob",
    entityId: job.id,
    before: Prisma.DbNull,
    after: toJson(job),
    requestId: input.requestId,
  });

  try {
    const compliance = await resolveComplianceFlags(input.organizationId, input.storeId);
    const { header, keys, rows } = await buildExportData(input, store.name, compliance);
    const csv = toCsv(header, rows, keys);
    const directory = await ensureExportDir();
    const fileName = buildFileName(input.type, job.id);
    const storagePath = join(directory, fileName);

    await fs.writeFile(storagePath, csv, "utf8");

    const updated = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: ExportJobStatus.DONE,
        finishedAt: new Date(),
        fileName,
        mimeType: "text/csv",
        fileSize: Buffer.byteLength(csv),
        storagePath,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.requestedById,
      action: "EXPORT_FINISHED",
      entity: "ExportJob",
      entityId: updated.id,
      before: toJson(job),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "exportFailed";
    const failed = await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: ExportJobStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
      },
    });

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.requestedById,
      action: "EXPORT_FAILED",
      entity: "ExportJob",
      entityId: failed.id,
      before: toJson(job),
      after: toJson(failed),
      requestId: input.requestId,
    });

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("exportFailed", "INTERNAL_SERVER_ERROR", 500);
  }
};
