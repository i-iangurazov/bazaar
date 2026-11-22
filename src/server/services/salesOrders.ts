import { assertProductQuantity } from "./productQuantity";
import { createHash } from "node:crypto";
import { roundQuantity } from "@/lib/quantity";
import { releaseLoyaltyForOrder } from "@/server/services/loyalty/apply";
import { assertSaleAssortment, lockAssortmentForSale } from "./assortmentPolicy";
import { assertBaamReviewedVersion } from "@/server/services/baamExecutionContext";
import {
  CatalogDiscountType,
  Prisma,
  CustomerOrderEmailType,
  CustomerOrderSource,
  CustomerOrderStatus,
  EmailAutomationTrigger,
  OperationRequestPrincipalType,
  type PosPaymentMethod,
  SalePaymentSettlement,
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
import { resolveCurrencySnapshot } from "@/lib/currencyDisplay";
import { addBusinessDays, businessDateKey } from "@/lib/timezone";
import type { SalesOrderLifecycleView } from "@/lib/salesOrderLifecycle";
import { upsertCustomerFromOrderTx } from "@/server/services/customers";
import { processEmailAutomationTrigger } from "@/server/services/emailMarketing";
import { confirmLoyaltyForOrder } from "@/server/services/loyalty/apply";
import { getEffectiveProductPrice } from "@/server/services/effectiveProductPrice";
import {
  resolveStrictStoreSellingPrice,
  type StorePriceMode,
} from "@/server/services/storeSellingPrice";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  type StoreAccessUser,
} from "@/server/services/storeAccess";
import { classifyDatabaseOperationFailure } from "@/server/services/databaseOperationFailure";
import {
  normalizeOptionalCustomerAddress,
  normalizeOptionalCustomerPhone,
  normalizeUpdatedCustomerAddress,
  normalizeUpdatedCustomerPhone,
} from "@/server/services/customerContact";
import {
  OPERATION_FAILURE_SAFE_BEFORE_EFFECTS,
  runOperationRequest,
  type OperationFailureDecision,
} from "@/server/services/operationRequests";
import {
  sendOrderConfirmationEmail,
  sendOrderCancellationEmail,
  sendOrderTrackingEmail,
  type OrderEmailSendResult,
} from "@/server/services/orderEmails";

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
const toMoneyOrNull = (value: Prisma.Decimal | number | null | undefined) =>
  value === null || value === undefined ? null : Number(value);
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const normalizeOptionalText = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const MAX_ORDER_MONEY_KGS = 9_999_999_999.99;
// A correction can reverse and repost dozens of real stock movements. Keep the
// transaction bounded without applying a different timeout to established flows.
const FAST_SALE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

// Ordinary order editing uses the same roles as POS price editing. Read current
// membership inside the transaction so revoked store access cannot be reused.
const assertOrderActorStoreAccessTx = async (
  tx: Prisma.TransactionClient,
  input: { organizationId: string; actorId: string; storeId: string },
): Promise<StoreAccessUser> => {
  const actor = await tx.user.findFirst({
    where: { id: input.actorId, organizationId: input.organizationId, isActive: true },
    select: { id: true, organizationId: true, role: true, isOrgOwner: true },
  });
  if (!actor?.organizationId) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  const user = { ...actor, organizationId: actor.organizationId };
  await assertUserCanAccessStore(tx, user, input.storeId);
  return user;
};

const assertSalesManagerStoreAccessTx = async (
  tx: Prisma.TransactionClient,
  input: { organizationId: string; actorId: string; storeId: string },
) => {
  const actor = await assertOrderActorStoreAccessTx(tx, input);
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") {
    throw new AppError("forbidden", "FORBIDDEN", 403);
  }
  return actor;
};

const normalizeOrderUnitPrice = (value: number) => {
  if (!Number.isFinite(value) || value < 0 || value > MAX_ORDER_MONEY_KGS) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
};

export const orderLineTotal = (unitPriceKgs: number, qty: number) => {
  const total = new Prisma.Decimal(unitPriceKgs)
    .mul(qty)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
  if (!Number.isFinite(total) || total < 0 || total > MAX_ORDER_MONEY_KGS) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return total;
};

const manualOrderPriceData = (unitPriceKgs: number) => ({
  manualPrice: true,
  priceSource: "MANUAL",
  baseUnitPriceKgs: unitPriceKgs,
  appliedDiscountType: null,
  appliedDiscountPercentage: null,
  appliedDiscountAmountKgs: null,
});

const selectedOrderCustomerTx = async (
  tx: Prisma.TransactionClient,
  user: StoreAccessUser,
  customerId: string,
) => {
  const storeIds = await resolveAccessibleStoreIds(tx, user);
  const customer = await tx.customer.findFirst({
    where: {
      id: customerId,
      organizationId: user.organizationId,
      storeId: { in: storeIds },
      deletedAt: null,
    },
    select: { id: true, name: true, email: true, phone: true, address: true },
  });
  if (!customer) throw new AppError("customerNotFound", "NOT_FOUND", 404);
  return customer;
};

export const listCustomerOrderCustomerOptions = async (input: {
  organizationId: string;
  actorId: string;
  storeId: string;
  search?: string;
  limit?: number;
}) =>
  prisma.$transaction(async (tx) => {
    const user = await assertOrderActorStoreAccessTx(tx, input);
    const storeIds = await resolveAccessibleStoreIds(tx, user);
    const search = input.search?.trim();
    return tx.customer.findMany({
      where: {
        organizationId: input.organizationId,
        storeId: { in: storeIds },
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
                { phone: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true, phone: true, address: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: Math.min(30, Math.max(1, Math.trunc(input.limit ?? 25))),
    });
  });

const restoreCustomerOrderStockOnCancel = async (
  tx: Prisma.TransactionClient,
  input: {
    order: { id: string; number: string; storeId: string };
    organizationId: string;
    actorId: string;
  },
) => {
  const existingRestoreMovement = await tx.stockMovement.findFirst({
    where: {
      referenceType: "CustomerOrder",
      referenceId: input.order.id,
      type: StockMovementType.RETURN,
    },
    select: { id: true },
  });
  if (existingRestoreMovement) {
    return 0;
  }

  const saleMovements = await tx.stockMovement.findMany({
    where: {
      referenceType: "CustomerOrder",
      referenceId: input.order.id,
      type: StockMovementType.SALE,
    },
    orderBy: [{ linePosition: "asc" }, { createdAt: "asc" }],
  });

  for (const movement of saleMovements) {
    await applyStockMovement(tx, {
      storeId: input.order.storeId,
      productId: movement.productId,
      variantId: movement.variantId,
      // Edits can add positive SALE corrections; reverse the signed journal,
      // not only its original negative entries.
      qtyDelta: -movement.qtyDelta,
      stockLotId: movement.stockLotId,
      allowNegativeStock: true,
      type: StockMovementType.RETURN,
      referenceType: "CustomerOrder",
      referenceId: input.order.id,
      linePosition: movement.linePosition,
      unitCostKgs: movement.unitCostKgs === null ? null : toMoney(movement.unitCostKgs),
      lineTotalKgs: toMoney(movement.lineTotalKgs),
      note: `Cancellation ${input.order.number}`,
      actorId: input.actorId,
      organizationId: input.organizationId,
    });
  }

  return saleMovements.length;
};

const syncAlreadyDeductedOrderStock = async (
  tx: Prisma.TransactionClient,
  order: { id: string; source: CustomerOrderSource; storeId: string; organizationId: string },
  actorId: string,
) => {
  if (order.source !== CustomerOrderSource.API) return;
  const movements = await tx.stockMovement.groupBy({
    by: ["productId", "variantId"],
    where: { referenceType: "CustomerOrder", referenceId: order.id, type: StockMovementType.SALE },
    _sum: { qtyDelta: true },
  });
  if (!movements.length) return; // Ordinary drafts have not touched inventory.
  const lines = await tx.customerOrderLine.findMany({ where: { customerOrderId: order.id } });
  const deltas = new Map(movements.map((movement) => [
    `${movement.productId}:${movement.variantId ?? "BASE"}`,
    { productId: movement.productId, variantId: movement.variantId, qtyDelta: -(movement._sum.qtyDelta ?? 0) },
  ]));
  for (const line of lines) {
    const key = `${line.productId}:${line.variantId ?? "BASE"}`;
    const delta = deltas.get(key) ?? { productId: line.productId, variantId: line.variantId, qtyDelta: 0 };
    delta.qtyDelta = roundQuantity(delta.qtyDelta - line.qty);
    deltas.set(key, delta);
  }
  for (const delta of [...deltas.values()].sort((a,b) => a.productId.localeCompare(b.productId))) {
    if (!delta.qtyDelta) continue;
    await applyStockMovement(tx, { ...delta, storeId: order.storeId, organizationId: order.organizationId,
      actorId, type: StockMovementType.SALE, referenceType: "CustomerOrder", referenceId: order.id,
      note: "Order line correction", allowNegativeStock: true });
  }
};

export const nextSalesOrderNumber = async (
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

export const recomputeTotals = async (
  tx: Prisma.TransactionClient,
  customerOrderId: string,
  updatedById: string,
) => {
  const aggregate = await tx.customerOrderLine.aggregate({
    where: { customerOrderId },
    _sum: { lineTotalKgs: true },
  });
  const subtotal = toMoney(aggregate._sum.lineTotalKgs);
  if (!Number.isFinite(subtotal) || subtotal < 0 || subtotal > MAX_ORDER_MONEY_KGS) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  return tx.customerOrder.update({
    where: { id: customerOrderId },
    data: {
      subtotalKgs: subtotal,
      totalKgs: subtotal,
      updatedById,
    },
  });
};

export const normalizeOrderPriceMode = (value?: string | null): StorePriceMode =>
  value === "WHOLESALE" ? "WHOLESALE" : "RETAIL";

const getRetailWholesaleEnabled = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
) =>
  (
    await tx.organization.findUnique({
      where: { id: organizationId },
      select: { retailWholesaleEnabled: true },
    })
  )?.retailWholesaleEnabled ?? false;

export const resolveUnitPrice = async (input: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  storeId: string;
  productId: string;
  variantId?: string | null;
  priceMode?: StorePriceMode | null;
  retailWholesaleEnabled?: boolean;
}) => {
  const { tx, organizationId, storeId, productId, variantId } = input;
  const product = await tx.product.findFirst({
    where: {
      id: productId,
      organizationId,
      isDeleted: false,
      storeProducts: {
        some: {
          organizationId,
          storeId,
          isActive: true,
        },
      },
    },
    select: { id: true, basePriceKgs: true, isBundle: true },
  });
  if (!product) {
    throw new AppError("productNotFound", "NOT_FOUND", 404);
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
  const [override, priceModes, enabled] = await Promise.all([
    tx.storePrice.findUnique({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId,
          storeId,
          productId,
          variantKey,
        },
      },
      select: {
        priceKgs: true,
        discountType: true,
        discountPercentage: true,
        discountStartsAt: true,
        discountEndsAt: true,
      },
    }),
    tx.storePriceTypes.findUnique({
      where: {
        organizationId_storeId_productId_variantKey: {
          organizationId,
          storeId,
          productId,
          variantKey,
        },
      },
      select: { retailPriceKgs: true, wholesalePriceKgs: true },
    }),
    input.retailWholesaleEnabled === undefined
      ? getRetailWholesaleEnabled(tx, organizationId)
      : Promise.resolve(input.retailWholesaleEnabled),
  ]);

  const priceMode = enabled ? normalizeOrderPriceMode(input.priceMode) : "RETAIL";
  const selected = resolveStrictStoreSellingPrice<Prisma.Decimal>({
    enabled,
    mode: priceMode,
    standard: override?.priceKgs ?? product.basePriceKgs ?? null,
    retail: priceModes?.retailPriceKgs ?? null,
    wholesale: priceModes?.wholesalePriceKgs ?? null,
  });

  const effective = getEffectiveProductPrice({
    basePrice: selected.price ?? 0,
    discount:
      override?.discountType === CatalogDiscountType.PERCENTAGE && override.discountPercentage
        ? {
            type: "PERCENTAGE",
            percentage: override.discountPercentage,
            startsAt: override.discountStartsAt,
            endsAt: override.discountEndsAt,
          }
        : null,
    now: new Date(),
    currency: "KGS",
  });
  const baseUnitPriceKgs = effective.basePrice.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const unitPriceKgs = effective.effectivePrice;

  return {
    variantKey,
    hasConfiguredPrice: selected.hasPrice,
    priceMode,
    priceSource: selected.source,
    baseUnitPriceKgs,
    appliedDiscountType: effective.hasActiveDiscount ? CatalogDiscountType.PERCENTAGE : null,
    appliedDiscountPercentage: effective.hasActiveDiscount ? effective.discountPercentage : null,
    appliedDiscountAmountKgs: effective.hasActiveDiscount
      ? baseUnitPriceKgs.minus(unitPriceKgs).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : null,
    unitPrice: unitPriceKgs.toNumber(),
    isBundle: product.isBundle,
  };
};

export const getCustomerOrderLinePrice = async (input: {
  organizationId: string;
  actorId: string;
  storeId: string;
  productId: string;
  variantId?: string | null;
  priceMode?: StorePriceMode | null;
}) =>
  prisma.$transaction(async (tx) => {
    await assertOrderActorStoreAccessTx(tx, input);
    const resolved = await resolveUnitPrice({ ...input, tx });
    return {
      unitPriceKgs: resolved.unitPrice,
      hasConfiguredPrice: resolved.hasConfiguredPrice,
      priceSource: resolved.priceSource,
      priceMode: resolved.priceMode,
    };
  });

export const resolveUnitCost = async (input: {
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
  storeIds?: string[];
  status?: CustomerOrderStatus;
  search?: string;
  employeeId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
  sortBy?: "createdAt" | "number" | "totalKgs" | "customerName";
  sortDirection?: "asc" | "desc";
  lifecycleView?: SalesOrderLifecycleView;
  archiveFilter?: "VISIBLE" | "ARCHIVED" | "ALL";
}) => {
  const lifecycleWhere: Prisma.CustomerOrderWhereInput =
    input.lifecycleView === "ACTIVE"
      ? {
          status: { not: CustomerOrderStatus.CANCELED },
          trackingAddedAt: null,
        }
      : input.lifecycleView === "HISTORY"
        ? {
            OR: [{ status: CustomerOrderStatus.CANCELED }, { trackingAddedAt: { not: null } }],
          }
        : {};
  const where: Prisma.CustomerOrderWhereInput = {
    organizationId: input.organizationId,
    isPosSale: false,
    ...(input.archiveFilter === "ALL" ? {} : { archivedAt: input.archiveFilter === "ARCHIVED" ? { not: null } : null }),
    ...(input.storeId
      ? { storeId: input.storeId }
      : input.storeIds
        ? { storeId: { in: input.storeIds.length ? input.storeIds : ["__no_accessible_store__"] } }
        : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.employeeId ? { createdById: input.employeeId } : {}),
    ...(input.lifecycleView && input.lifecycleView !== "ALL" ? { AND: [lifecycleWhere] } : {}),
    ...(input.search
      ? {
          OR: [
            { number: { contains: input.search, mode: "insensitive" } },
            { customerName: { contains: input.search, mode: "insensitive" } },
            { customerEmail: { contains: input.search, mode: "insensitive" } },
            { customerPhone: { contains: input.search, mode: "insensitive" } },
            { customerAddress: { contains: input.search, mode: "insensitive" } },
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

  const sortDirection = input.sortDirection ?? "desc";
  const orderBy: Prisma.CustomerOrderOrderByWithRelationInput[] = [
    input.sortBy === "number"
      ? { number: sortDirection }
      : input.sortBy === "totalKgs"
        ? { totalKgs: sortDirection }
        : input.sortBy === "customerName"
          ? { customerName: sortDirection }
          : { createdAt: sortDirection },
    { id: sortDirection },
  ];

  const [total, items] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      include: {
        store: {
          select: {
            id: true,
            name: true,
            code: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
        createdBy: { select: { id: true, name: true, email: true, role: true, isActive: true } },
        completedBy: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      },
      orderBy,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  // Receipts identify the payment method; offsets, pending settlements and refunds do not.
  const paymentTotals = items.length
    ? await prisma.salePayment.groupBy({
        by: ["customerOrderId", "method"],
        where: {
          organizationId: input.organizationId,
          customerOrderId: { in: items.map(({ id }) => id) },
          isRefund: false,
          settlementStatus: SalePaymentSettlement.ACTUAL,
          amountKgs: { gt: 0 },
        },
        _sum: { amountKgs: true },
        orderBy: { method: "asc" },
      })
    : [];
  const paymentsByOrder = new Map<string, Array<{ method: PosPaymentMethod; amountKgs: number }>>();
  for (const payment of paymentTotals) {
    const entry = { method: payment.method, amountKgs: Number(payment._sum.amountKgs) };
    const payments = paymentsByOrder.get(payment.customerOrderId);
    if (payments) {
      payments.push(entry);
    } else {
      paymentsByOrder.set(payment.customerOrderId, [entry]);
    }
  }

  return {
    items: items.map((order) => ({
      ...serializeOrder(order),
      receivedPayments: paymentsByOrder.get(order.id) ?? [],
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const listSalesOrderEmployeeOptions = async (input: {
  organizationId: string;
  actorId: string;
  storeId?: string;
  storeIds?: string[];
}) =>
  prisma.$transaction(async (tx) => {
    const actor = await tx.user.findFirst({
      where: { id: input.actorId, organizationId: input.organizationId, isActive: true },
      select: { id: true, organizationId: true, role: true, isOrgOwner: true },
    });
    if (!actor?.organizationId) throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
    const accessible = await resolveAccessibleStoreIds(tx, actor as StoreAccessUser);
    const requested = input.storeId ? [input.storeId] : input.storeIds;
    const scope = requested?.length
      ? requested.filter((storeId) => accessible.includes(storeId))
      : accessible;
    if (!scope.length) return [];
    return tx.user.findMany({
      where: {
        organizationId: input.organizationId,
        OR: [
          { role: { in: ["ADMIN", "MANAGER"] } },
          { isOrgOwner: true },
          { storeAccesses: { some: { storeId: { in: scope } } } },
          {
            customerOrdersCreated: {
              some: { organizationId: input.organizationId, storeId: { in: scope } },
            },
          },
          {
            customerOrdersCompleted: {
              some: { organizationId: input.organizationId, storeId: { in: scope } },
            },
          },
        ],
      },
      select: { id: true, name: true, email: true, role: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
      take: 200,
    });
  });

export const getCustomerOrder = async (input: {
  organizationId: string;
  customerOrderId: string;
}) => {
  const order = await prisma.customerOrder.findFirst({
    where: {
      id: input.customerOrderId,
      organizationId: input.organizationId,
      isPosSale: false,
    },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          code: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
        },
      },
      createdBy: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      completedBy: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      corrections: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          reason: true,
          returnedKgs: true,
          addedKgs: true,
          offsetKgs: true,
          refundKgs: true,
          chargeKgs: true,
          restock: true,
          paymentMethod: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
          saleReturn: {
            select: {
              id: true,
              number: true,
              refundRequests: {
                select: {
                  id: true,
                  status: true,
                  paymentMethod: true,
                  amountKgs: true,
                  createdAt: true,
                  reviewedAt: true,
                  reviewedBy: { select: { id: true, name: true } },
                  shiftId: true,
                  payment: {
                    select: {
                      id: true,
                      settlementStatus: true,
                      amountKgs: true,
                      shiftId: true,
                    },
                  },
                },
              },
            },
          },
          additionOrder: { select: { id: true, number: true } },
        },
      },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              photoUrl: true,
              images: {
                where: {
                  AND: [{ url: { not: "" } }, { NOT: { url: { startsWith: "data:image/" } } }],
                },
                select: { url: true },
                orderBy: { position: "asc" },
                take: 1,
              },
              isBundle: true,
              baseUnit: { select: { code: true, labelRu: true, labelKg: true } },
            },
          },
          variant: { select: { id: true, name: true } },
          saleReturnLines: {
            where: { saleReturn: { status: "COMPLETED" } },
            select: { qty: true, lineTotalKgs: true, restock: true },
          },
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
  // The store calendar is the Bishkek business day, not the UTC date of the
  // timestamp. A 00:30 Bishkek sale therefore belongs to the local day even
  // though its ISO date is still the previous UTC day.
  const dayKey = businessDateKey(value);
  if (groupBy === "day") return dayKey;
  const weekday = new Date(`${dayKey}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return addBusinessDays(dayKey, -daysSinceMonday);
};

export const getSalesOrderMetrics = async (input: {
  organizationId: string;
  storeId?: string;
  storeIds?: string[];
  employeeId?: string;
  dateFrom: Date;
  dateTo: Date;
  groupBy: "day" | "week";
}) => {
  const orders = await prisma.customerOrder.findMany({
    where: {
      organizationId: input.organizationId,
      isPosSale: false,
      status: CustomerOrderStatus.COMPLETED,
      ...(input.employeeId ? { createdById: input.employeeId } : {}),
      ...(input.storeId
        ? { storeId: input.storeId }
        : input.storeIds
          ? {
              storeId: { in: input.storeIds.length ? input.storeIds : ["__no_accessible_store__"] },
            }
          : {}),
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
      top.qty = roundQuantity(top.qty + line.qty);
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

export type CreateCustomerOrderDraftInput = {
  organizationId: string;
  storeId: string;
  priceMode?: StorePriceMode | null;
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  lines?: Array<{
    productId: string;
    variantId?: string | null;
    qty: number;
    unitPriceKgs?: number;
  }>;
  actorId: string;
  requestId: string;
};

const createCustomerOrderDraftTx = async (
  tx: Prisma.TransactionClient,
  input: CreateCustomerOrderDraftInput,
) => {
  const actor = await assertOrderActorStoreAccessTx(tx, input);
  const customer = input.customerId
    ? await selectedOrderCustomerTx(tx, actor, input.customerId)
    : null;
  const customerName = input.customerName === undefined ? customer?.name ?? null : input.customerName;
  const customerEmail = input.customerEmail === undefined ? customer?.email ?? null : input.customerEmail;
  const customerPhone = customer
    ? normalizeUpdatedCustomerPhone(
        input.customerPhone === undefined ? customer.phone : input.customerPhone,
        customer.phone,
      )
    : normalizeOptionalCustomerPhone(input.customerPhone);
  const customerAddress = customer
    ? normalizeUpdatedCustomerAddress(
        input.customerAddress === undefined ? customer.address : input.customerAddress,
        customer.address,
      )
    : normalizeOptionalCustomerAddress(input.customerAddress);

  const store = await tx.store.findUnique({ where: { id: input.storeId } });
  if (!store) {
    throw new AppError("storeNotFound", "NOT_FOUND", 404);
  }
  if (store.organizationId !== input.organizationId) {
    throw new AppError("storeOrgMismatch", "FORBIDDEN", 403);
  }

  const number = await nextSalesOrderNumber(tx, input.organizationId);
  const retailWholesaleEnabled = await getRetailWholesaleEnabled(tx, input.organizationId);
  const priceMode = retailWholesaleEnabled ? normalizeOrderPriceMode(input.priceMode) : "RETAIL";

  let order = await tx.customerOrder.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      number,
      source: CustomerOrderSource.MANUAL,
      priceMode,
      customerId: customer?.id ?? null,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      notes: input.notes ?? null,
      ...resolveCurrencySnapshot(store),
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  if (input.customerId === undefined) {
    await upsertCustomerFromOrderTx(tx, {
      orderId: order.id,
      organizationId: input.organizationId,
      storeId: input.storeId,
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
    });
  } else if (customer) {
    await tx.customer.update({
      where: { id: customer.id },
      data: { orderCount: { increment: 1 }, lastOrderAt: order.createdAt },
    });
  }

  if (input.lines?.length) {
    const existingKeys = new Set<string>();

    for (const lineInput of input.lines) {
      await assertProductQuantity(tx, input.organizationId, lineInput.productId, lineInput.qty);
      const resolved = await resolveUnitPrice({
        tx,
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: lineInput.productId,
        variantId: lineInput.variantId ?? null,
        priceMode,
        retailWholesaleEnabled,
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

      const unitPrice = lineInput.unitPriceKgs === undefined
        ? resolved.unitPrice
        : normalizeOrderUnitPrice(lineInput.unitPriceKgs);
      const lineTotal = orderLineTotal(unitPrice, lineInput.qty);
      const lineCostTotal = unitCost === null ? null : roundMoney(unitCost * lineInput.qty);
      await tx.customerOrderLine.create({
        data: {
          customerOrderId: order.id,
          productId: lineInput.productId,
          variantId: lineInput.variantId ?? null,
          variantKey: resolved.variantKey,
          qty: lineInput.qty,
          ...(lineInput.unitPriceKgs === undefined
            ? {
                priceSource: resolved.priceSource,
                baseUnitPriceKgs: resolved.baseUnitPriceKgs,
                appliedDiscountType: resolved.appliedDiscountType,
                appliedDiscountPercentage: resolved.appliedDiscountPercentage,
                appliedDiscountAmountKgs: resolved.appliedDiscountAmountKgs,
              }
            : manualOrderPriceData(unitPrice)),
          unitPriceKgs: unitPrice,
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
};

type CustomerOrderDraftResult = Awaited<ReturnType<typeof createCustomerOrderDraftTx>>;

const dispatchCustomerOrderDraftCreated = (result: CustomerOrderDraftResult) => {
  eventBus.publish({
    type: "customerOrder.created",
    payload: {
      customerOrderId: result.id,
      storeId: result.storeId,
      source: CustomerOrderSource.MANUAL,
    },
  });
};

export const createCustomerOrderDraft = async (input: CreateCustomerOrderDraftInput) => {
  const result = await prisma.$transaction((tx) => createCustomerOrderDraftTx(tx, input));
  dispatchCustomerOrderDraftCreated(result);
  return result;
};

type CustomerOrderDraftOperationResponse = Prisma.InputJsonObject & {
  order: {
    id: string;
    number: string;
    storeId: string;
    status: CustomerOrderStatus;
  };
};

const classifyCustomerOrderDraftOperationFailure = (error: unknown): OperationFailureDecision => {
  if (error instanceof AppError) {
    return {
      classification: OPERATION_FAILURE_SAFE_BEFORE_EFFECTS,
      responseCode: error.message,
      responseStatus: error.status,
    };
  }
  return classifyDatabaseOperationFailure(error, "operationRequestFailed");
};

const createCustomerOrderOperation = async (
  input: CreateCustomerOrderDraftInput & { idempotencyKey: string },
  immediate: boolean,
) => {
  // Completed operation replays must also use current membership, rather than
  // trusting the role saved in a browser session or an old operation result.
  if (immediate) {
    await prisma.$transaction((tx) => assertSalesManagerStoreAccessTx(tx, input), FAST_SALE_TRANSACTION_OPTIONS);
  }
  let createdResult: CustomerOrderDraftResult | null = null;
  let completion: CustomerOrderCompletion | null = null;
  const operation = await runOperationRequest<CustomerOrderDraftOperationResponse>(
    {
      organizationId: input.organizationId,
      storeId: input.storeId,
      scope: immediate ? "salesOrders.createSale.v1" : "salesOrders.createDraft.v1",
      ...(immediate ? { transactionOptions: FAST_SALE_TRANSACTION_OPTIONS } : {}),
      principal: {
        type: OperationRequestPrincipalType.AUTHENTICATED_USER,
        id: input.actorId,
      },
      idempotencyKey: input.idempotencyKey,
      payload: {
        version: "v1",
        value: {
          // Preserve legacy request fingerprints. For an explicit selection,
          // omitted contacts use the saved profile; null explicitly clears them.
          ...(input.customerId === undefined
            ? {
                customerName: input.customerName ?? null,
                customerEmail: input.customerEmail ?? null,
                customerPhone: input.customerPhone ?? null,
                customerAddress: input.customerAddress ?? null,
              }
            : {
                customerId: input.customerId,
                ...(input.customerName === undefined ? {} : { customerName: input.customerName }),
                ...(input.customerEmail === undefined ? {} : { customerEmail: input.customerEmail }),
                ...(input.customerPhone === undefined ? {} : { customerPhone: input.customerPhone }),
                ...(input.customerAddress === undefined ? {} : { customerAddress: input.customerAddress }),
              }),
          notes: input.notes ?? null,
          priceMode: normalizeOrderPriceMode(input.priceMode),
          lines: (input.lines ?? []).map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? null,
            qty: line.qty,
            ...(line.unitPriceKgs === undefined ? {} : { unitPriceKgs: line.unitPriceKgs }),
          })),
        },
      },
      allowedResponsePaths: ["order", "order.id", "order.number", "order.storeId", "order.status"],
      classifyFailure: classifyCustomerOrderDraftOperationFailure,
    },
    async (tx) => {
      if (immediate) {
        await lockAssortmentForSale(tx, input.organizationId);
        await assertSalesManagerStoreAccessTx(tx, input);
        for (const line of input.lines ?? []) {
          if (line.unitPriceKgs !== undefined) continue;
          const price = await resolveUnitPrice({
            tx, organizationId: input.organizationId, storeId: input.storeId,
            productId: line.productId, variantId: line.variantId,
            priceMode: normalizeOrderPriceMode(input.priceMode),
          });
          if (!price.hasConfiguredPrice) {
            throw new AppError("salesOrderPriceRequired", "BAD_REQUEST", 400);
          }
        }
      }
      let result = await createCustomerOrderDraftTx(tx, input);
      if (immediate) {
        completion = await completeCustomerOrderTx(tx, {
          ...input,
          customerOrderId: result.id,
          allowImmediate: true,
          completionEventKey: `salesOrders.createSale:${input.organizationId}:${input.actorId}:${input.idempotencyKey}`,
        });
        result = serializeOrder(await tx.customerOrder.findUniqueOrThrow({ where: { id: result.id } }));
      }
      createdResult = result;
      return {
        response: {
          order: {
            id: result.id,
            number: result.number,
            storeId: result.storeId,
            status: result.status,
          },
        },
        responseStatus: 200,
        responseCode: "created",
        resource: { type: "CustomerOrder", id: result.id },
      };
    },
  );

  if (createdResult) {
    dispatchCustomerOrderDraftCreated(createdResult);
  }
  if (completion) publishCustomerOrderCompletion(completion);
  return operation;
};

export const createCustomerOrderDraftOperation = (
  input: CreateCustomerOrderDraftInput & { idempotencyKey: string },
) => createCustomerOrderOperation(input, false);

export const createCustomerSaleOperation = (
  input: CreateCustomerOrderDraftInput & { idempotencyKey: string },
) => createCustomerOrderOperation(input, true);

export const setCustomerOrderCustomer = async (input: {
  organizationId: string;
  customerOrderId: string;
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    await assertBaamReviewedVersion(tx, "CustomerOrder", input.customerOrderId);
    await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${input.customerOrderId} FOR UPDATE`;
    const order = await tx.customerOrder.findUnique({ where: { id: input.customerOrderId } });
    if (!order) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }
    if (order.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }
    if (order.isPosSale) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }

    assertEditable(order.status);

    const actor = await assertOrderActorStoreAccessTx(tx, { ...input, storeId: order.storeId });
    const customer = input.customerId
      ? await selectedOrderCustomerTx(tx, actor, input.customerId)
      : null;
    const sameSelectedCustomer = Boolean(customer && customer.id === order.customerId);
    const savedPhone = sameSelectedCustomer
      ? order.customerPhone
      : customer ? customer.phone : order.customerPhone;
    const savedAddress = sameSelectedCustomer
      ? order.customerAddress
      : customer ? customer.address : order.customerAddress;
    // Re-selecting the same customer can copy their current profile into an
    // older order. Both persisted contacts are trusted; new invalid text is not.
    const phoneBaseline = sameSelectedCustomer && customer && input.customerPhone === customer.phone
      ? customer.phone
      : savedPhone;
    const addressBaseline = sameSelectedCustomer && customer && input.customerAddress === customer.address
      ? customer.address
      : savedAddress;

    const customerPhone = normalizeUpdatedCustomerPhone(
      input.customerPhone === undefined && customer ? savedPhone : input.customerPhone,
      phoneBaseline,
    );
    const customerAddress = normalizeUpdatedCustomerAddress(
      input.customerAddress === undefined && customer ? savedAddress : input.customerAddress,
      addressBaseline,
    );

    const updated = await tx.customerOrder.update({
      where: { id: order.id },
      data: {
        ...(input.customerId === undefined ? {} : { customerId: customer?.id ?? null }),
        customerName: input.customerName === undefined ? customer?.name ?? null : input.customerName,
        customerEmail: input.customerEmail === undefined ? customer?.email ?? null : input.customerEmail,
        customerPhone,
        customerAddress,
        notes: input.notes ?? null,
        updatedById: input.actorId,
      },
    });

    if (input.customerId === undefined) await upsertCustomerFromOrderTx(tx, {
      orderId: updated.id,
      replaceCustomerIdentity: true,
      organizationId: input.organizationId,
      storeId: updated.storeId,
      customerName: updated.customerName,
      customerEmail: updated.customerEmail,
      customerPhone: updated.customerPhone,
      customerAddress: updated.customerAddress,
      orderedAt: updated.updatedAt,
      countOrder: false,
      allowLegacyContact: true,
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

export const quoteCustomerOrderPriceMode = async (input: {
  organizationId: string;
  actorId: string;
  storeId: string;
  priceMode: StorePriceMode;
  lines: Array<{ productId: string; variantId?: string | null }>;
}) =>
  prisma.$transaction(async (tx) => {
    await assertOrderActorStoreAccessTx(tx, input);
    const enabled = await getRetailWholesaleEnabled(tx, input.organizationId);
    if (!enabled) throw new AppError("priceTypesDisabled", "FORBIDDEN", 403);
    const items = [];
    for (const line of input.lines) {
      const resolved = await resolveUnitPrice({
        tx,
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        priceMode: input.priceMode,
        retailWholesaleEnabled: true,
      });
      items.push({
        productId: line.productId,
        variantId: line.variantId ?? null,
        unitPriceKgs: resolved.unitPrice,
        hasConfiguredPrice: resolved.hasConfiguredPrice,
        priceSource: resolved.priceSource,
        baseUnitPriceKgs: Number(resolved.baseUnitPriceKgs),
      });
    }
    return { priceMode: input.priceMode, items };
  });

export type UpdateCustomerOrderLineInput = {
  lineId?: string | null;
  productId: string;
  variantId?: string | null;
  qty: number;
  unitPriceKgs?: number;
  priceSource?: "RETAIL" | "WHOLESALE" | "MANUAL";
};

/**
 * Updates the same saved document in place. Existing line ids and price
 * snapshots are preserved unless the caller explicitly repriced a line.
 */
export const updateCustomerOrder = async (input: {
  organizationId: string;
  customerOrderId: string;
  expectedUpdatedAt: string;
  storeId: string;
  priceMode?: StorePriceMode | null;
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  lines: UpdateCustomerOrderLineInput[];
  actorId: string;
  requestId: string;
  idempotencyKey: string;
}) => {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const operation = await prisma.$transaction(async (tx) => {
    return withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "salesOrders.update.v1",
        userId: input.actorId,
        request: {
          customerOrderId: input.customerOrderId,
          expectedUpdatedAt: expectedUpdatedAt.toISOString(),
          storeId: input.storeId,
          priceMode: input.priceMode ?? null,
          customerId: input.customerId === undefined ? "__omitted" : input.customerId,
          customerName: input.customerName ?? null,
          customerEmail: input.customerEmail ?? null,
          customerPhone: input.customerPhone ?? null,
          customerAddress: input.customerAddress ?? null,
          notes: input.notes ?? null,
          lines: input.lines,
        },
      },
      async () => {
        await assertBaamReviewedVersion(tx, "CustomerOrder", input.customerOrderId);
        await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${input.customerOrderId} FOR UPDATE`;
        const order = await tx.customerOrder.findFirst({
          where: {
            id: input.customerOrderId,
            organizationId: input.organizationId,
            isPosSale: false,
          },
          include: { lines: { orderBy: { id: "asc" } } },
        });
        if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
        const actor = await assertOrderActorStoreAccessTx(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          storeId: order.storeId,
        });
        if (input.storeId !== order.storeId) {
          throw new AppError("salesOrderStoreChangeUnsupported", "CONFLICT", 409);
        }
        assertEditable(order.status);
        if (order.isHeld) throw new AppError("salesOrderNotEditable", "CONFLICT", 409);
        if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new AppError("salesOrderStale", "CONFLICT", 409);
        }
        const [payment, saleReturn, refund, fiscal, marking] = await Promise.all([
          tx.salePayment.findFirst({ where: { customerOrderId: order.id }, select: { id: true } }),
          tx.saleReturn.findFirst({ where: { originalSaleId: order.id }, select: { id: true } }),
          tx.refundRequest.findFirst({ where: { originalSaleId: order.id }, select: { id: true } }),
          tx.fiscalReceipt.findFirst({ where: { customerOrderId: order.id }, select: { id: true } }),
          tx.markingCodeCapture.findFirst({ where: { saleId: order.id }, select: { id: true } }),
        ]);
        if (payment || saleReturn || refund || fiscal || marking) {
          throw new AppError("salesOrderUpdateRequiresCorrection", "CONFLICT", 409);
        }

        const customer =
          input.customerId == null
            ? null
            : await selectedOrderCustomerTx(tx, actor, input.customerId);
        const customerName =
          input.customerName === undefined ? (customer?.name ?? order.customerName) : input.customerName;
        const customerEmail =
          input.customerEmail === undefined ? (customer?.email ?? order.customerEmail) : input.customerEmail;
        const customerPhone = normalizeUpdatedCustomerPhone(
          input.customerPhone === undefined ? (customer?.phone ?? order.customerPhone) : input.customerPhone,
          order.customerPhone,
        );
        const customerAddress = normalizeUpdatedCustomerAddress(
          input.customerAddress === undefined ? (customer?.address ?? order.customerAddress) : input.customerAddress,
          order.customerAddress,
        );

        const retailWholesaleEnabled = await getRetailWholesaleEnabled(tx, input.organizationId);
        const priceMode = retailWholesaleEnabled
          ? normalizeOrderPriceMode(input.priceMode ?? order.priceMode)
          : "RETAIL";

        // A loyalty discount is stored on the lines. Release it before reading
        // the editable snapshots, otherwise the discounted price would be
        // written back after the points reservation is returned. Metadata-only
        // edits keep the applied discount and its totals untouched.
        const previousLines = order.lines;
        const linesUnchanged =
          input.lines.length === order.lines.length &&
          input.lines.every((line) => {
            const existing = order.lines.find((row) => row.id === line.lineId);
            if (!existing) return false;
            const priceUnchanged =
              line.unitPriceKgs === undefined ||
              Math.abs(Number(existing.unitPriceKgs) - line.unitPriceKgs) < 0.005;
            const sourceUnchanged =
              line.priceSource === undefined ||
              line.priceSource === existing.priceSource ||
              (line.priceSource === "MANUAL" && existing.manualPrice);
            return (
              existing.productId === line.productId &&
              (existing.variantId ?? null) === (line.variantId ?? null) &&
              existing.qty === line.qty &&
              priceUnchanged &&
              sourceUnchanged
            );
          }) &&
          (!input.priceMode ||
            normalizeOrderPriceMode(input.priceMode) ===
              normalizeOrderPriceMode(order.priceMode));
        if (!linesUnchanged) {
          await releaseLoyaltyForOrder(tx, { customerOrderId: order.id });
        }
        const editableLines = linesUnchanged
          ? order.lines
          : await tx.customerOrderLine.findMany({
              where: { customerOrderId: order.id },
              orderBy: { id: "asc" },
            });
        const existingById = new Map(editableLines.map((line) => [line.id, line]));
        const seenKeys = new Set<string>();
        const keepLineIds: string[] = [];
        const lineOps: Array<{
          existingId: string | null;
          productId: string;
          variantId: string | null;
          variantKey: string;
          qty: number;
          unitPriceKgs: number;
          baseUnitPriceKgs: number;
          priceSource: string;
          manualPrice: boolean;
          repriced: boolean;
          discountType: CatalogDiscountType | null;
          discountPercentage: number | null;
          discountAmountKgs: number | null;
          unitCostKgs: number | null;
          lineTotalKgs: number;
          lineCostTotalKgs: number | null;
        }> = [];

        for (const line of input.lines) {
          if (!Number.isFinite(line.qty) || line.qty <= 0) {
            throw new AppError("invalidSalesQuantity", "BAD_REQUEST", 400);
          }
          await assertProductQuantity(tx, input.organizationId, line.productId, line.qty);
          const existing = line.lineId ? existingById.get(line.lineId) : undefined;
          if (line.lineId && !existing) {
            throw new AppError("salesOrderLineNotFound", "NOT_FOUND", 404);
          }
          if (existing && existing.productId !== line.productId) {
            throw new AppError("salesOrderLineProductChangeUnsupported", "CONFLICT", 409);
          }
          if (existing && (existing.variantId ?? null) !== (line.variantId ?? null)) {
            throw new AppError("salesOrderLineProductChangeUnsupported", "CONFLICT", 409);
          }
          const resolved = await resolveUnitPrice({
            tx,
            organizationId: input.organizationId,
            storeId: order.storeId,
            productId: line.productId,
            variantId: line.variantId ?? null,
            priceMode,
            retailWholesaleEnabled,
          });
          const dedupeKey = `${line.productId}:${resolved.variantKey}`;
          if (seenKeys.has(dedupeKey)) {
            throw new AppError("duplicateLineItem", "CONFLICT", 409);
          }
          seenKeys.add(dedupeKey);
          if (existing) keepLineIds.push(existing.id);

          const existingManual = existing
            ? existing.manualPrice ||
              existing.priceSource === "MANUAL" ||
              existing.priceSource === "LEGACY"
            : false;
          const modeChanged = priceMode !== normalizeOrderPriceMode(order.priceMode);
          const repriceForMode = Boolean(
            existing && modeChanged && !existingManual && line.unitPriceKgs === undefined,
          );
          const explicitSource = line.priceSource ?? (line.unitPriceKgs !== undefined ? "MANUAL" : undefined);
          if (explicitSource === "RETAIL" || explicitSource === "WHOLESALE") {
            if (!resolved.hasConfiguredPrice || resolved.priceMode !== explicitSource) {
              throw new AppError("salesOrderPriceRequired", "BAD_REQUEST", 400);
            }
            const requested = normalizeOrderUnitPrice(line.unitPriceKgs ?? -1);
            if (Math.abs(requested - resolved.unitPrice) > 0.005) {
              throw new AppError("salesOrderPriceChanged", "CONFLICT", 409);
            }
          }

          if (
            (!existing || repriceForMode) &&
            line.unitPriceKgs === undefined &&
            !resolved.hasConfiguredPrice
          ) {
            throw new AppError("salesOrderPriceRequired", "BAD_REQUEST", 400);
          }

          const unitPriceKgs =
            line.unitPriceKgs === undefined
              ? existing && !repriceForMode
                ? Number(existing.unitPriceKgs)
                : resolved.unitPrice
              : normalizeOrderUnitPrice(line.unitPriceKgs);
          const manualPrice =
            explicitSource === "MANUAL" ||
            Boolean(existing && line.unitPriceKgs === undefined && existingManual);
          const repriced = !existing || line.unitPriceKgs !== undefined || repriceForMode;
          const unitCostKgs = existing
            ? existing.unitCostKgs === null
              ? null
              : Number(existing.unitCostKgs)
            : await resolveUnitCost({
                tx,
                organizationId: input.organizationId,
                productId: line.productId,
                variantId: line.variantId ?? null,
                isBundle: resolved.isBundle,
              });
          lineOps.push({
            existingId: existing?.id ?? null,
            productId: line.productId,
            variantId: line.variantId ?? null,
            variantKey: resolved.variantKey,
            qty: line.qty,
            unitPriceKgs,
            baseUnitPriceKgs: manualPrice
              ? unitPriceKgs
              : existing && !repriced
                ? Number(existing.baseUnitPriceKgs ?? existing.unitPriceKgs)
                : Number(resolved.baseUnitPriceKgs),
            priceSource: manualPrice
              ? "MANUAL"
              : existing && !repriced
                ? existing.priceSource
                : resolved.priceSource,
            manualPrice,
            repriced,
            discountType: manualPrice
              ? null
              : existing && !repriced
                ? existing.appliedDiscountType
                : resolved.appliedDiscountType,
            discountPercentage: manualPrice
              ? null
              : existing && !repriced
                ? toMoneyOrNull(existing.appliedDiscountPercentage)
                : toMoneyOrNull(resolved.appliedDiscountPercentage),
            discountAmountKgs: manualPrice
              ? null
              : existing && !repriced
                ? toMoneyOrNull(existing.appliedDiscountAmountKgs)
                : toMoneyOrNull(resolved.appliedDiscountAmountKgs),
            unitCostKgs,
            lineTotalKgs: orderLineTotal(unitPriceKgs, line.qty),
            lineCostTotalKgs: unitCostKgs === null ? null : roundMoney(unitCostKgs * line.qty),
          });
        }

        const removedIds = order.lines
          .filter((line) => !keepLineIds.includes(line.id))
          .map((line) => line.id);
        if (removedIds.length) {
          await tx.customerOrderLine.deleteMany({ where: { id: { in: removedIds }, customerOrderId: order.id } });
        }
        await tx.$queryRaw`SELECT set_config('bazaar.price_mode_write', 'v1', true)`;

        for (const op of lineOps) {
          if (op.existingId) {
            const priceData = op.repriced
              ? op.manualPrice
                ? manualOrderPriceData(op.unitPriceKgs)
                : {
                    manualPrice: false,
                    priceSource: op.priceSource,
                    baseUnitPriceKgs: op.baseUnitPriceKgs,
                    appliedDiscountType: op.discountType,
                    appliedDiscountPercentage:
                      op.discountPercentage === null ? null : new Prisma.Decimal(op.discountPercentage),
                    appliedDiscountAmountKgs:
                      op.discountAmountKgs === null ? null : new Prisma.Decimal(op.discountAmountKgs),
                  }
              : {};
            await tx.customerOrderLine.update({
              where: { id: op.existingId },
              data: {
                qty: op.qty,
                unitPriceKgs: op.unitPriceKgs,
                lineTotalKgs: op.lineTotalKgs,
                lineCostTotalKgs: op.lineCostTotalKgs,
                ...priceData,
              },
            });
          } else {
            await tx.customerOrderLine.create({
              data: {
                customerOrderId: order.id,
                productId: op.productId,
                variantId: op.variantId,
                variantKey: op.variantKey,
                qty: op.qty,
                unitPriceKgs: op.unitPriceKgs,
                baseUnitPriceKgs: op.baseUnitPriceKgs,
                priceSource: op.priceSource,
                manualPrice: op.manualPrice,
                appliedDiscountType: op.discountType,
                appliedDiscountPercentage:
                  op.discountPercentage === null ? null : new Prisma.Decimal(op.discountPercentage),
                appliedDiscountAmountKgs:
                  op.discountAmountKgs === null ? null : new Prisma.Decimal(op.discountAmountKgs),
                lineTotalKgs: op.lineTotalKgs,
                unitCostKgs: op.unitCostKgs,
                lineCostTotalKgs: op.lineCostTotalKgs,
              },
            });
          }
        }

        await tx.customerOrder.update({
          where: { id: order.id },
          data: {
            customerId: input.customerId === undefined ? order.customerId : input.customerId,
            customerName,
            customerEmail,
            customerPhone,
            customerAddress,
            notes: input.notes === undefined ? order.notes : input.notes,
            priceMode,
            updatedById: input.actorId,
          },
        });
        if (input.customerId === undefined) {
          await upsertCustomerFromOrderTx(tx, {
            orderId: order.id,
            organizationId: input.organizationId,
            storeId: order.storeId,
            customerName,
            customerEmail,
            customerPhone,
            customerAddress,
          });
        }
        // API orders may already have deducted stock before this edit. Apply
        // only the difference between the old and new lines, exactly as the
        // existing line-level edit paths do.
        await syncAlreadyDeductedOrderStock(tx, order, input.actorId);
        const updated = await recomputeTotals(tx, order.id, input.actorId);
        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "SALES_ORDER_UPDATE",
          entity: "CustomerOrder",
          entityId: order.id,
          before: toJson({
            customerId: order.customerId,
            customerName: order.customerName,
            notes: order.notes,
            priceMode: order.priceMode,
            totalKgs: order.totalKgs,
            updatedAt: order.updatedAt,
            lines: previousLines.map((line) => ({
              id: line.id,
              productId: line.productId,
              qty: line.qty,
              unitPriceKgs: line.unitPriceKgs,
            })),
          }),
          after: toJson({
            customerId: input.customerId === undefined ? order.customerId : input.customerId,
            totalKgs: updated.totalKgs,
            updatedAt: updated.updatedAt,
            priceMode,
            lines: lineOps.map((line) => ({
              id: line.existingId,
              productId: line.productId,
              qty: line.qty,
              unitPriceKgs: line.unitPriceKgs,
            })),
          }),
          requestId: input.requestId,
        });
        return {
          id: updated.id,
          number: updated.number,
          status: updated.status,
          storeId: updated.storeId,
          totalKgs: Number(updated.totalKgs),
          updatedAt: updated.updatedAt,
        };
      },
    );
  });
  return operation.result;
};

export const updateCustomerOrderTracking = async (input: {
  organizationId: string;
  customerOrderId: string;
  trackingNumber?: string | null;
  trackingCarrier?: string | null;
  trackingUrl?: string | null;
  trackingStatus?: string | null;
  actorId: string;
  requestId: string;
}) => {
  const order = await prisma.$transaction(async (tx) => {
    const before = await tx.customerOrder.findUnique({ where: { id: input.customerOrderId } });
    if (!before) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }
    if (before.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }
    if (before.isPosSale) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }

    const nextTrackingNumber = normalizeOptionalText(input.trackingNumber);
    const nextTrackingCarrier = normalizeOptionalText(input.trackingCarrier);
    const nextTrackingUrl = normalizeOptionalText(input.trackingUrl);
    const nextTrackingStatus = normalizeOptionalText(input.trackingStatus);
    const updated = await tx.customerOrder.update({
      where: { id: before.id },
      data: {
        trackingNumber: nextTrackingNumber,
        trackingCarrier: nextTrackingCarrier,
        trackingUrl: nextTrackingUrl,
        trackingStatus: nextTrackingStatus,
        // The first tracking timestamp is lifecycle history. Clearing or correcting
        // current tracking fields must not make an already handled order active again.
        ...(nextTrackingNumber ? { trackingAddedAt: before.trackingAddedAt ?? new Date() } : {}),
        updatedById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "SALES_ORDER_TRACKING_UPDATE",
      entity: "CustomerOrder",
      entityId: before.id,
      before: toJson({
        trackingNumber: before.trackingNumber,
        trackingCarrier: before.trackingCarrier,
        trackingUrl: before.trackingUrl,
        trackingStatus: before.trackingStatus,
      }),
      after: toJson({
        trackingNumber: updated.trackingNumber,
        trackingCarrier: updated.trackingCarrier,
        trackingUrl: updated.trackingUrl,
        trackingStatus: updated.trackingStatus,
      }),
      requestId: input.requestId,
    });

    return serializeOrder(updated);
  });

  return { order, trackingEmail: null };
};

export const sendCustomerOrderEmail = async (input: {
  organizationId: string;
  customerOrderId: string;
  type: CustomerOrderEmailType;
  actorId: string;
}) => {
  if (input.type === CustomerOrderEmailType.CONFIRMATION) {
    return sendOrderConfirmationEmail({
      organizationId: input.organizationId,
      customerOrderId: input.customerOrderId,
      triggeredById: input.actorId,
      force: true,
    });
  }

  if (input.type === CustomerOrderEmailType.TRACKING) {
    return sendOrderTrackingEmail({
      organizationId: input.organizationId,
      customerOrderId: input.customerOrderId,
      triggeredById: input.actorId,
      force: true,
    });
  }

  throw new AppError("invalidInput", "BAD_REQUEST", 400);
};

type AddCustomerOrderLineInput = {
  organizationId: string;
  customerOrderId: string;
  productId: string;
  variantId?: string | null;
  qty: number;
  unitPriceKgs?: number;
  actorId: string;
  requestId: string;
};

const createCustomerOrderLineTx = async (
  tx: Prisma.TransactionClient,
  input: AddCustomerOrderLineInput,
  order: { id: string; storeId: string; priceMode: string },
  expectedUnitPriceKgs?: number,
) => {
  await assertProductQuantity(tx, input.organizationId, input.productId, input.qty);
  const resolved = await resolveUnitPrice({
    tx,
    organizationId: input.organizationId,
    storeId: order.storeId,
    productId: input.productId,
    variantId: input.variantId,
    priceMode: normalizeOrderPriceMode(order.priceMode),
  });
  const { variantKey, isBundle } = resolved;
  const unitPrice = input.unitPriceKgs === undefined
    ? resolved.unitPrice
    : normalizeOrderUnitPrice(input.unitPriceKgs);
  if (expectedUnitPriceKgs !== undefined && !new Prisma.Decimal(unitPrice).eq(expectedUnitPriceKgs)) {
    throw new AppError("salesOrderPriceChanged", "CONFLICT", 409);
  }
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

  const lineTotal = orderLineTotal(unitPrice, input.qty);
  const lineCostTotal = unitCost === null ? null : roundMoney(unitCost * input.qty);
  return tx.customerOrderLine.create({
    data: {
      customerOrderId: order.id,
      productId: input.productId,
      variantId: input.variantId ?? null,
      variantKey,
      qty: input.qty,
      ...(input.unitPriceKgs === undefined
        ? {
            priceSource: resolved.priceSource,
            baseUnitPriceKgs: resolved.baseUnitPriceKgs,
            appliedDiscountType: resolved.appliedDiscountType,
            appliedDiscountPercentage: resolved.appliedDiscountPercentage,
            appliedDiscountAmountKgs: resolved.appliedDiscountAmountKgs,
          }
        : manualOrderPriceData(unitPrice)),
      unitPriceKgs: unitPrice,
      lineTotalKgs: lineTotal,
      unitCostKgs: unitCost,
      lineCostTotalKgs: lineCostTotal,
    },
  });
};

export const addCustomerOrderLine = async (input: AddCustomerOrderLineInput) => {
  const result = await prisma.$transaction(async (tx) => {
    await assertBaamReviewedVersion(tx, "CustomerOrder", input.customerOrderId);
    await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${input.customerOrderId} FOR UPDATE`;
    const order = await tx.customerOrder.findUnique({ where: { id: input.customerOrderId } });
    if (!order) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }
    if (order.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }
    if (order.isPosSale) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    }

    assertEditable(order.status);
    await assertOrderActorStoreAccessTx(tx, { ...input, storeId: order.storeId });
    if (await tx.salePayment.findFirst({ where: { customerOrderId: order.id } })) throw new AppError("loyaltyReceiptFinancialEdit", "CONFLICT", 409);
    await releaseLoyaltyForOrder(tx, { customerOrderId: order.id });

    const line = await createCustomerOrderLineTx(tx, input, order);
    await syncAlreadyDeductedOrderStock(tx, order, input.actorId);
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
  const store = await prisma.customerOrder.findUnique({ where: { id: result.customerOrderId }, select: { storeId: true } });
  if (store) eventBus.publish({ type: "inventory.updated", payload: { storeId: store.storeId, productId: "*" } });
  return result;
};

export const updateCustomerOrderLine = async (input: {
  organizationId: string;
  lineId: string;
  qty?: number;
  unitPriceKgs?: number;
  actorId: string;
  requestId: string;
}) => {
  const result = await prisma.$transaction(async (tx) => {
    const identity = await tx.customerOrderLine.findUnique({ where: { id: input.lineId }, select: { customerOrderId: true } });
    if (identity) await assertBaamReviewedVersion(tx, "CustomerOrder", identity.customerOrderId);
    if (identity) await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${identity.customerOrderId} FOR UPDATE`;
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
    if (line.customerOrder.isPosSale) {
      throw new AppError("salesOrderLineNotFound", "NOT_FOUND", 404);
    }

    assertEditable(line.customerOrder.status);
    await assertOrderActorStoreAccessTx(tx, { ...input, storeId: line.customerOrder.storeId });
    if (input.qty === undefined && input.unitPriceKgs === undefined) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    await assertProductQuantity(tx, input.organizationId, line.productId, input.qty ?? line.qty);
    if (input.unitPriceKgs !== undefined) normalizeOrderUnitPrice(input.unitPriceKgs);

    if (await tx.salePayment.findFirst({ where: { customerOrderId: line.customerOrderId } })) throw new AppError("loyaltyReceiptFinancialEdit", "CONFLICT", 409);
    await releaseLoyaltyForOrder(tx, { customerOrderId: line.customerOrderId });
    const restoredLine = await tx.customerOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    const qty = input.qty ?? restoredLine.qty;
    const unitPrice = input.unitPriceKgs === undefined
      ? Number(restoredLine.unitPriceKgs)
      : normalizeOrderUnitPrice(input.unitPriceKgs);

    const nextLine = await tx.customerOrderLine.update({
      where: { id: line.id },
      data: {
        qty,
        ...(input.unitPriceKgs === undefined ? {} : manualOrderPriceData(unitPrice)),
        unitPriceKgs: unitPrice,
        lineTotalKgs: orderLineTotal(unitPrice, qty),
        lineCostTotalKgs:
          restoredLine.unitCostKgs === null ? null : roundMoney(Number(restoredLine.unitCostKgs) * qty),
      },
    });

    await syncAlreadyDeductedOrderStock(tx, line.customerOrder, input.actorId);
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
  const store = await prisma.customerOrder.findUnique({ where: { id: result.customerOrderId }, select: { storeId: true } });
  if (store) eventBus.publish({ type: "inventory.updated", payload: { storeId: store.storeId, productId: "*" } });
  return result;
};

export const removeCustomerOrderLine = async (input: {
  organizationId: string;
  lineId: string;
  actorId: string;
  requestId: string;
}) => {
  const result = await prisma.$transaction(async (tx) => {
    const identity = await tx.customerOrderLine.findUnique({ where: { id: input.lineId }, select: { customerOrderId: true } });
    if (identity) await assertBaamReviewedVersion(tx, "CustomerOrder", identity.customerOrderId);
    if (identity) await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${identity.customerOrderId} FOR UPDATE`;
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
    if (line.customerOrder.isPosSale) {
      throw new AppError("salesOrderLineNotFound", "NOT_FOUND", 404);
    }

    assertEditable(line.customerOrder.status);

    if (await tx.salePayment.findFirst({ where: { customerOrderId: line.customerOrderId } })) throw new AppError("loyaltyReceiptFinancialEdit", "CONFLICT", 409);
    await releaseLoyaltyForOrder(tx, { customerOrderId: line.customerOrderId });

    await tx.customerOrderLine.delete({ where: { id: line.id } });
    await syncAlreadyDeductedOrderStock(tx, line.customerOrder, input.actorId);
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
  const store = await prisma.customerOrder.findUnique({ where: { id: result.customerOrderId }, select: { storeId: true } });
  if (store) eventBus.publish({ type: "inventory.updated", payload: { storeId: store.storeId, productId: "*" } });
  return result;
};

const updateOrderStatus = async (input: {
  customerOrderId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  to: CustomerOrderStatus;
}) => {
  const result = await prisma.$transaction(async (tx) => {
    await assertBaamReviewedVersion(tx, "CustomerOrder", input.customerOrderId);
    await tx.$queryRaw`
      SELECT id FROM "CustomerOrder" WHERE id = ${input.customerOrderId} FOR UPDATE
    `;

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
    if (order.isPosSale) {
      throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
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

    if (input.to === CustomerOrderStatus.CANCELED) {
      await releaseLoyaltyForOrder(tx, { customerOrderId: order.id });
      await restoreCustomerOrderStockOnCancel(tx, {
        order: {
          id: order.id,
          number: order.number,
          storeId: order.storeId,
        },
        organizationId: input.organizationId,
        actorId: input.actorId,
      });
    }

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

    return { order: serializeOrder(updated), oldStatus: order.status, newStatus: updated.status };
  });
  eventBus.publish({
    type: "customerOrder.statusChanged",
    payload: {
      customerOrderId: result.order.id,
      storeId: result.order.storeId,
      oldStatus: result.oldStatus,
      newStatus: result.newStatus,
    },
  });
  if (result.newStatus === CustomerOrderStatus.CANCELED) {
    eventBus.publish({ type: "inventory.updated", payload: { storeId: result.order.storeId, productId: "*" } });
  }
  if (
    result.newStatus !== CustomerOrderStatus.CONFIRMED &&
    result.newStatus !== CustomerOrderStatus.CANCELED
  ) {
    void processEmailAutomationTrigger({
      organizationId: input.organizationId,
      storeId: result.order.storeId,
      customerOrderId: result.order.id,
      trigger: EmailAutomationTrigger.ORDER_STATUS_CHANGED,
      oldStatus: result.oldStatus,
      newStatus: result.newStatus,
    }).catch((error: unknown) => {
      getLogger(input.requestId).error(
        {
          error,
          customerOrderId: result.order.id,
          storeId: result.order.storeId,
          oldStatus: result.oldStatus,
          newStatus: result.newStatus,
        },
        "email automation order-status trigger failed",
      );
    });
  }
  if (result.newStatus === CustomerOrderStatus.CONFIRMED) {
    try {
      await sendOrderConfirmationEmail({
        organizationId: input.organizationId,
        customerOrderId: result.order.id,
        triggeredById: input.actorId,
        throwOnMissingEmail: false,
      });
    } catch (error: unknown) {
      getLogger(input.requestId).error(
        { error, customerOrderId: result.order.id, storeId: result.order.storeId },
        "order confirmation email send failed",
      );
    }
  }
  return result.order;
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

export const cancelCustomerOrder = async (input: {
  customerOrderId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
}) => {
  const order = await updateOrderStatus({
    ...input,
    to: CustomerOrderStatus.CANCELED,
  });
  let cancellationEmail: OrderEmailSendResult | { status: "failed"; reason: "sendFailed" } | null =
    null;
  try {
    cancellationEmail = await sendOrderCancellationEmail({
      organizationId: input.organizationId,
      customerOrderId: order.id,
      triggeredById: input.actorId,
      throwOnMissingEmail: false,
    });
  } catch (error: unknown) {
    getLogger(input.requestId).error(
      { error, customerOrderId: order.id, storeId: order.storeId },
      "order cancellation email send failed",
    );
    cancellationEmail = { status: "failed", reason: "sendFailed" };
  }
  return { order, cancellationEmail };
};

type CompleteCustomerOrderInput = {
  customerOrderId: string;
  organizationId: string;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
};

type CustomerOrderCompletion = {
  id: string;
  number: string;
  status: CustomerOrderStatus;
  storeId: string;
  productIds: string[];
  previousStatus: CustomerOrderStatus;
  alreadyCompleted: boolean;
};

// All ordinary-sale posting paths share these stock, assortment, currency and
// loyalty rules. Callers own the transaction, assortment lock and idempotency.
export const completeCustomerOrderTx = async (
  tx: Prisma.TransactionClient,
  input: CompleteCustomerOrderInput & {
    allowImmediate?: boolean;
    completionEventKey?: string;
    completedAt?: Date;
  },
): Promise<CustomerOrderCompletion> => {
  await assertBaamReviewedVersion(tx, "CustomerOrder", input.customerOrderId);
  await tx.$queryRaw`SELECT id FROM "CustomerOrder" WHERE id = ${input.customerOrderId} FOR UPDATE`;
  const order = await tx.customerOrder.findUnique({
    where: { id: input.customerOrderId },
    include: { store: true, lines: true },
  });
  if (!order || order.isPosSale) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
  if (order.organizationId !== input.organizationId) {
    throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
  }
  if (input.allowImmediate) {
    await assertSalesManagerStoreAccessTx(tx, { ...input, storeId: order.storeId });
  }
  if (order.status === CustomerOrderStatus.COMPLETED) {
    return {
      id: order.id, number: order.number, status: order.status, storeId: order.storeId,
      productIds: order.lines.map((line) => line.productId),
      previousStatus: order.status, alreadyCompleted: true,
    };
  }
  if (input.allowImmediate) {
    const immediateStatuses: CustomerOrderStatus[] = [CustomerOrderStatus.DRAFT, CustomerOrderStatus.CONFIRMED, CustomerOrderStatus.READY];
    if (!immediateStatuses.includes(order.status)) {
      throw new AppError("invalidTransition", "CONFLICT", 409);
    }
  } else {
    assertTransition(order.status, CustomerOrderStatus.COMPLETED);
  }
  if (!order.lines.length) throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
  // A document without a resolved price is not postable in either mode. Zero is a
  // real price, so only the explicit MISSING marker blocks. Drafts stay editable.
  if (order.lines.some((line) => line.priceSource === "MISSING")) {
    throw new AppError("salesOrderPriceRequired", "BAD_REQUEST", 400);
  }
  await assertSaleAssortment(tx, input.organizationId, order.storeId, order.lines.map((line) => line.productId));
  const apiStockAlreadyApplied = order.source === CustomerOrderSource.API
    ? await tx.stockMovement.findFirst({
        where: { referenceType: "CustomerOrder", referenceId: order.id, type: StockMovementType.SALE, qtyDelta: { lt: 0 } },
        select: { id: true },
      })
    : null;
  if (!apiStockAlreadyApplied) {
    for (const line of order.lines) {
      await applyStockMovement(tx, {
        storeId: order.storeId, productId: line.productId, variantId: line.variantId,
        qtyDelta: -line.qty, type: StockMovementType.SALE, referenceType: "CustomerOrder",
        referenceId: order.id, note: order.number, actorId: input.actorId, organizationId: input.organizationId,
      });
    }
  }
  const now = new Date();
  const updated = await tx.customerOrder.update({
    where: { id: order.id },
    data: {
      status: CustomerOrderStatus.COMPLETED,
      completedAt: input.completedAt ?? now,
      completedEventId: input.completionEventKey ?? input.idempotencyKey,
      completedById: input.actorId,
      ...(input.allowImmediate ? { confirmedAt: order.confirmedAt ?? now, readyAt: order.readyAt ?? now } : {}),
      ...(order.currencyCode ? {} : resolveCurrencySnapshot(order.store)),
      updatedById: input.actorId,
    },
  });
  // Posting is not payment evidence. Keep earning and all cash/shift rules intact.
  const paid = await tx.salePayment.aggregate({
    where: {
      customerOrderId: order.id,
      isRefund: false,
      settlementStatus: { in: [SalePaymentSettlement.ACTUAL, SalePaymentSettlement.OFFSET] },
    },
    _sum: { amountKgs: true },
  });
  const paidKgs = Number(paid._sum.amountKgs ?? 0);
  await confirmLoyaltyForOrder(tx, {
    organizationId: input.organizationId, customerOrderId: order.id,
    paidInFull: paidKgs + 0.005 >= Number(updated.totalKgs) && Number(updated.totalKgs) > 0,
    actorId: input.actorId,
  });
  await writeAuditLog(tx, {
    organizationId: input.organizationId, actorId: input.actorId, action: "SALES_ORDER_COMPLETE",
    entity: "CustomerOrder", entityId: order.id,
    before: toJson({ status: order.status }),
    after: toJson({ status: updated.status, immediate: Boolean(input.allowImmediate) }),
    requestId: input.requestId,
  });
  return {
    id: updated.id, number: updated.number, status: updated.status, storeId: updated.storeId,
    productIds: order.lines.map((line) => line.productId), previousStatus: order.status, alreadyCompleted: false,
  };
};

const publishCustomerOrderCompletion = (result: CustomerOrderCompletion) => {
  if (result.alreadyCompleted) return;
  for (const productId of new Set(result.productIds)) {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: result.storeId, productId, variantId: null },
    });
  }
  eventBus.publish({
    type: "customerOrder.statusChanged",
    payload: { customerOrderId: result.id, storeId: result.storeId, oldStatus: result.previousStatus, newStatus: result.status },
  });
};

const getOrdinaryOrderIdentityTx = async (
  tx: Prisma.TransactionClient,
  input: { organizationId: string; customerOrderId: string },
) => {
  const order = await tx.customerOrder.findFirst({
    where: { id: input.customerOrderId, organizationId: input.organizationId, isPosSale: false },
    select: { id: true, number: true, storeId: true },
  });
  if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
  return order;
};

export const completeCustomerOrder = async (input: CompleteCustomerOrderInput) => {
  const result = await prisma.$transaction(async (tx) => {
    await lockAssortmentForSale(tx, input.organizationId);
    const order = await getOrdinaryOrderIdentityTx(tx, input);
    await assertOrderActorStoreAccessTx(tx, { ...input, storeId: order.storeId });
    const existing = await tx.idempotencyKey.findUnique({
      where: { key_route_userId: { key: input.idempotencyKey, route: "salesOrders.complete", userId: input.actorId } },
    });
    // Older completion records hashed the response rather than the request.
    // Replay only after checking their saved order identity; never let the old
    // unbound key claim completion of a different order.
    if (existing?.response) {
      const saved = existing.response as Prisma.JsonObject;
      if (saved.id !== order.id || saved.storeId !== order.storeId) {
        throw new AppError("idempotencyKeyPayloadMismatch", "CONFLICT", 409);
      }
      const legacyHash = createHash("sha256").update(JSON.stringify(existing.response)).digest("hex");
      if (existing.responseHash === legacyHash || existing.responseHash === null) {
        return {
          replayed: true,
          result: { ...saved, previousStatus: CustomerOrderStatus.COMPLETED, alreadyCompleted: true } as CustomerOrderCompletion,
        };
      }
    }
    return withIdempotency(tx, {
      key: input.idempotencyKey, route: "salesOrders.complete", userId: input.actorId,
      request: { customerOrderId: input.customerOrderId },
    }, () => completeCustomerOrderTx(tx, input));
  });
  if (!result.replayed) publishCustomerOrderCompletion(result.result);
  getLogger(input.requestId).info({ customerOrderId: result.result.id, number: result.result.number }, "customer order completed");
  return result.result;
};

export const postCustomerSale = async (input: CompleteCustomerOrderInput) => {
  const result = await prisma.$transaction(async (tx) => {
    await lockAssortmentForSale(tx, input.organizationId);
    const order = await getOrdinaryOrderIdentityTx(tx, input);
    await assertSalesManagerStoreAccessTx(tx, { ...input, storeId: order.storeId });
    return withIdempotency(tx, {
      key: input.idempotencyKey, route: "salesOrders.postSale.v1", userId: input.actorId,
      request: { customerOrderId: input.customerOrderId },
    }, () => completeCustomerOrderTx(tx, {
      ...input,
      allowImmediate: true,
      completionEventKey: `salesOrders.postSale:${input.organizationId}:${input.actorId}:${input.idempotencyKey}`,
    }));
  }, FAST_SALE_TRANSACTION_OPTIONS);
  if (!result.replayed) publishCustomerOrderCompletion(result.result);
  return result.result;
};

export type RemoveDeclinedCustomerOrderLineInput = CompleteCustomerOrderInput & {
  lineId: string;
  expectedUpdatedAt: string;
  reason: string;
  confirmCancelLastLine?: boolean;
};

type DeclinedLineResult = {
  id: string;
  status: CustomerOrderStatus;
  replacementId: string | null;
  replacementNumber: string | null;
};

export const unpaidSaleAmendmentSelect = {
  id: true,
  organizationId: true,
  storeId: true,
  status: true,
  source: true,
  externalOrderId: true,
  isHeld: true,
  registerId: true,
  shiftId: true,
  archivedAt: true,
  completedAt: true,
  canceledAt: true,
  isDebt: true,
  debtSettledAt: true,
  discountKgs: true,
  kkmStatus: true,
  kkmReceiptId: true,
  kkmRawJson: true,
  totalKgs: true,
} satisfies Prisma.CustomerOrderSelect;

type UnpaidSaleAmendmentOrder = Prisma.CustomerOrderGetPayload<{ select: typeof unpaidSaleAmendmentSelect }>;
type SaleMovementLine = { productId: string; variantKey: string; qty: number; lineTotalKgs: Prisma.Decimal };

const unpaidSaleFinancialBlocker = async (
  tx: Prisma.TransactionClient,
  order: UnpaidSaleAmendmentOrder,
) => {
  const [payment, returned, refund, loyalty, reservation, loyaltyEntry, fiscal] = await Promise.all([
    tx.salePayment.findFirst({ where: { customerOrderId: order.id }, select: { id: true } }),
    tx.saleReturn.findFirst({ where: { originalSaleId: order.id }, select: { id: true } }),
    tx.refundRequest.findFirst({ where: { originalSaleId: order.id }, select: { id: true } }),
    tx.loyaltyOrderApplication.findFirst({ where: { customerOrderId: order.id, status: { not: "RELEASED" } }, select: { id: true } }),
    tx.loyaltyReservation.findFirst({ where: { customerOrderId: order.id, status: { in: ["ACTIVE", "CONFIRMED"] } }, select: { id: true } }),
    tx.loyaltyLedgerEntry.findFirst({ where: { customerOrderId: order.id }, select: { id: true } }),
    tx.fiscalReceipt.findFirst({ where: { customerOrderId: order.id }, select: { id: true } }),
  ]);
  if (payment || returned || refund || order.isDebt || order.debtSettledAt) {
    return "salesOrderAmendmentRequiresReturn";
  }
  if (loyalty || reservation || loyaltyEntry || !order.discountKgs.isZero()) {
    return "salesOrderAmendmentLoyaltyBlocked";
  }
  if (fiscal || order.kkmStatus !== "NOT_SENT" || order.kkmReceiptId || order.kkmRawJson) {
    return "salesOrderAmendmentFiscalBlocked";
  }
  return null;
};

const saleAmendmentStockMatches = async (
  tx: Prisma.TransactionClient,
  order: UnpaidSaleAmendmentOrder,
  lines: SaleMovementLine[],
) => {
  const movements = await tx.stockMovement.findMany({
    where: { referenceType: "CustomerOrder", referenceId: order.id },
    select: { store: { select: { organizationId: true } }, storeId: true, productId: true, variantId: true, type: true, qtyDelta: true },
  });
  if (order.status === CustomerOrderStatus.READY) return movements.length === 0;
  const net = new Map<string, number>();
  for (const movement of movements) {
    if (movement.type !== StockMovementType.SALE || movement.store.organizationId !== order.organizationId || movement.storeId !== order.storeId) {
      return false;
    }
    const key = `${movement.productId}:${movement.variantId ?? "BASE"}`;
    net.set(key, (net.get(key) ?? 0) + movement.qtyDelta);
  }
  return net.size === lines.length && lines.every((line) =>
    Math.abs((net.get(`${line.productId}:${line.variantKey}`) ?? 0) + line.qty) <= 0.000001,
  );
};

const saleAmendmentTotalMatches = (order: UnpaidSaleAmendmentOrder, lines: SaleMovementLine[]) =>
  lines.reduce((sum, line) => sum.plus(line.lineTotalKgs), new Prisma.Decimal(0)).eq(order.totalKgs);

export const getAppendUnpaidSaleBlocker = async (
  tx: Prisma.TransactionClient,
  order: UnpaidSaleAmendmentOrder & { lines: SaleMovementLine[] },
  movementDate: Date,
) => {
  if (order.status !== CustomerOrderStatus.COMPLETED || !order.completedAt || order.archivedAt || order.canceledAt || !order.lines.length) {
    return "salesOrderAppendUnavailable";
  }
  if (order.source !== CustomerOrderSource.MANUAL || order.externalOrderId || order.isHeld || order.registerId || order.shiftId) {
    return "salesOrderAmendmentUnsupportedSource";
  }
  const closed = await tx.periodClose.findFirst({
    where: {
      organizationId: order.organizationId,
      storeId: order.storeId,
      OR: [order.completedAt, movementDate].map((date) => ({
        periodStart: { lte: date }, periodEnd: { gte: date },
      })),
    },
    select: { id: true },
  });
  if (closed) return "salesOrderAmendmentPeriodClosed";
  const financialBlocker = await unpaidSaleFinancialBlocker(tx, order);
  if (financialBlocker) return financialBlocker;
  const relatedDocument = await tx.customerOrder.findFirst({
    where: {
      id: order.id,
      OR: [
        { corrections: { some: {} } },
        { correctionAdditions: { some: {} } },
        { markingCodeCaptures: { some: {} } },
      ],
    },
    select: { id: true },
  });
  if (relatedDocument || !saleAmendmentTotalMatches(order, order.lines)) return "salesOrderAppendUnavailable";
  if (!(await saleAmendmentStockMatches(tx, order, order.lines))) return "salesOrderAmendmentStockMismatch";
  return null;
};

type AppendUnpaidCustomerOrderLineInput = AddCustomerOrderLineInput & {
  expectedUpdatedAt: string;
  idempotencyKey: string;
  expectedUnitPriceKgs?: number;
};

export const appendUnpaidCustomerOrderLine = async (input: AppendUnpaidCustomerOrderLineInput) => {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const expectedUnitPriceKgs = input.expectedUnitPriceKgs === undefined
    ? undefined
    : normalizeOrderUnitPrice(input.expectedUnitPriceKgs);
  const operation = await prisma.$transaction(async (tx) => {
    await lockAssortmentForSale(tx, input.organizationId);
    const identity = await getOrdinaryOrderIdentityTx(tx, input);
    await assertSalesManagerStoreAccessTx(tx, { ...input, storeId: identity.storeId });
    return withIdempotency(tx, {
      key: input.idempotencyKey,
      route: "salesOrders.appendUnpaidLine.v1",
      userId: input.actorId,
      request: {
        customerOrderId: input.customerOrderId,
        expectedUpdatedAt: expectedUpdatedAt.toISOString(),
        productId: input.productId,
        variantId: input.variantId ?? null,
        qty: input.qty,
        unitPriceKgs: input.unitPriceKgs ?? null,
        expectedUnitPriceKgs: expectedUnitPriceKgs ?? null,
      },
    }, async () => {
      await assertBaamReviewedVersion(tx, "CustomerOrder", identity.id);
      await tx.$queryRaw`SELECT id FROM "CustomerOrder" WHERE id = ${identity.id} FOR UPDATE`;
      const order = await tx.customerOrder.findFirstOrThrow({
        where: { id: identity.id, organizationId: input.organizationId, isPosSale: false },
        include: { lines: true },
      });
      if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new AppError("salesOrderAmendmentStale", "CONFLICT", 409);
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sales-period:${input.organizationId}:${order.storeId}`}, 0))`;
      const movementDate = new Date();
      const blocker = await getAppendUnpaidSaleBlocker(tx, order, movementDate);
      if (blocker) throw new AppError(blocker, "CONFLICT", 409);
      await assertSaleAssortment(tx, input.organizationId, order.storeId, [input.productId]);
      const line = await createCustomerOrderLineTx(tx, input, order, expectedUnitPriceKgs);
      if (line.priceSource === "MISSING") throw new AppError("salesOrderPriceRequired", "BAD_REQUEST", 400);
      const { movementId } = await applyStockMovement(tx, {
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
        movementDate,
      });
      const updated = await recomputeTotals(tx, order.id, input.actorId);
      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "SALES_ORDER_UNPAID_LINE_APPEND",
        entity: "CustomerOrder",
        entityId: order.id,
        before: toJson({ totalKgs: order.totalKgs, updatedAt: order.updatedAt }),
        after: toJson({ line, movementId, totalKgs: updated.totalKgs, updatedAt: updated.updatedAt }),
        requestId: input.requestId,
      });
      return {
        storeId: order.storeId,
        line: {
          ...line,
          unitPriceKgs: Number(line.unitPriceKgs),
          baseUnitPriceKgs: toMoneyOrNull(line.baseUnitPriceKgs),
          appliedDiscountPercentage: toMoneyOrNull(line.appliedDiscountPercentage),
          appliedDiscountAmountKgs: toMoneyOrNull(line.appliedDiscountAmountKgs),
          lineTotalKgs: Number(line.lineTotalKgs),
          unitCostKgs: toMoneyOrNull(line.unitCostKgs),
          lineCostTotalKgs: toMoneyOrNull(line.lineCostTotalKgs),
        },
      };
    });
  }, FAST_SALE_TRANSACTION_OPTIONS);
  const { line, storeId } = operation.result;
  if (!operation.replayed) {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId, productId: line.productId, variantId: line.variantId },
    });
  }
  return line;
};

export const removeDeclinedCustomerOrderLine = async (input: RemoveDeclinedCustomerOrderLineInput) => {
  const reason = input.reason.trim();
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (!reason || reason.length > 500 || !Number.isFinite(expectedUpdatedAt.getTime())) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  let completion: CustomerOrderCompletion | null = null;
  let originalChange: { storeId: string; oldStatus: CustomerOrderStatus; newStatus: CustomerOrderStatus } | null = null;
  const operation = await prisma.$transaction(async (tx) => {
    await lockAssortmentForSale(tx, input.organizationId);
    const identity = await getOrdinaryOrderIdentityTx(tx, input);
    await assertSalesManagerStoreAccessTx(tx, { ...input, storeId: identity.storeId });
    return withIdempotency<DeclinedLineResult>(tx, {
      key: input.idempotencyKey,
      route: "salesOrders.removeDeclinedLine.v1",
      userId: input.actorId,
      request: {
        customerOrderId: input.customerOrderId,
        lineId: input.lineId,
        expectedUpdatedAt: expectedUpdatedAt.toISOString(),
        reason,
        confirmCancelLastLine: Boolean(input.confirmCancelLastLine),
      },
    }, async () => {
      await assertBaamReviewedVersion(tx, "CustomerOrder", input.customerOrderId);
      await tx.$queryRaw`SELECT id FROM "CustomerOrder" WHERE id = ${input.customerOrderId} FOR UPDATE`;
      const order = await tx.customerOrder.findFirstOrThrow({
        where: { id: identity.id, organizationId: input.organizationId, isPosSale: false },
        include: { lines: { orderBy: { id: "asc" } } },
      });
      if (order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new AppError("salesOrderAmendmentStale", "CONFLICT", 409);
      }
      if (order.status !== CustomerOrderStatus.READY && order.status !== CustomerOrderStatus.COMPLETED) {
        throw new AppError("salesOrderAmendmentUnavailable", "CONFLICT", 409);
      }
      if (order.source !== CustomerOrderSource.MANUAL || order.isHeld || order.registerId || order.shiftId) {
        throw new AppError("salesOrderAmendmentUnsupportedSource", "CONFLICT", 409);
      }
      if (order.status === CustomerOrderStatus.COMPLETED && order.completedAt) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sales-period:${input.organizationId}:${order.storeId}`}, 0))`;
        const closed = await tx.periodClose.findFirst({
          where: {
            organizationId: input.organizationId, storeId: order.storeId,
            periodStart: { lte: order.completedAt }, periodEnd: { gte: order.completedAt },
          },
          select: { id: true },
        });
        if (closed) throw new AppError("salesOrderAmendmentPeriodClosed", "CONFLICT", 409);
      }
      const declined = order.lines.find((line) => line.id === input.lineId);
      if (!declined) throw new AppError("salesOrderLineNotFound", "NOT_FOUND", 404);
      const financialBlocker = await unpaidSaleFinancialBlocker(tx, order);
      if (financialBlocker) throw new AppError(financialBlocker, "CONFLICT", 409);
      if (!(await saleAmendmentStockMatches(tx, order, order.lines))) {
        throw new AppError("salesOrderAmendmentStockMismatch", "CONFLICT", 409);
      }
      if (order.status === CustomerOrderStatus.COMPLETED && !saleAmendmentTotalMatches(order, order.lines)) {
        throw new AppError("salesOrderAmendmentUnavailable", "CONFLICT", 409);
      }
      const remaining = order.lines.filter((line) => line.id !== declined.id);
      if (!remaining.length && !input.confirmCancelLastLine) {
        throw new AppError("salesOrderLastLineCancellationRequired", "CONFLICT", 409);
      }
      if (order.status === CustomerOrderStatus.READY && remaining.length) {
        await tx.customerOrderLine.delete({ where: { id: declined.id } });
        const updated = await recomputeTotals(tx, order.id, input.actorId);
        await writeAuditLog(tx, {
          organizationId: input.organizationId, actorId: input.actorId,
          action: "SALES_ORDER_DECLINED_LINE_REMOVE", entity: "CustomerOrder", entityId: order.id,
          before: toJson({ line: declined, totalKgs: order.totalKgs, updatedAt: order.updatedAt }),
          after: toJson({ reason, status: updated.status, totalKgs: updated.totalKgs, updatedAt: updated.updatedAt }),
          requestId: input.requestId,
        });
        return { id: order.id, status: updated.status, replacementId: null, replacementNumber: null };
      }
      if (order.status === CustomerOrderStatus.COMPLETED) {
        await restoreCustomerOrderStockOnCancel(tx, { order, organizationId: input.organizationId, actorId: input.actorId });
      }
      await tx.customerOrder.update({
        where: { id: order.id },
        data: { status: CustomerOrderStatus.CANCELED, canceledAt: new Date(), updatedById: input.actorId },
      });
      originalChange = { storeId: order.storeId, oldStatus: order.status, newStatus: CustomerOrderStatus.CANCELED };
      let replacement: { id: string; number: string } | null = null;
      if (remaining.length) {
        const number = await nextSalesOrderNumber(tx, input.organizationId);
        replacement = await tx.customerOrder.create({
          data: {
            organizationId: order.organizationId, storeId: order.storeId,
            source: CustomerOrderSource.MANUAL, number, saleChannel: order.saleChannel,
            priceMode: order.priceMode, customerId: order.customerId,
            customerName: order.customerName, customerEmail: order.customerEmail,
            customerPhone: order.customerPhone, customerAddress: order.customerAddress,
            currencyCode: order.currencyCode, currencyRateKgsPerUnit: order.currencyRateKgsPerUnit,
            notes: [order.notes, order.number, reason].filter(Boolean).join("\n"),
            createdById: input.actorId, updatedById: input.actorId,
            lines: {
              create: remaining.map((line) => ({
                productId: line.productId, variantId: line.variantId, variantKey: line.variantKey,
                qty: line.qty, manualPrice: line.manualPrice, priceSource: line.priceSource,
                unitPriceKgs: line.unitPriceKgs, lineTotalKgs: line.lineTotalKgs,
                baseUnitPriceKgs: line.baseUnitPriceKgs, appliedDiscountType: line.appliedDiscountType,
                appliedDiscountPercentage: line.appliedDiscountPercentage,
                appliedDiscountAmountKgs: line.appliedDiscountAmountKgs,
                unitCostKgs: line.unitCostKgs, lineCostTotalKgs: line.lineCostTotalKgs,
              })),
            },
          },
          select: { id: true, number: true },
        });
        await recomputeTotals(tx, replacement.id, input.actorId);
        completion = await completeCustomerOrderTx(tx, {
          ...input, customerOrderId: replacement.id, allowImmediate: true,
          completionEventKey: `salesOrders.amendment:${input.organizationId}:${input.actorId}:${input.idempotencyKey}`,
          completedAt: order.completedAt ?? undefined,
        });
      }
      await writeAuditLog(tx, {
        organizationId: input.organizationId, actorId: input.actorId,
        action: "SALES_ORDER_AMENDMENT", entity: "CustomerOrder", entityId: order.id,
        before: toJson({ status: order.status, totalKgs: order.totalKgs, lineIds: order.lines.map((line) => line.id) }),
        after: toJson({ status: CustomerOrderStatus.CANCELED, declinedLineId: declined.id, reason, replacementId: replacement?.id ?? null, replacementNumber: replacement?.number ?? null }),
        requestId: input.requestId,
      });
      return { id: order.id, status: CustomerOrderStatus.CANCELED, replacementId: replacement?.id ?? null, replacementNumber: replacement?.number ?? null };
    });
  }, FAST_SALE_TRANSACTION_OPTIONS);
  if (!operation.replayed) {
    if (completion) publishCustomerOrderCompletion(completion);
    if (originalChange) {
      const change = originalChange as { storeId: string; oldStatus: CustomerOrderStatus; newStatus: CustomerOrderStatus };
      eventBus.publish({ type: "customerOrder.statusChanged", payload: { customerOrderId: input.customerOrderId, ...change } });
      eventBus.publish({ type: "inventory.updated", payload: { storeId: change.storeId, productId: "*" } });
    }
  }
  return operation.result;
};

/** Visibility only. Financial, stock and order lifecycle state are untouched. */
export const setCustomerOrderArchived = async (input: {
  organizationId: string;
  customerOrderId: string;
  actorId: string;
  requestId: string;
  archived: boolean;
}) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CustomerOrder" WHERE id = ${input.customerOrderId} AND "organizationId" = ${input.organizationId} AND "isPosSale" = false FOR UPDATE`;
    const order = await tx.customerOrder.findFirst({
      where: { id: input.customerOrderId, organizationId: input.organizationId, isPosSale: false },
    });
    if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    if (Boolean(order.archivedAt) === input.archived) return serializeOrder(order);
    const updated = await tx.customerOrder.update({
      where: { id: order.id },
      data: { archivedAt: input.archived ? new Date() : null },
    });
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.archived ? "CUSTOMER_ORDER_ARCHIVED" : "CUSTOMER_ORDER_RESTORED",
      entity: "CustomerOrder",
      entityId: order.id,
      before: toJson({ archivedAt: order.archivedAt }),
      after: toJson({ archivedAt: updated.archivedAt }),
      requestId: input.requestId,
    });
    return serializeOrder(updated);
  });
