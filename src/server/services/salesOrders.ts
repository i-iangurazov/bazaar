import {
  Prisma,
  CustomerOrderSource,
  CustomerOrderStatus,
  StockMovementType,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { applyStockMovement } from "@/server/services/inventory";
import { withIdempotency } from "@/server/services/idempotency";
import { toJson } from "@/server/services/json";
import { eventBus } from "@/server/events/eventBus";
import { getLogger } from "@/server/logging";

const allowedTransitions: Record<CustomerOrderStatus, CustomerOrderStatus[]> = {
  DRAFT: [CustomerOrderStatus.CONFIRMED, CustomerOrderStatus.CANCELED],
  CONFIRMED: [CustomerOrderStatus.READY, CustomerOrderStatus.CANCELED],
  READY: [CustomerOrderStatus.COMPLETED, CustomerOrderStatus.CANCELED],
  COMPLETED: [],
  CANCELED: [],
};

const assertTransition = (from: CustomerOrderStatus, to: CustomerOrderStatus) => {
  if (!allowedTransitions[from]?.includes(to)) {
    throw new AppError("invalidTransition", "CONFLICT", 409);
  }
};

const assertEditable = (status: CustomerOrderStatus) => {
  if (status !== CustomerOrderStatus.DRAFT && status !== CustomerOrderStatus.CONFIRMED) {
    throw new AppError("salesOrderNotEditable", "CONFLICT", 409);
  }
};

const variantKeyFrom = (variantId?: string | null) => variantId ?? "BASE";

const toMoney = (value: Prisma.Decimal | number | null | undefined) =>
  typeof value === "number" ? value : value ? Number(value) : 0;
const roundMoney = (value: number) => Math.round(value * 100) / 100;

const nextSalesOrderNumber = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> => {
  const rows = await tx.$queryRaw<Array<{ salesOrderNumber: number }>>(Prisma.sql`
    INSERT INTO "OrganizationCounter" ("organizationId", "salesOrderNumber", "updatedAt")
    VALUES (${organizationId}, 1, NOW())
    ON CONFLICT ("organizationId")
    DO UPDATE SET
      "salesOrderNumber" = "OrganizationCounter"."salesOrderNumber" + 1,
      "updatedAt" = NOW()
    RETURNING "salesOrderNumber"
  `);
  const sequence = rows[0]?.salesOrderNumber;
  if (!sequence) {
    throw new AppError("salesOrderNumberFailed", "INTERNAL_SERVER_ERROR", 500);
  }
  return `SO-${String(sequence).padStart(6, "0")}`;
};

const recomputeTotals = async (
  tx: Prisma.TransactionClient,
  customerOrderId: string,
  updatedById: string,
) => {
  const aggregate = await tx.customerOrderLine.aggregate({
    where: { customerOrderId },
    _sum: { lineTotalKgs: true },
  });
  const subtotal = toMoney(aggregate._sum.lineTotalKgs);
  return tx.customerOrder.update({
    where: { id: customerOrderId },
    data: {
      subtotalKgs: subtotal,
      totalKgs: subtotal,
      updatedById,
    },
  });
};

const resolveUnitPrice = async (input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  storeId: string;
  productId: string;
  variantId?: string | null;
}) => {
  const { tx, organizationId, storeId, productId, variantId } = input;
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, organizationId: true, isDeleted: true, basePriceKgs: true, isBundle: true },
  });
  if (!product || product.isDeleted) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
  }
  if (product.organizationId !== organizationId) {
    throw new AppError("productOrgMismatch", "FORBIDDEN", 403);
  }

  if (variantId) {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { productId: true, isActive: true },
    });
    if (!variant || variant.productId !== productId || !variant.isActive) {
      throw new AppError("variantNotFound", "NOT_FOUND", 404);
    }
  }

  const variantKey = variantKeyFrom(variantId);
  const override = await tx.storePrice.findUnique({
    where: {
      organizationId_storeId_productId_variantKey: {
        organizationId,
        storeId,
        productId,
        variantKey,
      },
    },
    select: { priceKgs: true },
  });

  const basePrice = product.basePriceKgs ? Number(product.basePriceKgs) : 0;
  const unitPrice = override ? Number(override.priceKgs) : basePrice;

  return {
    variantKey,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    isBundle: product.isBundle,
  };
};

const resolveUnitCost = async (input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  productId: string;
  variantId?: string | null;
  isBundle: boolean;
}) => {
  const { tx, organizationId, productId, variantId, isBundle } = input;

  if (!isBundle) {
    const variantKey = variantKeyFrom(variantId);
    const direct = await tx.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId,
          productId,
          variantKey,
        },
      },
      select: { avgCostKgs: true },
    });
    if (direct?.avgCostKgs) {
      return Number(direct.avgCostKgs);
    }
    if (variantKey !== "BASE") {
      const fallback = await tx.productCost.findUnique({
        where: {
          organizationId_productId_variantKey: {
            organizationId,
            productId,
            variantKey: "BASE",
          },
        },
        select: { avgCostKgs: true },
      });
      return fallback?.avgCostKgs ? Number(fallback.avgCostKgs) : null;
    }
    return null;
  }

  const components = await tx.productBundleComponent.findMany({
    where: { organizationId, bundleProductId: productId },
    select: {
      componentProductId: true,
      componentVariantId: true,
      qty: true,
    },
  });
  if (!components.length) {
    return null;
  }

  let total = 0;
  for (const component of components) {
    const variantKey = variantKeyFrom(component.componentVariantId);
    const direct = await tx.productCost.findUnique({
      where: {
        organizationId_productId_variantKey: {
          organizationId,
          productId: component.componentProductId,
          variantKey,
        },
      },
      select: { avgCostKgs: true },
    });
    const fallback =
      !direct?.avgCostKgs && variantKey !== "BASE"
        ? await tx.productCost.findUnique({
            where: {
              organizationId_productId_variantKey: {
                organizationId,
                productId: component.componentProductId,
                variantKey: "BASE",
              },
            },
            select: { avgCostKgs: true },
          })
        : null;
    const componentCost = direct?.avgCostKgs ?? fallback?.avgCostKgs;
    if (!componentCost) {
      return null;
    }
    total += Number(componentCost) * component.qty;
  }

  return roundMoney(total);
};

const serializeOrder = <T extends { subtotalKgs: Prisma.Decimal; totalKgs: Prisma.Decimal }>(
  order: T,
): Omit<T, "subtotalKgs" | "totalKgs"> & { subtotalKgs: number; totalKgs: number } => ({
  ...order,
  subtotalKgs: Number(order.subtotalKgs),
  totalKgs: Number(order.totalKgs),
});

export const listCustomerOrders = async (input: {
  organizationId: string;
  storeId?: string;
  status?: CustomerOrderStatus;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}) => {
  const where: Prisma.CustomerOrderWhereInput = {
    organizationId: input.organizationId,
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.search
      ? {
          OR: [
            { number: { contains: input.search, mode: "insensitive" } },
            { customerName: { contains: input.search, mode: "insensitive" } },
            { customerPhone: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(input.dateFrom || input.dateTo
      ? {
          createdAt: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {}),
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    items: items.map(serializeOrder),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const getCustomerOrder = async (input: {
  organizationId: string;
  customerOrderId: string;
}) => {
  const order = await prisma.customerOrder.findFirst({
    where: { id: input.customerOrderId, organizationId: input.organizationId },
    include: {
      store: { select: { id: true, name: true, code: true } },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              isBundle: true,
              baseUnit: { select: { code: true, labelRu: true, labelKg: true } },
            },
          },
          variant: { select: { id: true, name: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!order) {
    return null;
  }

  return {
    ...serializeOrder(order),
    lines: order.lines.map((line) => ({
      ...line,
      unitPriceKgs: Number(line.unitPriceKgs),
      lineTotalKgs: Number(line.lineTotalKgs),
      unitCostKgs: line.unitCostKgs ? Number(line.unitCostKgs) : null,
      lineCostTotalKgs: line.lineCostTotalKgs ? Number(line.lineCostTotalKgs) : null,
    })),
  };
};

const toSeriesDateKey = (value: Date, groupBy: "day" | "week") => {
  if (groupBy === "day") {
    return value.toISOString().slice(0, 10);
  }
  const utc = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const weekday = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - weekday + 1);
  return utc.toISOString().slice(0, 10);
};

export const getSalesOrderMetrics = async (input: {
  organizationId: string;
  storeId?: string;
  dateFrom: Date;
  dateTo: Date;
  groupBy: "day" | "week";
}) => {
  const orders = await prisma.customerOrder.findMany({
    where: {
      organizationId: input.organizationId,
      status: CustomerOrderStatus.COMPLETED,
      ...(input.storeId ? { storeId: input.storeId } : {}),
      completedAt: {
        gte: input.dateFrom,
        lte: input.dateTo,
      },
    },
    select: {
      id: true,
      completedAt: true,
      lines: {
        select: {
          productId: true,
          qty: true,
          lineTotalKgs: true,
          lineCostTotalKgs: true,
          product: {
            select: {
              name: true,
              sku: true,
              isBundle: true,
            },
          },
        },
      },
    },
  });

  const seriesMap = new Map<string, { revenue: number; cost: number; profit: number }>();
  const topMap = new Map<
    string,
    {
      productId: string;
      name: string;
      sku: string;
      isBundle: boolean;
      qty: number;
      revenueKgs: number;
      costKgs: number;
      profitKgs: number;
    }
  >();

  let totalRevenueKgs = 0;
  let totalCostKgs = 0;
  let missingCostLines = 0;

  for (const order of orders) {
    const completedAt = order.completedAt ?? new Date();
    const key = toSeriesDateKey(completedAt, input.groupBy);
    const series = seriesMap.get(key) ?? { revenue: 0, cost: 0, profit: 0 };

    for (const line of order.lines) {
      const revenue = Number(line.lineTotalKgs);
      const cost = line.lineCostTotalKgs ? Number(line.lineCostTotalKgs) : 0;
      if (!line.lineCostTotalKgs) {
        missingCostLines += 1;
      }
      const profit = revenue - cost;

      series.revenue += revenue;
      series.cost += cost;
      series.profit += profit;
      totalRevenueKgs += revenue;
      totalCostKgs += cost;

      const top = topMap.get(line.productId) ?? {
        productId: line.productId,
        name: line.product.name,
        sku: line.product.sku,
        isBundle: line.product.isBundle,
        qty: 0,
        revenueKgs: 0,
        costKgs: 0,
        profitKgs: 0,
      };
      top.qty += line.qty;
      top.revenueKgs += revenue;
      top.costKgs += cost;
      top.profitKgs += profit;
      topMap.set(line.productId, top);
    }

    seriesMap.set(key, series);
  }

  const totalProfitKgs = totalRevenueKgs - totalCostKgs;
  const ordersCount = orders.length;
  const avgOrderValueKgs = ordersCount ? totalRevenueKgs / ordersCount : 0;
  const marginPct = totalRevenueKgs ? (totalProfitKgs / totalRevenueKgs) * 100 : 0;

  const series = Array.from(seriesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      date,
      revenueKgs: roundMoney(values.revenue),
      costKgs: roundMoney(values.cost),
      profitKgs: roundMoney(values.profit),
    }));

  const topItems = Array.from(topMap.values())
    .sort((a, b) => b.revenueKgs - a.revenueKgs)
    .map((item) => ({
      ...item,
      revenueKgs: roundMoney(item.revenueKgs),
      costKgs: roundMoney(item.costKgs),
      profitKgs: roundMoney(item.profitKgs),
    }));

  return {
    summary: {
      totalRevenueKgs: roundMoney(totalRevenueKgs),
      totalCostKgs: roundMoney(totalCostKgs),
      totalProfitKgs: roundMoney(totalProfitKgs),
      ordersCount,
      avgOrderValueKgs: roundMoney(avgOrderValueKgs),
      marginPct: roundMoney(marginPct),
      missingCostLines,
    },
    revenueSeries: series.map((item) => ({ date: item.date, revenueKgs: item.revenueKgs })),
    profitSeries: series.map((item) => ({ date: item.date, profitKgs: item.profitKgs })),
    costSeries: series.map((item) => ({ date: item.date, costKgs: item.costKgs })),
    topProductsByRevenue: topItems.filter((item) => !item.isBundle).slice(0, 10),
    topBundlesByRevenue: topItems.filter((item) => item.isBundle).slice(0, 10),
  };
};

export const createCustomerOrderDraft = async (input: {
  organizationId: string;
  storeId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  lines?: Array<{
    productId: string;
    variantId?: string | null;
    qty: number;
  }>;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findUnique({ where: { id: input.storeId } });
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }
    if (store.organizationId !== input.organizationId) {
      throw new AppError("storeOrgMismatch", "FORBIDDEN", 403);
    }

    const number = await nextSalesOrderNumber(tx, input.organizationId);

    let order = await tx.customerOrder.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        number,
        source: CustomerOrderSource.MANUAL,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        notes: input.notes ?? null,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });

    if (input.lines?.length) {
      const existingKeys = new Set<string>();

      for (const lineInput of input.lines) {
        const resolved = await resolveUnitPrice({
          tx,
          organizationId: input.organizationId,
          storeId: input.storeId,
          productId: lineInput.productId,
          variantId: lineInput.variantId ?? null,
        });
        const unitCost = await resolveUnitCost({
          tx,
          organizationId: input.organizationId,
          productId: lineInput.productId,
          variantId: lineInput.variantId ?? null,
          isBundle: resolved.isBundle,
        });

        const dedupeKey = `${lineInput.productId}:${resolved.variantKey}`;
        if (existingKeys.has(dedupeKey)) {
          throw new AppError("duplicateLineItem", "CONFLICT", 409);
        }
        existingKeys.add(dedupeKey);

        const lineTotal = resolved.unitPrice * lineInput.qty;
        const lineCostTotal = unitCost === null ? null : roundMoney(unitCost * lineInput.qty);
        await tx.customerOrderLine.create({
          data: {
            customerOrderId: order.id,
            productId: lineInput.productId,
            variantId: lineInput.variantId ?? null,
            variantKey: resolved.variantKey,
            qty: lineInput.qty,
            unitPriceKgs: resolved.unitPrice,
            lineTotalKgs: lineTotal,
            unitCostKgs: unitCost,
            lineCostTotalKgs: lineCostTotal,
          },
        });
      }

      order = await recomputeTotals(tx, order.id, input.actorId);
    }

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SALES_ORDER_CREATE",
      entity: "CustomerOrder",
      entityId: order.id,
      before: null,
      after: toJson(order),
      requestId: input.requestId,
    });

    return serializeOrder(order);
  });
};

export const setCustomerOrderCustomer = async (input: {
  organizationId: string;
  customerOrderId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findUnique({ where: { id: input.customerOrderId } });
    if (!order) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }
    if (order.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }

    assertEditable(order.status);

    const updated = await tx.customerOrder.update({
      where: { id: order.id },
      data: {
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        notes: input.notes ?? null,
        updatedById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SALES_ORDER_CUSTOMER_UPDATE",
      entity: "CustomerOrder",
      entityId: order.id,
      before: toJson(order),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return serializeOrder(updated);
  });
};

export const addCustomerOrderLine = async (input: {
  organizationId: string;
  customerOrderId: string;
  productId: string;
  variantId?: string | null;
  qty: number;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findUnique({ where: { id: input.customerOrderId } });
    if (!order) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }
    if (order.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }

    assertEditable(order.status);

    const { variantKey, unitPrice, isBundle } = await resolveUnitPrice({
      tx,
      organizationId: input.organizationId,
      storeId: order.storeId,
      productId: input.productId,
      variantId: input.variantId,
    });
    const unitCost = await resolveUnitCost({
      tx,
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId,
      isBundle,
    });

    const existing = await tx.customerOrderLine.findUnique({
      where: {
        customerOrderId_productId_variantKey: {
          customerOrderId: order.id,
          productId: input.productId,
          variantKey,
        },
      },
    });
    if (existing) {
      throw new AppError("duplicateLineItem", "CONFLICT", 409);
    }

    const lineTotal = unitPrice * input.qty;
    const lineCostTotal = unitCost === null ? null : roundMoney(unitCost * input.qty);
    const line = await tx.customerOrderLine.create({
      data: {
        customerOrderId: order.id,
        productId: input.productId,
        variantId: input.variantId ?? null,
        variantKey,
        qty: input.qty,
        unitPriceKgs: unitPrice,
        lineTotalKgs: lineTotal,
        unitCostKgs: unitCost,
        lineCostTotalKgs: lineCostTotal,
      },
    });

    await recomputeTotals(tx, order.id, input.actorId);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SALES_ORDER_LINE_ADD",
      entity: "CustomerOrder",
      entityId: order.id,
      before: null,
      after: toJson(line),
      requestId: input.requestId,
    });

    return {
      ...line,
      unitPriceKgs: Number(line.unitPriceKgs),
      lineTotalKgs: Number(line.lineTotalKgs),
      unitCostKgs: line.unitCostKgs ? Number(line.unitCostKgs) : null,
      lineCostTotalKgs: line.lineCostTotalKgs ? Number(line.lineCostTotalKgs) : null,
    };
  });
};

export const updateCustomerOrderLine = async (input: {
  organizationId: string;
  lineId: string;
  qty: number;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const line = await tx.customerOrderLine.findUnique({
      where: { id: input.lineId },
      include: { customerOrder: true },
    });
    if (!line) {
      throw new AppError("salesOrderLineNotFound", "NOT_FOUND", 404);
    }
    if (line.customerOrder.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }

    assertEditable(line.customerOrder.status);

    const nextLine = await tx.customerOrderLine.update({
      where: { id: line.id },
      data: {
        qty: input.qty,
        lineTotalKgs: Number(line.unitPriceKgs) * input.qty,
        lineCostTotalKgs:
          line.unitCostKgs === null ? null : roundMoney(Number(line.unitCostKgs) * input.qty),
      },
    });

    await recomputeTotals(tx, line.customerOrderId, input.actorId);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SALES_ORDER_LINE_UPDATE",
      entity: "CustomerOrder",
      entityId: line.customerOrderId,
      before: toJson(line),
      after: toJson(nextLine),
      requestId: input.requestId,
    });

    return {
      ...nextLine,
      unitPriceKgs: Number(nextLine.unitPriceKgs),
      lineTotalKgs: Number(nextLine.lineTotalKgs),
      unitCostKgs: nextLine.unitCostKgs ? Number(nextLine.unitCostKgs) : null,
      lineCostTotalKgs: nextLine.lineCostTotalKgs ? Number(nextLine.lineCostTotalKgs) : null,
    };
  });
};

export const removeCustomerOrderLine = async (input: {
  organizationId: string;
  lineId: string;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const line = await tx.customerOrderLine.findUnique({
      where: { id: input.lineId },
      include: { customerOrder: true },
    });
    if (!line) {
      throw new AppError("salesOrderLineNotFound", "NOT_FOUND", 404);
    }
    if (line.customerOrder.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }

    assertEditable(line.customerOrder.status);

    await tx.customerOrderLine.delete({ where: { id: line.id } });
    await recomputeTotals(tx, line.customerOrderId, input.actorId);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SALES_ORDER_LINE_REMOVE",
      entity: "CustomerOrder",
      entityId: line.customerOrderId,
      before: toJson(line),
      after: null,
      requestId: input.requestId,
    });

    return { customerOrderId: line.customerOrderId };
  });
};

const updateOrderStatus = async (input: {
  customerOrderId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  to: CustomerOrderStatus;
}) => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findUnique({
      where: { id: input.customerOrderId },
      include: { lines: { select: { id: true } } },
    });
    if (!order) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }
    if (order.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }

    assertTransition(order.status, input.to);

    if (input.to !== CustomerOrderStatus.CANCELED && !order.lines.length) {
      throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
    }

    const updated = await tx.customerOrder.update({
      where: { id: order.id },
      data: {
        status: input.to,
        updatedById: input.actorId,
        confirmedAt: input.to === CustomerOrderStatus.CONFIRMED ? new Date() : order.confirmedAt,
        readyAt: input.to === CustomerOrderStatus.READY ? new Date() : order.readyAt,
        canceledAt: input.to === CustomerOrderStatus.CANCELED ? new Date() : order.canceledAt,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SALES_ORDER_STATUS_UPDATE",
      entity: "CustomerOrder",
      entityId: order.id,
      before: toJson({ status: order.status }),
      after: toJson({ status: updated.status }),
      requestId: input.requestId,
    });

    return serializeOrder(updated);
  });
};

export const confirmCustomerOrder = (input: {
  customerOrderId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
}) =>
  updateOrderStatus({
    ...input,
    to: CustomerOrderStatus.CONFIRMED,
  });

export const markCustomerOrderReady = (input: {
  customerOrderId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
}) =>
  updateOrderStatus({
    ...input,
    to: CustomerOrderStatus.READY,
  });

export const cancelCustomerOrder = (input: {
  customerOrderId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
}) =>
  updateOrderStatus({
    ...input,
    to: CustomerOrderStatus.CANCELED,
  });

export const completeCustomerOrder = async (input: {
  customerOrderId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
}) => {
  const logger = getLogger(input.requestId);

  const result = await prisma.$transaction(async (tx) => {
    const { result: completion } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "salesOrders.complete",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT id FROM "CustomerOrder" WHERE id = ${input.customerOrderId} FOR UPDATE
        `;

        const order = await tx.customerOrder.findUnique({
          where: { id: input.customerOrderId },
          include: {
            store: true,
            lines: true,
          },
        });
        if (!order) {
          throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
        }
        if (order.organizationId !== input.organizationId) {
          throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
        }
        if (order.status === CustomerOrderStatus.COMPLETED) {
          return {
            id: order.id,
            number: order.number,
            status: order.status,
            storeId: order.storeId,
            productIds: order.lines.map((line) => line.productId),
          };
        }

        assertTransition(order.status, CustomerOrderStatus.COMPLETED);
        if (!order.lines.length) {
          throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
        }

        for (const line of order.lines) {
          await applyStockMovement(tx, {
            storeId: order.storeId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: -line.qty,
            type: StockMovementType.SALE,
            referenceType: "CustomerOrder",
            referenceId: order.id,
            note: order.number,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });
        }

        const updated = await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            status: CustomerOrderStatus.COMPLETED,
            completedAt: new Date(),
            completedEventId: input.idempotencyKey,
            updatedById: input.actorId,
          },
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "SALES_ORDER_COMPLETE",
          entity: "CustomerOrder",
          entityId: order.id,
          before: toJson({ status: order.status }),
          after: toJson({ status: updated.status }),
          requestId: input.requestId,
        });

        return {
          id: updated.id,
          number: updated.number,
          status: updated.status,
          storeId: updated.storeId,
          productIds: order.lines.map((line) => line.productId),
        };
      },
    );

    return completion;
  });

  const productIds = Array.from(new Set(result.productIds));
  for (const productId of productIds) {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: result.storeId, productId, variantId: null },
    });
  }

  logger.info({ customerOrderId: result.id, number: result.number }, "customer order completed");

  return result;
};
