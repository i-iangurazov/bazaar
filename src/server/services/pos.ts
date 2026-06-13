import {
  CashDrawerMovementType,
  CustomerOrderStatus,
  KkmMode,
  MarkingCodeStatus,
  MarkingMode,
  PosPaymentMethod,
  PosReturnStatus,
  Prisma,
  RegisterShiftStatus,
  RefundRequestStatus,
  StockMovementType,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import type { FiscalReceiptDraft } from "@/server/kkm/adapter";
import { getKkmAdapter } from "@/server/kkm/registry";
import { getLogger } from "@/server/logging";
import { currencySourceWithFallback, resolveCurrencySnapshot } from "@/lib/currencyDisplay";
import { minorUnitsToMoney, moneyToMinorUnits } from "@/lib/moneyInput";
import {
  incrementCounter,
  kkmReceiptsFailedTotal,
  kkmReceiptsQueuedTotal,
  kkmReceiptsSentTotal,
  posShiftClosedTotal,
  posShiftOpenedTotal,
} from "@/server/metrics/metrics";
import { queueFiscalReceipt } from "@/server/services/kkmConnector";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { resolveFiscalMetadataFromResult } from "@/server/services/fiscalReceiptMetadata";
import { applyStockMovement } from "@/server/services/inventory";
import { withIdempotency } from "@/server/services/idempotency";
import { toJson } from "@/server/services/json";
import { sanitizeListImageUrl } from "@/server/services/products/serializers";
import { upsertCustomerFromOrderTx } from "@/server/services/customers";
import {
  calculateCashDiscrepancyKgs,
  calculateExpectedCashKgs,
  resolveCashDifferenceStatus,
  roundCashAmount,
} from "@/server/services/posCashAccounting";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  type StoreAccessUser,
} from "@/server/services/storeAccess";

const toMoney = (value: Prisma.Decimal | number | null | undefined) =>
  typeof value === "number" ? value : value ? Number(value) : 0;
const roundMoney = roundCashAmount;
const variantKeyFrom = (variantId?: string | null) => variantId ?? "BASE";

const sumPaymentMinorUnits = (payments: Array<{ amountKgs: number }>) =>
  payments.reduce((total, payment) => total + (moneyToMinorUnits(payment.amountKgs) ?? 0), 0);

export type PosRegisterStatusFilter = "active" | "inactive" | "all";

export type PosReceiptEditLineInput = {
  lineId?: string | null;
  productId: string;
  variantId?: string | null;
  qty: number;
  unitPriceKgs: number;
};

export type PosReturnEditLineInput = {
  lineId?: string | null;
  customerOrderLineId?: string | null;
  productId: string;
  variantId?: string | null;
  qty: number;
  unitPriceKgs: number;
};

type NormalizedPosReceiptEditLine = {
  lineId: string | null;
  productId: string;
  variantId: string | null;
  variantKey: string;
  qty: number;
  unitPriceKgs: number;
  lineTotalKgs: number;
  unitCostKgs: number | null;
  lineCostTotalKgs: number | null;
};

const lineAggregateKey = (productId: string, variantKey: string) => `${productId}:${variantKey}`;

const addLineAggregateQty = (
  map: Map<string, { productId: string; variantId: string | null; variantKey: string; qty: number }>,
  input: { productId: string; variantId?: string | null; variantKey: string; qty: number },
) => {
  const key = lineAggregateKey(input.productId, input.variantKey);
  const existing = map.get(key);
  if (existing) {
    existing.qty += input.qty;
    return;
  }
  map.set(key, {
    productId: input.productId,
    variantId: input.variantId ?? null,
    variantKey: input.variantKey,
    qty: input.qty,
  });
};

const getPosRegisterReferenceCounts = async (
  tx: Prisma.TransactionClient,
  input: { organizationId: string; registerId: string },
) => {
  const [shifts, sales, saleReturns, payments, cashMovements, auditLogs] = await Promise.all([
    tx.registerShift.count({
      where: { organizationId: input.organizationId, registerId: input.registerId },
    }),
    tx.customerOrder.count({
      where: { organizationId: input.organizationId, registerId: input.registerId },
    }),
    tx.saleReturn.count({
      where: { organizationId: input.organizationId, registerId: input.registerId },
    }),
    tx.salePayment.count({
      where: {
        organizationId: input.organizationId,
        shift: { registerId: input.registerId },
      },
    }),
    tx.cashDrawerMovement.count({
      where: {
        organizationId: input.organizationId,
        shift: { registerId: input.registerId },
      },
    }),
    tx.auditLog.count({
      where: {
        organizationId: input.organizationId,
        entity: "PosRegister",
        entityId: input.registerId,
      },
    }),
  ]);

  return {
    shifts,
    sales,
    saleReturns,
    payments,
    cashMovements,
    auditLogs,
  };
};

const hasPosRegisterBusinessHistory = (
  counts: Awaited<ReturnType<typeof getPosRegisterReferenceCounts>>,
) =>
  counts.shifts > 0 ||
  counts.sales > 0 ||
  counts.saleReturns > 0 ||
  counts.payments > 0 ||
  counts.cashMovements > 0;

const resolvePosCustomerSelectionTx = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    storeId: string;
    customerId?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
    customerAddress?: string | null;
  },
) => {
  if (input.customerId) {
    const customer = await tx.customer.findFirst({
      where: {
        id: input.customerId,
        organizationId: input.organizationId,
        deletedAt: null,
      },
      select: {
        name: true,
        email: true,
        phone: true,
        address: true,
      },
    });
    if (!customer) {
      throw new AppError("customerNotFound", "NOT_FOUND", 404);
    }
    return {
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      customerAddress: customer.address,
    };
  }

  return {
    customerName: input.customerName?.trim() || null,
    customerEmail: input.customerEmail?.trim().toLowerCase() || null,
    customerPhone: input.customerPhone?.trim() || null,
    customerAddress: input.customerAddress?.trim() || null,
  };
};

const nextPosSaleNumber = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const rows = await tx.$queryRaw<Array<{ posSaleNumber: number }>>(Prisma.sql`
    INSERT INTO "OrganizationCounter" ("organizationId", "salesOrderNumber", "posSaleNumber", "posReturnNumber", "updatedAt")
    VALUES (${organizationId}, 0, 1, 0, NOW())
    ON CONFLICT ("organizationId")
    DO UPDATE SET
      "posSaleNumber" = "OrganizationCounter"."posSaleNumber" + 1,
      "updatedAt" = NOW()
    RETURNING "posSaleNumber"
  `);
  const sequence = rows[0]?.posSaleNumber;
  if (!sequence) {
    throw new AppError("posCounterFailed", "INTERNAL_SERVER_ERROR", 500);
  }
  return `S-${String(sequence).padStart(6, "0")}`;
};

const nextPosReturnNumber = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const rows = await tx.$queryRaw<Array<{ posReturnNumber: number }>>(Prisma.sql`
    INSERT INTO "OrganizationCounter" ("organizationId", "salesOrderNumber", "posSaleNumber", "posReturnNumber", "updatedAt")
    VALUES (${organizationId}, 0, 0, 1, NOW())
    ON CONFLICT ("organizationId")
    DO UPDATE SET
      "posReturnNumber" = "OrganizationCounter"."posReturnNumber" + 1,
      "updatedAt" = NOW()
    RETURNING "posReturnNumber"
  `);
  const sequence = rows[0]?.posReturnNumber;
  if (!sequence) {
    throw new AppError("posCounterFailed", "INTERNAL_SERVER_ERROR", 500);
  }
  return `SR-${String(sequence).padStart(6, "0")}`;
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
  const storeProduct = await tx.storeProduct.findFirst({
    where: {
      organizationId,
      storeId,
      productId,
      isActive: true,
    },
    select: { id: true },
  });
  if (!storeProduct) {
    throw new AppError("productNotAvailableInStore", "FORBIDDEN", 403);
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

const recomputeSaleTotals = async (
  tx: Prisma.TransactionClient,
  customerOrderId: string,
  updatedById: string,
) => {
  const aggregate = await tx.customerOrderLine.aggregate({
    where: { customerOrderId },
    _sum: { lineTotalKgs: true },
  });
  const subtotal = toMoney(aggregate._sum.lineTotalKgs);
  const sale = await tx.customerOrder.findUnique({
    where: { id: customerOrderId },
    select: { discountKgs: true },
  });
  const discount = Math.min(subtotal, Math.max(0, toMoney(sale?.discountKgs)));
  return tx.customerOrder.update({
    where: { id: customerOrderId },
    data: {
      subtotalKgs: subtotal,
      discountKgs: discount,
      totalKgs: roundMoney(Math.max(0, subtotal - discount)),
      updatedById,
    },
  });
};

const lockCustomerOrderForUpdate = async (
  tx: Prisma.TransactionClient,
  customerOrderId: string,
) => {
  await tx.$queryRaw`
    SELECT id FROM "CustomerOrder" WHERE id = ${customerOrderId} FOR UPDATE
  `;
};

const lockPosSaleDraftForEdit = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    saleId: string;
    user?: StoreAccessUser;
  },
) => {
  await lockCustomerOrderForUpdate(tx, input.saleId);
  const sale = await tx.customerOrder.findFirst({
    where: {
      id: input.saleId,
      organizationId: input.organizationId,
      isPosSale: true,
    },
    select: {
      id: true,
      status: true,
      storeId: true,
      subtotalKgs: true,
      discountKgs: true,
      totalKgs: true,
    },
  });
  if (!sale) {
    throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
  }
  if (input.user) {
    await assertUserCanAccessStore(tx, input.user, sale.storeId);
  }
  if (sale.status !== CustomerOrderStatus.DRAFT) {
    throw new AppError("posSaleNotEditable", "CONFLICT", 409);
  }
  return sale;
};

const selectPosSaleDraftSummary = {
  id: true,
  number: true,
  status: true,
  storeId: true,
  registerId: true,
  shiftId: true,
  createdAt: true,
  updatedAt: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  customerAddress: true,
  isHeld: true,
  heldAt: true,
} satisfies Prisma.CustomerOrderSelect;

const recomputeSaleReturnTotals = async (tx: Prisma.TransactionClient, saleReturnId: string) => {
  const aggregate = await tx.saleReturnLine.aggregate({
    where: { saleReturnId },
    _sum: { lineTotalKgs: true },
  });
  const total = toMoney(aggregate._sum.lineTotalKgs);
  return tx.saleReturn.update({
    where: { id: saleReturnId },
    data: {
      subtotalKgs: total,
      totalKgs: total,
    },
  });
};

const requireOpenShift = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    registerId: string;
  },
) => {
  const shift = await tx.registerShift.findFirst({
    where: {
      organizationId: input.organizationId,
      registerId: input.registerId,
      status: RegisterShiftStatus.OPEN,
    },
    orderBy: { openedAt: "desc" },
    include: {
      register: {
        select: {
          id: true,
          storeId: true,
          code: true,
          name: true,
          isActive: true,
          store: {
            select: {
              currencyCode: true,
              currencyRateKgsPerUnit: true,
            },
          },
        },
      },
    },
  });
  if (!shift) {
    throw new AppError("posShiftNotOpen", "CONFLICT", 409);
  }
  if (!shift.register.isActive) {
    throw new AppError("posRegisterInactive", "CONFLICT", 409);
  }
  return shift;
};

const normalizePayments = (
  payments: Array<{ method: PosPaymentMethod; amountKgs: number; providerRef?: string | null }>,
  options: { requirePayment?: boolean } = {},
) => {
  const normalized = payments
    .map((payment) => {
      const amountMinorUnits = moneyToMinorUnits(payment.amountKgs);
      if (amountMinorUnits === null) {
        return null;
      }
      return {
        method: payment.method,
        amountKgs: minorUnitsToMoney(amountMinorUnits),
        providerRef: payment.providerRef?.trim() || null,
      };
    })
    .filter(
      (
        payment,
      ): payment is { method: PosPaymentMethod; amountKgs: number; providerRef: string | null } =>
        Boolean(payment && payment.amountKgs > 0),
    );

  if (options.requirePayment !== false && !normalized.length) {
    throw new AppError("posPaymentMissing", "BAD_REQUEST", 400);
  }

  return normalized;
};

const normalizeMarkingCodes = (codes: string[]) => {
  const unique = new Set<string>();
  for (const raw of codes) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    unique.add(value);
  }
  return Array.from(unique);
};

const loadShiftReport = async (
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    shiftId: string;
  },
) => {
  const shift = await tx.registerShift.findFirst({
    where: { id: input.shiftId, organizationId: input.organizationId },
    include: {
      register: { select: { id: true, code: true, name: true } },
      store: {
        select: {
          id: true,
          name: true,
          code: true,
          allowNegativeStock: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
          enableSku: true,
          enableBarcode: true,
          enableSimilarProductCheck: true,
          complianceProfile: {
            select: {
              enableMarking: true,
              markingMode: true,
            },
          },
        },
      },
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
    },
  });

  if (!shift) {
    throw new AppError("posShiftNotFound", "NOT_FOUND", 404);
  }

  const [salesSummary, returnsSummary, paymentSummary, cashSummary] = await Promise.all([
    tx.customerOrder.aggregate({
      where: {
        organizationId: input.organizationId,
        isPosSale: true,
        shiftId: input.shiftId,
        status: CustomerOrderStatus.COMPLETED,
      },
      _sum: { totalKgs: true },
      _count: { _all: true },
    }),
    tx.saleReturn.aggregate({
      where: {
        organizationId: input.organizationId,
        shiftId: input.shiftId,
        status: PosReturnStatus.COMPLETED,
      },
      _sum: { totalKgs: true },
      _count: { _all: true },
    }),
    tx.salePayment.groupBy({
      by: ["method", "isRefund"],
      where: {
        organizationId: input.organizationId,
        shiftId: input.shiftId,
      },
      _sum: { amountKgs: true },
    }),
    tx.cashDrawerMovement.groupBy({
      by: ["type"],
      where: {
        organizationId: input.organizationId,
        shiftId: input.shiftId,
      },
      _sum: { amountKgs: true },
    }),
  ]);

  const salesTotalKgs = toMoney(salesSummary._sum.totalKgs);
  const returnsTotalKgs = toMoney(returnsSummary._sum.totalKgs);

  const paymentsByMethod: Record<
    PosPaymentMethod,
    { salesKgs: number; refundsKgs: number; netKgs: number }
  > = {
    CASH: { salesKgs: 0, refundsKgs: 0, netKgs: 0 },
    CARD: { salesKgs: 0, refundsKgs: 0, netKgs: 0 },
    TRANSFER: { salesKgs: 0, refundsKgs: 0, netKgs: 0 },
    OTHER: { salesKgs: 0, refundsKgs: 0, netKgs: 0 },
  };

  for (const row of paymentSummary) {
    const amount = toMoney(row._sum.amountKgs);
    if (row.isRefund) {
      paymentsByMethod[row.method].refundsKgs = roundMoney(
        paymentsByMethod[row.method].refundsKgs + amount,
      );
    } else {
      paymentsByMethod[row.method].salesKgs = roundMoney(
        paymentsByMethod[row.method].salesKgs + amount,
      );
    }
    paymentsByMethod[row.method].netKgs = roundMoney(
      paymentsByMethod[row.method].salesKgs - paymentsByMethod[row.method].refundsKgs,
    );
  }

  const payInKgs = roundMoney(
    cashSummary
      .filter((row) => row.type === CashDrawerMovementType.PAY_IN)
      .reduce((sum, row) => sum + toMoney(row._sum.amountKgs), 0),
  );
  const payOutKgs = roundMoney(
    cashSummary
      .filter((row) => row.type === CashDrawerMovementType.PAY_OUT)
      .reduce((sum, row) => sum + toMoney(row._sum.amountKgs), 0),
  );

  const cashSalesKgs = paymentsByMethod.CASH.salesKgs;
  const cashRefundsKgs = paymentsByMethod.CASH.refundsKgs;
  const expectedCashKgs = calculateExpectedCashKgs({
    openingCashKgs: toMoney(shift.openingCashKgs),
    payInKgs,
    payOutKgs,
    cashSalesKgs,
    cashRefundsKgs,
  });
  const persistedExpectedCashKgs = shift.expectedCashKgs
    ? toMoney(shift.expectedCashKgs)
    : expectedCashKgs;
  const countedCashKgs = shift.closingCashCountedKgs ? toMoney(shift.closingCashCountedKgs) : null;
  const discrepancyKgs =
    countedCashKgs === null
      ? null
      : calculateCashDiscrepancyKgs({
          countedCashKgs,
          expectedCashKgs: persistedExpectedCashKgs,
        });

  return {
    shift: {
      id: shift.id,
      status: shift.status,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      openingCashKgs: toMoney(shift.openingCashKgs),
      closingCashCountedKgs: countedCashKgs,
      expectedCashKgs: persistedExpectedCashKgs,
      discrepancyKgs,
      differenceStatus:
        discrepancyKgs === null ? null : resolveCashDifferenceStatus(discrepancyKgs),
      notes: shift.notes,
      register: shift.register,
      store: shift.store,
      openedBy: shift.openedBy,
      closedBy: shift.closedBy,
    },
    summary: {
      salesCount: salesSummary._count._all,
      salesTotalKgs: roundMoney(salesTotalKgs),
      returnsCount: returnsSummary._count._all,
      returnsTotalKgs: roundMoney(returnsTotalKgs),
      payInKgs,
      payOutKgs,
      expectedCashKgs,
    },
    paymentsByMethod,
  };
};

export const listPosRegisters = async (input: {
  organizationId: string;
  storeId?: string;
  status?: PosRegisterStatusFilter;
  user?: StoreAccessUser;
}) => {
  const status = input.status ?? "active";
  const accessibleStoreIds = input.user
    ? await resolveAccessibleStoreIds(prisma, input.user)
    : null;
  if (accessibleStoreIds && !accessibleStoreIds.length) {
    return [];
  }
  if (input.storeId && accessibleStoreIds && !accessibleStoreIds.includes(input.storeId)) {
    throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  }
  const registers = await prisma.posRegister.findMany({
    where: {
      organizationId: input.organizationId,
      ...(status === "active"
        ? { isActive: true }
        : status === "inactive"
          ? { isActive: false }
          : {}),
      ...(input.storeId
        ? { storeId: input.storeId }
        : accessibleStoreIds
          ? { storeId: { in: accessibleStoreIds } }
          : {}),
    },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          code: true,
          allowNegativeStock: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
          enableSku: true,
          enableBarcode: true,
          enableSimilarProductCheck: true,
          complianceProfile: {
            select: {
              enableMarking: true,
              markingMode: true,
            },
          },
        },
      },
      shifts: {
        orderBy: { openedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          openedAt: true,
          closedAt: true,
          openedBy: { select: { id: true, name: true } },
          closedBy: { select: { id: true, name: true } },
        },
      },
      sales: {
        where: { isPosSale: true },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          number: true,
          status: true,
          createdAt: true,
          completedAt: true,
        },
      },
      saleReturns: {
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          number: true,
          status: true,
          createdAt: true,
          completedAt: true,
        },
      },
      _count: {
        select: {
          shifts: true,
          sales: true,
          saleReturns: true,
        },
      },
    },
    orderBy: [{ store: { name: "asc" } }, { code: "asc" }],
  });

  return registers.map((register) => ({
    ...register,
    openShift: register.shifts[0]?.status === RegisterShiftStatus.OPEN ? register.shifts[0] : null,
    latestShift: register.shifts[0] ?? null,
    latestSale: register.sales[0] ?? null,
    latestSaleReturn: register.saleReturns[0] ?? null,
    lastActivityAt:
      [
        register.shifts[0]?.closedAt,
        register.shifts[0]?.openedAt,
        register.sales[0]?.completedAt,
        register.sales[0]?.createdAt,
        register.saleReturns[0]?.completedAt,
        register.saleReturns[0]?.createdAt,
      ]
        .filter((value): value is Date => Boolean(value))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    historyCounts: {
      shifts: register._count.shifts,
      sales: register._count.sales,
      saleReturns: register._count.saleReturns,
    },
    hasHistory:
      register._count.shifts > 0 || register._count.sales > 0 || register._count.saleReturns > 0,
    canDelete:
      register._count.shifts === 0 &&
      register._count.sales === 0 &&
      register._count.saleReturns === 0,
    shifts: undefined,
    sales: undefined,
    saleReturns: undefined,
    _count: undefined,
  }));
};

export const createPosRegister = async (input: {
  organizationId: string;
  storeId: string;
  name: string;
  code: string;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const store = await tx.store.findFirst({
      where: { id: input.storeId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!store) {
      throw new AppError("storeNotFound", "NOT_FOUND", 404);
    }
    if (input.user) {
      const accessibleStoreIds = await resolveAccessibleStoreIds(tx, input.user);
      if (!accessibleStoreIds.includes(input.storeId)) {
        throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
      }
    }

    const before = null;
    const created = await tx.posRegister.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        name: input.name,
        code: input.code,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_REGISTER_CREATE",
      entity: "PosRegister",
      entityId: created.id,
      before,
      after: toJson(created),
      requestId: input.requestId,
    });

    return created;
  });
};

export const updatePosRegister = async (input: {
  organizationId: string;
  registerId: string;
  storeId?: string;
  name?: string;
  code?: string;
  isActive?: boolean;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const register = await tx.posRegister.findFirst({
      where: { id: input.registerId, organizationId: input.organizationId },
    });
    if (!register) {
      throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
    }
    if (input.storeId && input.storeId !== register.storeId) {
      const nextStore = await tx.store.findFirst({
        where: { id: input.storeId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!nextStore) {
        throw new AppError("storeNotFound", "NOT_FOUND", 404);
      }
      const counts = await getPosRegisterReferenceCounts(tx, {
        organizationId: input.organizationId,
        registerId: register.id,
      });
      if (hasPosRegisterBusinessHistory(counts)) {
        throw new AppError("posRegisterStoreChangeBlockedByHistory", "CONFLICT", 409);
      }
    }
    if (input.user) {
      const accessibleStoreIds = await resolveAccessibleStoreIds(tx, input.user);
      if (!accessibleStoreIds.includes(register.storeId)) {
        throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
      }
      if (
        input.storeId &&
        input.storeId !== register.storeId &&
        !accessibleStoreIds.includes(input.storeId)
      ) {
        throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
      }
    }

    const updated = await tx.posRegister.update({
      where: { id: register.id },
      data: {
        storeId: input.storeId ?? register.storeId,
        name: input.name ?? register.name,
        code: input.code ?? register.code,
        isActive: input.isActive ?? register.isActive,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_REGISTER_UPDATE",
      entity: "PosRegister",
      entityId: register.id,
      before: toJson(register),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return updated;
  });
};

export const deletePosRegister = async (input: {
  organizationId: string;
  registerId: string;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const register = await tx.posRegister.findFirst({
      where: { id: input.registerId, organizationId: input.organizationId },
    });
    if (!register) {
      throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
    }
    if (input.user) {
      const accessibleStoreIds = await resolveAccessibleStoreIds(tx, input.user);
      if (!accessibleStoreIds.includes(register.storeId)) {
        throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
      }
    }

    const counts = await getPosRegisterReferenceCounts(tx, {
      organizationId: input.organizationId,
      registerId: register.id,
    });
    if (hasPosRegisterBusinessHistory(counts)) {
      throw new AppError("posRegisterDeleteBlockedByHistory", "CONFLICT", 409);
    }

    await tx.posRegister.delete({ where: { id: register.id } });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_REGISTER_DELETE",
      entity: "PosRegister",
      entityId: register.id,
      before: toJson({ ...register, referenceCounts: counts }),
      after: null,
      requestId: input.requestId,
    });

    return { id: register.id, deleted: true, referenceCounts: counts };
  });
};

const getPreviousClosedRegisterShift = async (input: {
  organizationId: string;
  storeId: string;
  registerId?: string;
}) => {
  const shift = await prisma.registerShift.findFirst({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      status: RegisterShiftStatus.CLOSED,
      ...(input.registerId ? { registerId: input.registerId } : {}),
    },
    include: {
      register: { select: { id: true, name: true, code: true } },
      store: {
        select: {
          id: true,
          name: true,
          code: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
        },
      },
      openedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ closedAt: "desc" }, { openedAt: "desc" }],
  });

  if (!shift) {
    return null;
  }

  const countedCashKgs =
    shift.closingCashCountedKgs === null ? null : toMoney(shift.closingCashCountedKgs);
  const expectedCashKgs = shift.expectedCashKgs === null ? null : toMoney(shift.expectedCashKgs);
  const discrepancyKgs =
    countedCashKgs === null || expectedCashKgs === null
      ? null
      : calculateCashDiscrepancyKgs({ countedCashKgs, expectedCashKgs });

  return {
    id: shift.id,
    status: shift.status,
    openedAt: shift.openedAt,
    closedAt: shift.closedAt,
    openingCashKgs: toMoney(shift.openingCashKgs),
    closingCashCountedKgs: countedCashKgs,
    expectedCashKgs,
    discrepancyKgs,
    differenceStatus: discrepancyKgs === null ? null : resolveCashDifferenceStatus(discrepancyKgs),
    register: shift.register,
    store: shift.store,
    openedBy: shift.openedBy,
    closedBy: shift.closedBy,
  };
};

export const getPosEntry = async (input: {
  organizationId: string;
  registerId?: string;
  user?: StoreAccessUser;
}) => {
  const registers = await listPosRegisters({
    organizationId: input.organizationId,
    user: input.user,
  });
  if (!registers.length) {
    return {
      registers: [],
      selectedRegister: null,
      currentShift: null,
      previousClosedShift: null,
    };
  }

  const selectedRegister =
    registers.find((register) => register.id === input.registerId) ?? registers[0] ?? null;

  const currentShift = selectedRegister?.openShift
    ? await getCurrentRegisterShift({
        organizationId: input.organizationId,
        registerId: selectedRegister.id,
        user: input.user,
      })
    : null;
  const previousClosedShift = selectedRegister
    ? await getPreviousClosedRegisterShift({
        organizationId: input.organizationId,
        storeId: selectedRegister.storeId,
        registerId: selectedRegister.id,
      })
    : null;

  return {
    registers,
    selectedRegister,
    currentShift,
    previousClosedShift,
  };
};

export const openRegisterShift = async (input: {
  organizationId: string;
  registerId: string;
  openingCashKgs: number;
  notes?: string | null;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
  idempotencyKey: string;
}) => {
  const result = await prisma.$transaction(async (tx) => {
    const { result: shift } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "pos.shifts.open",
        userId: input.actorId,
      },
      async () => {
        const register = await tx.posRegister.findFirst({
          where: { id: input.registerId, organizationId: input.organizationId },
          select: {
            id: true,
            isActive: true,
            storeId: true,
            code: true,
            store: {
              select: {
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
          },
        });
        if (!register) {
          throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
        }
        if (!register.isActive) {
          throw new AppError("posRegisterInactive", "CONFLICT", 409);
        }
        if (input.user) {
          await assertUserCanAccessStore(tx, input.user, register.storeId);
        }

        const current = await tx.registerShift.findFirst({
          where: {
            organizationId: input.organizationId,
            registerId: input.registerId,
            status: RegisterShiftStatus.OPEN,
          },
          select: { id: true },
        });
        if (current) {
          throw new AppError("posShiftAlreadyOpen", "CONFLICT", 409);
        }

        const created = await tx.registerShift.create({
          data: {
            organizationId: input.organizationId,
            storeId: register.storeId,
            registerId: register.id,
            status: RegisterShiftStatus.OPEN,
            openedById: input.actorId,
            openingCashKgs: roundMoney(input.openingCashKgs),
            ...resolveCurrencySnapshot(register.store),
            notes: input.notes ?? null,
          },
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "POS_SHIFT_OPEN",
          entity: "RegisterShift",
          entityId: created.id,
          before: null,
          after: toJson(created),
          requestId: input.requestId,
        });

        return {
          id: created.id,
          registerId: created.registerId,
          storeId: created.storeId,
          status: created.status,
          openedAt: created.openedAt,
        };
      },
    );

    return shift;
  });

  eventBus.publish({
    type: "shift.opened",
    payload: { shiftId: result.id, storeId: result.storeId, registerId: result.registerId },
  });
  incrementCounter(posShiftOpenedTotal);

  return result;
};

export const getCurrentRegisterShift = async (input: {
  organizationId: string;
  registerId: string;
  user?: StoreAccessUser;
}) => {
  const shift = await prisma.registerShift.findFirst({
    where: {
      organizationId: input.organizationId,
      registerId: input.registerId,
      status: RegisterShiftStatus.OPEN,
    },
    include: {
      register: { select: { id: true, name: true, code: true } },
      store: {
        select: {
          id: true,
          name: true,
          code: true,
          allowNegativeStock: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
          complianceProfile: {
            select: {
              enableMarking: true,
              markingMode: true,
            },
          },
        },
      },
      openedBy: { select: { id: true, name: true } },
    },
    orderBy: { openedAt: "desc" },
  });

  if (!shift) {
    return null;
  }
  if (input.user) {
    await assertUserCanAccessStore(prisma, input.user, shift.store.id);
  }

  const heldReceiptWhere = {
    organizationId: input.organizationId,
    shiftId: shift.id,
    isPosSale: true,
    status: CustomerOrderStatus.DRAFT,
    isHeld: true,
  } satisfies Prisma.CustomerOrderWhereInput;
  const [heldReceipts, heldReceiptCount] = await Promise.all([
    prisma.customerOrder.findMany({
      where: heldReceiptWhere,
      select: {
        id: true,
        number: true,
        heldAt: true,
        totalKgs: true,
      },
      orderBy: { heldAt: "asc" },
      take: 20,
    }),
    prisma.customerOrder.count({ where: heldReceiptWhere }),
  ]);

  return {
    ...shift,
    heldReceipts: heldReceipts.map((receipt) => ({
      id: receipt.id,
      number: receipt.number,
      heldAt: receipt.heldAt,
      totalKgs: toMoney(receipt.totalKgs),
    })),
    heldReceiptCount,
    openingCashKgs: toMoney(shift.openingCashKgs),
    closingCashCountedKgs: shift.closingCashCountedKgs
      ? toMoney(shift.closingCashCountedKgs)
      : null,
    expectedCashKgs: shift.expectedCashKgs ? toMoney(shift.expectedCashKgs) : null,
  };
};

export const listRegisterShifts = async (input: {
  organizationId: string;
  registerId?: string;
  storeId?: string;
  page: number;
  pageSize: number;
}) => {
  const where: Prisma.RegisterShiftWhereInput = {
    organizationId: input.organizationId,
    ...(input.registerId ? { registerId: input.registerId } : {}),
    ...(input.storeId ? { storeId: input.storeId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.registerShift.count({ where }),
    prisma.registerShift.findMany({
      where,
      include: {
        register: { select: { id: true, name: true, code: true } },
        store: {
          select: {
            id: true,
            name: true,
            code: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
      },
      orderBy: { openedAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      openingCashKgs: toMoney(item.openingCashKgs),
      closingCashCountedKgs: item.closingCashCountedKgs
        ? toMoney(item.closingCashCountedKgs)
        : null,
      expectedCashKgs: item.expectedCashKgs ? toMoney(item.expectedCashKgs) : null,
      discrepancyKgs:
        item.expectedCashKgs && item.closingCashCountedKgs
          ? calculateCashDiscrepancyKgs({
              countedCashKgs: toMoney(item.closingCashCountedKgs),
              expectedCashKgs: toMoney(item.expectedCashKgs),
            })
          : null,
      differenceStatus:
        item.expectedCashKgs && item.closingCashCountedKgs
          ? resolveCashDifferenceStatus(
              calculateCashDiscrepancyKgs({
                countedCashKgs: toMoney(item.closingCashCountedKgs),
                expectedCashKgs: toMoney(item.expectedCashKgs),
              }),
            )
          : null,
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const getShiftXReport = async (input: { organizationId: string; shiftId: string }) => {
  return prisma.$transaction(async (tx) => loadShiftReport(tx, input));
};

export const closeRegisterShift = async (input: {
  organizationId: string;
  shiftId: string;
  closingCashCountedKgs: number;
  notes?: string | null;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
  idempotencyKey: string;
}) => {
  const result = await prisma.$transaction(async (tx) => {
    const { result: closedShift } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "pos.shifts.close",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT id FROM "RegisterShift" WHERE id = ${input.shiftId} FOR UPDATE
        `;

        const shift = await tx.registerShift.findFirst({
          where: { id: input.shiftId, organizationId: input.organizationId },
        });
        if (!shift) {
          throw new AppError("posShiftNotFound", "NOT_FOUND", 404);
        }
        if (input.user) {
          const accessibleStoreIds = await resolveAccessibleStoreIds(tx, input.user);
          if (!accessibleStoreIds.includes(shift.storeId)) {
            throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
          }
        }

        if (shift.status === RegisterShiftStatus.CLOSED) {
          return {
            id: shift.id,
            registerId: shift.registerId,
            storeId: shift.storeId,
            status: shift.status,
            closedAt: shift.closedAt,
            expectedCashKgs: shift.expectedCashKgs ? toMoney(shift.expectedCashKgs) : 0,
            closingCashCountedKgs: shift.closingCashCountedKgs
              ? toMoney(shift.closingCashCountedKgs)
              : null,
            discrepancyKgs:
              shift.expectedCashKgs && shift.closingCashCountedKgs
                ? calculateCashDiscrepancyKgs({
                    countedCashKgs: toMoney(shift.closingCashCountedKgs),
                    expectedCashKgs: toMoney(shift.expectedCashKgs),
                  })
                : null,
          };
        }

        const heldReceipts = await tx.customerOrder.findMany({
          where: {
            organizationId: input.organizationId,
            shiftId: shift.id,
            isPosSale: true,
            status: CustomerOrderStatus.DRAFT,
            isHeld: true,
          },
          select: {
            number: true,
          },
          orderBy: { heldAt: "asc" },
          take: 10,
        });

        if (heldReceipts.length) {
          throw new AppError("posHeldReceiptsOpen", "CONFLICT", 409);
        }

        const report = await loadShiftReport(tx, {
          organizationId: input.organizationId,
          shiftId: shift.id,
        });

        const counted = roundMoney(input.closingCashCountedKgs);
        const expected = roundMoney(report.summary.expectedCashKgs);
        const discrepancy = calculateCashDiscrepancyKgs({
          countedCashKgs: counted,
          expectedCashKgs: expected,
        });
        const closingNotes = input.notes?.trim() || null;

        if (Math.abs(discrepancy) > 0.009 && !closingNotes) {
          throw new AppError("posShiftDifferenceNoteRequired", "BAD_REQUEST", 400);
        }

        const updated = await tx.registerShift.update({
          where: { id: shift.id },
          data: {
            status: RegisterShiftStatus.CLOSED,
            closedAt: new Date(),
            closedById: input.actorId,
            closingCashCountedKgs: counted,
            expectedCashKgs: expected,
            notes: closingNotes ?? shift.notes,
          },
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "POS_SHIFT_CLOSE",
          entity: "RegisterShift",
          entityId: shift.id,
          before: toJson(shift),
          after: toJson(updated),
          requestId: input.requestId,
        });

        return {
          id: updated.id,
          registerId: updated.registerId,
          storeId: updated.storeId,
          status: updated.status,
          closedAt: updated.closedAt,
          expectedCashKgs: expected,
          closingCashCountedKgs: counted,
          discrepancyKgs: discrepancy,
        };
      },
    );

    return closedShift;
  });

  eventBus.publish({
    type: "shift.closed",
    payload: { shiftId: result.id, storeId: result.storeId, registerId: result.registerId },
  });
  incrementCounter(posShiftClosedTotal);

  return result;
};

export const createPosSaleDraft = async (input: {
  organizationId: string;
  registerId: string;
  customerId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
  lines?: Array<{ productId: string; variantId?: string | null; qty: number }>;
}) => {
  const createDraftInTransaction = async () =>
    prisma.$transaction(async (tx) => {
      const shift = await requireOpenShift(tx, {
        organizationId: input.organizationId,
        registerId: input.registerId,
      });
      if (input.user) {
        await assertUserCanAccessStore(tx, input.user, shift.storeId);
      }
      const hasCustomerInput =
        input.customerId !== undefined ||
        input.customerName !== undefined ||
        input.customerEmail !== undefined ||
        input.customerPhone !== undefined ||
        input.customerAddress !== undefined;
      const selectedCustomer = hasCustomerInput
        ? await resolvePosCustomerSelectionTx(tx, {
            organizationId: input.organizationId,
            storeId: shift.storeId,
            customerId: input.customerId,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone,
            customerAddress: input.customerAddress,
          })
        : null;

      const existingDraft = await tx.customerOrder.findFirst({
        where: {
          organizationId: input.organizationId,
          registerId: shift.registerId,
          createdById: input.actorId,
          isPosSale: true,
          status: CustomerOrderStatus.DRAFT,
          isHeld: false,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          storeId: true,
          registerId: true,
          shiftId: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          customerAddress: true,
          isHeld: true,
          heldAt: true,
          shift: {
            select: {
              status: true,
            },
          },
        },
      });

      if (existingDraft) {
        // If an old draft is tied to a closed shift, archive it and create a fresh draft.
        if (existingDraft.shift?.status !== RegisterShiftStatus.OPEN) {
          await tx.customerOrder.update({
            where: { id: existingDraft.id },
            data: {
              status: CustomerOrderStatus.CANCELED,
              updatedById: input.actorId,
            },
          });
        } else {
          if (selectedCustomer) {
            const updated = await tx.customerOrder.update({
              where: { id: existingDraft.id },
              data: {
                customerName: selectedCustomer.customerName,
                customerEmail: selectedCustomer.customerEmail,
                customerPhone: selectedCustomer.customerPhone,
                customerAddress: selectedCustomer.customerAddress,
                updatedById: input.actorId,
              },
              select: {
                id: true,
                number: true,
                status: true,
                storeId: true,
                registerId: true,
                shiftId: true,
                customerName: true,
                customerEmail: true,
                customerPhone: true,
                customerAddress: true,
                isHeld: true,
                heldAt: true,
              },
            });
            return updated;
          }
          return {
            id: existingDraft.id,
            number: existingDraft.number,
            status: existingDraft.status,
            storeId: existingDraft.storeId,
            registerId: existingDraft.registerId,
            shiftId: existingDraft.shiftId,
            customerName: existingDraft.customerName,
            customerEmail: existingDraft.customerEmail,
            customerPhone: existingDraft.customerPhone,
            customerAddress: existingDraft.customerAddress,
            isHeld: existingDraft.isHeld,
            heldAt: existingDraft.heldAt,
          };
        }
      }

      const number = await nextPosSaleNumber(tx, input.organizationId);
      const transactionCurrency = resolveCurrencySnapshot(
        currencySourceWithFallback(shift, shift.register.store),
      );
      const order = await tx.customerOrder.create({
        data: {
          organizationId: input.organizationId,
          storeId: shift.storeId,
          registerId: shift.registerId,
          shiftId: shift.id,
          number,
          isPosSale: true,
          status: CustomerOrderStatus.DRAFT,
          isHeld: false,
          customerName: selectedCustomer?.customerName ?? null,
          customerEmail: selectedCustomer?.customerEmail ?? null,
          customerPhone: selectedCustomer?.customerPhone ?? null,
          customerAddress: selectedCustomer?.customerAddress ?? null,
          notes: input.notes ?? null,
          ...transactionCurrency,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
      });

      await upsertCustomerFromOrderTx(tx, {
        organizationId: input.organizationId,
        storeId: shift.storeId,
        customerName: selectedCustomer?.customerName,
        customerEmail: selectedCustomer?.customerEmail,
        customerPhone: selectedCustomer?.customerPhone,
        countOrder: false,
      });

      if (input.lines?.length) {
        for (const lineInput of input.lines) {
          const resolved = await resolveUnitPrice({
            tx,
            organizationId: input.organizationId,
            storeId: shift.storeId,
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

          await tx.customerOrderLine.create({
            data: {
              customerOrderId: order.id,
              productId: lineInput.productId,
              variantId: lineInput.variantId ?? null,
              variantKey: resolved.variantKey,
              qty: lineInput.qty,
              unitPriceKgs: resolved.unitPrice,
              lineTotalKgs: roundMoney(resolved.unitPrice * lineInput.qty),
              unitCostKgs: unitCost,
              lineCostTotalKgs: unitCost === null ? null : roundMoney(unitCost * lineInput.qty),
            },
          });
        }
        await recomputeSaleTotals(tx, order.id, input.actorId);
      }

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "POS_SALE_CREATE",
        entity: "CustomerOrder",
        entityId: order.id,
        before: null,
        after: toJson(order),
        requestId: input.requestId,
      });

      return {
        id: order.id,
        number: order.number,
        status: order.status,
        storeId: order.storeId,
        registerId: order.registerId,
        shiftId: order.shiftId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        isHeld: order.isHeld,
        heldAt: order.heldAt,
      };
    });

  try {
    return await createDraftInTransaction();
  } catch (error) {
    // If another request created the draft first, return that draft from a fresh query context.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrentDraft = await prisma.customerOrder.findFirst({
        where: {
          organizationId: input.organizationId,
          registerId: input.registerId,
          createdById: input.actorId,
          isPosSale: true,
          status: CustomerOrderStatus.DRAFT,
          isHeld: false,
          shift: {
            status: RegisterShiftStatus.OPEN,
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          storeId: true,
          registerId: true,
          shiftId: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          customerAddress: true,
          isHeld: true,
          heldAt: true,
        },
      });
      if (concurrentDraft) {
        return concurrentDraft;
      }
    }

    throw error;
  }
};

export const getActivePosSaleDraft = async (input: {
  organizationId: string;
  registerId: string;
  actorId: string;
  user?: StoreAccessUser;
}) => {
  if (input.user) {
    const register = await prisma.posRegister.findFirst({
      where: { id: input.registerId, organizationId: input.organizationId },
      select: { storeId: true },
    });
    if (!register) {
      throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
    }
    await assertUserCanAccessStore(prisma, input.user, register.storeId);
  }

  const draft = await prisma.customerOrder.findFirst({
    where: {
      organizationId: input.organizationId,
      registerId: input.registerId,
      createdById: input.actorId,
      isPosSale: true,
      status: CustomerOrderStatus.DRAFT,
      isHeld: false,
      shift: {
        status: RegisterShiftStatus.OPEN,
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      storeId: true,
      registerId: true,
      shiftId: true,
      createdAt: true,
      updatedAt: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      customerAddress: true,
      isHeld: true,
      heldAt: true,
    },
  });
  return draft;
};

export const holdPosSaleDraft = async (input: {
  organizationId: string;
  saleId: string;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    await lockCustomerOrderForUpdate(tx, input.saleId);
    const sale = await tx.customerOrder.findFirst({
      where: {
        id: input.saleId,
        organizationId: input.organizationId,
        isPosSale: true,
      },
      select: {
        ...selectPosSaleDraftSummary,
        lines: { select: { id: true } },
      },
    });
    if (!sale) {
      throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    }
    if (input.user) {
      await assertUserCanAccessStore(tx, input.user, sale.storeId);
    }
    if (sale.status !== CustomerOrderStatus.DRAFT) {
      throw new AppError("posSaleNotEditable", "CONFLICT", 409);
    }
    if (!sale.lines.length) {
      throw new AppError("posHeldReceiptEmpty", "BAD_REQUEST", 400);
    }
    if (sale.isHeld) {
      const { lines, ...saleSummary } = sale;
      return {
        ...saleSummary,
        lineCount: lines.length,
      };
    }

    const updated = await tx.customerOrder.update({
      where: { id: sale.id },
      data: {
        isHeld: true,
        heldAt: new Date(),
        heldById: input.actorId,
        updatedById: input.actorId,
      },
      select: selectPosSaleDraftSummary,
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_SALE_HOLD",
      entity: "CustomerOrder",
      entityId: sale.id,
      before: toJson({ isHeld: sale.isHeld, lineCount: sale.lines.length }),
      after: toJson({ isHeld: updated.isHeld, heldAt: updated.heldAt }),
      requestId: input.requestId,
    });

    return {
      ...updated,
      lineCount: sale.lines.length,
    };
  });
};

export const resumeHeldPosSaleDraft = async (input: {
  organizationId: string;
  saleId: string;
  registerId: string;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const shift = await requireOpenShift(tx, {
      organizationId: input.organizationId,
      registerId: input.registerId,
    });
    if (input.user) {
      await assertUserCanAccessStore(tx, input.user, shift.storeId);
    }

    await lockCustomerOrderForUpdate(tx, input.saleId);
    const sale = await tx.customerOrder.findFirst({
      where: {
        id: input.saleId,
        organizationId: input.organizationId,
        isPosSale: true,
      },
      select: {
        id: true,
        status: true,
        storeId: true,
        registerId: true,
        shiftId: true,
        isHeld: true,
        lines: { select: { id: true } },
      },
    });
    if (!sale) {
      throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    }
    if (sale.status !== CustomerOrderStatus.DRAFT || !sale.isHeld) {
      throw new AppError("posHeldReceiptNotFound", "CONFLICT", 409);
    }
    if (sale.storeId !== shift.storeId) {
      throw new AppError("posHeldReceiptStoreMismatch", "CONFLICT", 409);
    }

    const activeDraft = await tx.customerOrder.findFirst({
      where: {
        organizationId: input.organizationId,
        registerId: shift.registerId,
        createdById: input.actorId,
        isPosSale: true,
        status: CustomerOrderStatus.DRAFT,
        isHeld: false,
        id: { not: sale.id },
        shift: {
          status: RegisterShiftStatus.OPEN,
        },
      },
      include: {
        lines: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (activeDraft?.lines.length) {
      throw new AppError("posActiveDraftExists", "CONFLICT", 409);
    }
    if (activeDraft) {
      await tx.customerOrder.update({
        where: { id: activeDraft.id },
        data: {
          status: CustomerOrderStatus.CANCELED,
          updatedById: input.actorId,
        },
      });
    }

    const updated = await tx.customerOrder.update({
      where: { id: sale.id },
      data: {
        registerId: shift.registerId,
        shiftId: shift.id,
        isHeld: false,
        heldAt: null,
        heldById: null,
        updatedById: input.actorId,
      },
      select: selectPosSaleDraftSummary,
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_SALE_RESUME_HELD",
      entity: "CustomerOrder",
      entityId: sale.id,
      before: toJson({
        isHeld: sale.isHeld,
        registerId: sale.registerId,
        shiftId: sale.shiftId,
      }),
      after: toJson({
        isHeld: updated.isHeld,
        registerId: updated.registerId,
        shiftId: updated.shiftId,
      }),
      requestId: input.requestId,
    });

    return {
      ...updated,
      lineCount: sale.lines.length,
    };
  });
};

export const updatePosSaleCustomer = async (input: {
  organizationId: string;
  saleId: string;
  customerId?: string | null;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.customerOrder.findFirst({
      where: {
        id: input.saleId,
        organizationId: input.organizationId,
        isPosSale: true,
      },
      select: {
        id: true,
        status: true,
        storeId: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        customerAddress: true,
      },
    });
    if (!sale) {
      throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    }
    if (input.user) {
      await assertUserCanAccessStore(tx, input.user, sale.storeId);
    }
    if (sale.status !== CustomerOrderStatus.DRAFT) {
      throw new AppError("posSaleNotEditable", "CONFLICT", 409);
    }

    const selectedCustomer = input.customerId
      ? await resolvePosCustomerSelectionTx(tx, {
          organizationId: input.organizationId,
          storeId: sale.storeId,
          customerId: input.customerId,
        })
      : {
          customerName: null,
          customerEmail: null,
          customerPhone: null,
          customerAddress: null,
        };

    const updated = await tx.customerOrder.update({
      where: { id: sale.id },
      data: {
        customerName: selectedCustomer.customerName,
        customerEmail: selectedCustomer.customerEmail,
        customerPhone: selectedCustomer.customerPhone,
        customerAddress: selectedCustomer.customerAddress,
        updatedById: input.actorId,
      },
      select: {
        id: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        customerAddress: true,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_SALE_CUSTOMER_UPDATE",
      entity: "CustomerOrder",
      entityId: sale.id,
      before: toJson({
        customerName: sale.customerName,
        customerEmail: sale.customerEmail,
        customerPhone: sale.customerPhone,
        customerAddress: sale.customerAddress,
      }),
      after: toJson({
        customerName: updated.customerName,
        customerEmail: updated.customerEmail,
        customerPhone: updated.customerPhone,
        customerAddress: updated.customerAddress,
      }),
      requestId: input.requestId,
    });

    return updated;
  });
};

export const cancelPosSaleDraft = async (input: {
  organizationId: string;
  saleId: string;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.customerOrder.findFirst({
      where: {
        id: input.saleId,
        organizationId: input.organizationId,
        isPosSale: true,
      },
      include: {
        lines: {
          select: { id: true },
        },
      },
    });
    if (!sale) {
      throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    }
    if (input.user) {
      await assertUserCanAccessStore(tx, input.user, sale.storeId);
    }
    if (sale.status !== CustomerOrderStatus.DRAFT) {
      throw new AppError("posSaleNotEditable", "CONFLICT", 409);
    }

    const canceled = await tx.customerOrder.update({
      where: { id: sale.id },
      data: {
        status: CustomerOrderStatus.CANCELED,
        updatedById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_SALE_DRAFT_CANCEL",
      entity: "CustomerOrder",
      entityId: sale.id,
      before: toJson({ status: sale.status, linesCount: sale.lines.length }),
      after: toJson({ status: canceled.status }),
      requestId: input.requestId,
    });

    return {
      id: canceled.id,
      number: canceled.number,
      status: canceled.status,
    };
  });
};

export const listPosSales = async (input: {
  organizationId: string;
  storeId?: string;
  registerId?: string;
  search?: string;
  statuses?: CustomerOrderStatus[];
  cashierId?: string;
  paymentMethod?: PosPaymentMethod;
  returnState?: "none" | "returned";
  heldState?: "held" | "active";
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
  user?: StoreAccessUser;
}) => {
  let accessibleStoreIds: string[] | null = null;
  if (input.user) {
    if (input.storeId) {
      await assertUserCanAccessStore(prisma, input.user, input.storeId);
    } else {
      accessibleStoreIds = await resolveAccessibleStoreIds(prisma, input.user);
      if (!accessibleStoreIds.length) {
        return {
          items: [],
          total: 0,
          page: input.page,
          pageSize: input.pageSize,
        };
      }
    }
  }

  const where: Prisma.CustomerOrderWhereInput = {
    organizationId: input.organizationId,
    isPosSale: true,
    ...(input.storeId
      ? { storeId: input.storeId }
      : accessibleStoreIds
        ? { storeId: { in: accessibleStoreIds } }
        : {}),
    ...(input.registerId ? { registerId: input.registerId } : {}),
    ...(input.cashierId ? { createdById: input.cashierId } : {}),
    ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
    ...(input.heldState === "held"
      ? { isHeld: true }
      : input.heldState === "active"
        ? { isHeld: false }
        : {}),
    ...(input.paymentMethod
      ? { payments: { some: { method: input.paymentMethod, isRefund: false } } }
      : {}),
    ...(input.returnState === "none"
      ? { saleReturns: { none: { status: PosReturnStatus.COMPLETED } } }
      : input.returnState === "returned"
        ? { saleReturns: { some: { status: PosReturnStatus.COMPLETED } } }
        : {}),
    ...(input.search
      ? {
          OR: [
            { number: { contains: input.search, mode: "insensitive" } },
            { customerName: { contains: input.search, mode: "insensitive" } },
            { customerPhone: { contains: input.search, mode: "insensitive" } },
            { store: { name: { contains: input.search, mode: "insensitive" } } },
            { store: { code: { contains: input.search, mode: "insensitive" } } },
            { createdBy: { name: { contains: input.search, mode: "insensitive" } } },
            { createdBy: { email: { contains: input.search, mode: "insensitive" } } },
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
        store: {
          select: {
            id: true,
            name: true,
            code: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
        register: { select: { id: true, name: true, code: true } },
        shift: {
          select: {
            id: true,
            openedAt: true,
            closedAt: true,
            status: true,
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        payments: {
          select: {
            id: true,
            method: true,
            amountKgs: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
            isRefund: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        saleReturns: {
          where: { status: PosReturnStatus.COMPLETED },
          select: {
            id: true,
            totalKgs: true,
            completedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    items: items.map((item) => ({
      returnedTotalKgs: roundMoney(
        item.saleReturns.reduce((sum, row) => sum + toMoney(row.totalKgs), 0),
      ),
      ...item,
      cashier: item.createdBy,
      isHeld: item.isHeld,
      heldAt: item.heldAt,
      shift: item.shift,
      subtotalKgs: toMoney(item.subtotalKgs),
      discountKgs: toMoney(item.discountKgs),
      totalKgs: toMoney(item.totalKgs),
      payments: item.payments.map((payment) => ({
        ...payment,
        amountKgs: toMoney(payment.amountKgs),
      })),
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const listPosDebts = async (input: {
  organizationId: string;
  storeId?: string;
  registerId?: string;
  search?: string;
  page: number;
  pageSize: number;
}) => {
  const search = input.search?.trim().replace(/\s+/g, " ");
  const where: Prisma.CustomerOrderWhereInput = {
    organizationId: input.organizationId,
    isPosSale: true,
    isDebt: true,
    debtSettledAt: null,
    status: CustomerOrderStatus.COMPLETED,
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.registerId ? { registerId: input.registerId } : {}),
    ...(search
      ? {
          OR: [
            { debtCustomerName: { contains: search, mode: "insensitive" } },
            { customerName: { contains: search, mode: "insensitive" } },
            { number: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

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
        register: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            variant: { select: { id: true, name: true } },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: { completedAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      number: item.number,
      completedAt: item.completedAt,
      createdAt: item.createdAt,
      customerName: item.debtCustomerName ?? item.customerName,
      debtCustomerName: item.debtCustomerName,
      subtotalKgs: toMoney(item.subtotalKgs),
      discountKgs: toMoney(item.discountKgs),
      totalKgs: toMoney(item.totalKgs),
      currencyCode: item.currencyCode,
      currencyRateKgsPerUnit: item.currencyRateKgsPerUnit,
      store: item.store,
      register: item.register,
      lines: item.lines.map((line) => ({
        id: line.id,
        qty: line.qty,
        unitPriceKgs: toMoney(line.unitPriceKgs),
        lineTotalKgs: toMoney(line.lineTotalKgs),
        product: line.product,
        variant: line.variant,
      })),
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const settlePosDebt = async (input: {
  organizationId: string;
  saleId: string;
  registerId: string;
  method: PosPaymentMethod;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
}) => {
  const result = await prisma.$transaction(async (tx) => {
    const { result: settlement, replayed } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "pos.debts.settle",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT id FROM "CustomerOrder" WHERE id = ${input.saleId} FOR UPDATE
        `;
        const sale = await tx.customerOrder.findFirst({
          where: {
            id: input.saleId,
            organizationId: input.organizationId,
            isPosSale: true,
          },
          include: {
            store: {
              select: {
                id: true,
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
          },
        });
        if (!sale) {
          throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
        }
        if (sale.status !== CustomerOrderStatus.COMPLETED || !sale.isDebt) {
          throw new AppError("posDebtNotFound", "NOT_FOUND", 404);
        }
        if (sale.debtSettledAt) {
          return {
            id: sale.id,
            number: sale.number,
            storeId: sale.storeId,
            registerId: sale.registerId,
            shiftId: sale.shiftId,
            alreadySettled: true,
          };
        }

        const shift = await requireOpenShift(tx, {
          organizationId: input.organizationId,
          registerId: input.registerId,
        });
        if (shift.storeId !== sale.storeId) {
          throw new AppError("posDebtStoreMismatch", "CONFLICT", 409);
        }

        const transactionCurrency = resolveCurrencySnapshot(
          currencySourceWithFallback(sale, currencySourceWithFallback(shift, sale.store)),
        );
        const amountKgs = roundMoney(toMoney(sale.totalKgs));
        if (amountKgs <= 0) {
          throw new AppError("posDebtAmountInvalid", "BAD_REQUEST", 400);
        }

        await tx.salePayment.create({
          data: {
            organizationId: input.organizationId,
            storeId: sale.storeId,
            shiftId: shift.id,
            customerOrderId: sale.id,
            method: input.method,
            amountKgs,
            ...transactionCurrency,
            providerRef: `debt:${sale.number}`,
            isRefund: false,
            createdById: input.actorId,
          },
        });

        const updated = await tx.customerOrder.update({
          where: { id: sale.id },
          data: {
            debtSettledAt: new Date(),
            debtSettledById: input.actorId,
            updatedById: input.actorId,
          },
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "POS_DEBT_SETTLE",
          entity: "CustomerOrder",
          entityId: sale.id,
          before: toJson({ debtSettledAt: sale.debtSettledAt }),
          after: toJson({ debtSettledAt: updated.debtSettledAt, amountKgs }),
          requestId: input.requestId,
        });

        return {
          id: updated.id,
          number: updated.number,
          storeId: updated.storeId,
          registerId: shift.registerId,
          shiftId: shift.id,
          alreadySettled: false,
        };
      },
    );

    return { ...settlement, replayed };
  });

  if (!result.replayed && !result.alreadySettled) {
    eventBus.publish({
      type: "debt.settled",
      payload: {
        saleId: result.id,
        storeId: result.storeId,
        registerId: result.registerId ?? null,
        shiftId: result.shiftId ?? null,
        number: result.number,
      },
    });
  }

  return result;
};

export const getPosSale = async (input: {
  organizationId: string;
  saleId: string;
  user?: StoreAccessUser;
}) => {
  const sale = await prisma.customerOrder.findFirst({
    where: {
      id: input.saleId,
      organizationId: input.organizationId,
      isPosSale: true,
    },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          code: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
          complianceProfile: {
            select: {
              enableMarking: true,
              markingMode: true,
            },
          },
        },
      },
      register: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      shift: {
        select: {
          id: true,
          status: true,
          openedAt: true,
          closedAt: true,
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
              isBundle: true,
              images: {
                where: {
                  url: {
                    not: { startsWith: "data:image/" },
                  },
                },
                select: { url: true },
                orderBy: { position: "asc" },
                take: 1,
              },
              complianceFlags: {
                select: {
                  requiresMarking: true,
                  markingType: true,
                },
              },
              baseUnit: { select: { code: true, labelRu: true, labelKg: true } },
            },
          },
          variant: {
            select: {
              id: true,
              name: true,
              image: { select: { url: true } },
            },
          },
          markingCodeCaptures: {
            where: { status: MarkingCodeStatus.CAPTURED },
            select: { id: true, code: true, status: true, capturedAt: true },
            orderBy: { capturedAt: "asc" },
          },
        },
        orderBy: { id: "asc" },
      },
      payments: {
        orderBy: { createdAt: "asc" },
      },
      saleReturns: {
        include: {
          lines: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!sale) {
    return null;
  }
  if (input.user) {
    await assertUserCanAccessStore(prisma, input.user, sale.storeId);
  }

  return {
    ...sale,
    cashier: sale.createdBy,
    subtotalKgs: toMoney(sale.subtotalKgs),
    discountKgs: toMoney(sale.discountKgs),
    totalKgs: toMoney(sale.totalKgs),
    lines: sale.lines.map((line) => {
      const { images, photoUrl, ...product } = line.product;
      return {
        ...line,
        product: {
          ...product,
          primaryImage:
            sanitizeListImageUrl(line.variant?.image?.url) ??
            sanitizeListImageUrl(images[0]?.url) ??
            sanitizeListImageUrl(photoUrl) ??
            null,
        },
        unitPriceKgs: toMoney(line.unitPriceKgs),
        lineTotalKgs: toMoney(line.lineTotalKgs),
        unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
        lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
        markingCodes: line.markingCodeCaptures.map((capture) => capture.code),
      };
    }),
    payments: sale.payments.map((payment) => ({
      ...payment,
      amountKgs: toMoney(payment.amountKgs),
    })),
    saleReturns: sale.saleReturns.map((saleReturn) => ({
      ...saleReturn,
      subtotalKgs: toMoney(saleReturn.subtotalKgs),
      totalKgs: toMoney(saleReturn.totalKgs),
      lines: saleReturn.lines.map((line) => ({
        ...line,
        unitPriceKgs: toMoney(line.unitPriceKgs),
        lineTotalKgs: toMoney(line.lineTotalKgs),
        unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
        lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
      })),
    })),
  };
};

export const editCompletedPosSale = async (input: {
  organizationId: string;
  saleId: string;
  lines: PosReceiptEditLineInput[];
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  reason?: string | null;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
  idempotencyKey: string;
}) => {
  if (!input.lines.length) {
    throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const { result: editResult, replayed } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "pos.sales.editCompleted",
        userId: input.actorId,
      },
      async () => {
        await lockCustomerOrderForUpdate(tx, input.saleId);

        const sale = await tx.customerOrder.findFirst({
          where: {
            id: input.saleId,
            organizationId: input.organizationId,
            isPosSale: true,
          },
          include: {
            lines: {
              include: {
                saleReturnLines: { select: { id: true } },
                markingCodeCaptures: { select: { id: true } },
              },
              orderBy: { id: "asc" },
            },
            payments: {
              orderBy: { createdAt: "asc" },
            },
            store: {
              select: {
                id: true,
                currencyCode: true,
                currencyRateKgsPerUnit: true,
                allowNegativeStock: true,
              },
            },
            shift: {
              select: {
                id: true,
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
          },
        });

        if (!sale) {
          throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
        }
        if (input.user) {
          await assertUserCanAccessStore(tx, input.user, sale.storeId);
        }
        if (sale.status !== CustomerOrderStatus.COMPLETED) {
          throw new AppError("posSaleNotEditable", "CONFLICT", 409);
        }
        if (!sale.shiftId || !sale.registerId) {
          throw new AppError("posSaleMissingShift", "CONFLICT", 409);
        }

        const existingLineIds = new Set(sale.lines.map((line) => line.id));
        const requestedLineIds = new Set<string>();
        const normalizedLines: NormalizedPosReceiptEditLine[] = [];
        const desiredKeys = new Set<string>();

        for (const line of input.lines) {
          const lineId = line.lineId?.trim() || null;
          if (lineId) {
            if (!existingLineIds.has(lineId)) {
              throw new AppError("posSaleLineNotFound", "NOT_FOUND", 404);
            }
            if (requestedLineIds.has(lineId)) {
              throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
            }
            requestedLineIds.add(lineId);
          }
          if (!Number.isInteger(line.qty) || line.qty <= 0) {
            throw new AppError("invalidSalesQuantity", "BAD_REQUEST", 400);
          }
          const unitPriceKgs = roundMoney(line.unitPriceKgs);
          if (!Number.isFinite(unitPriceKgs) || unitPriceKgs < 0) {
            throw new AppError("unitPriceInvalid", "BAD_REQUEST", 400);
          }

          const resolvedPrice = await resolveUnitPrice({
            tx,
            organizationId: input.organizationId,
            storeId: sale.storeId,
            productId: line.productId,
            variantId: line.variantId ?? null,
          });
          const key = lineAggregateKey(line.productId, resolvedPrice.variantKey);
          if (desiredKeys.has(key)) {
            throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
          }
          desiredKeys.add(key);

          const unitCostKgs = await resolveUnitCost({
            tx,
            organizationId: input.organizationId,
            productId: line.productId,
            variantId: line.variantId ?? null,
            isBundle: resolvedPrice.isBundle,
          });
          normalizedLines.push({
            lineId,
            productId: line.productId,
            variantId: line.variantId ?? null,
            variantKey: resolvedPrice.variantKey,
            qty: line.qty,
            unitPriceKgs,
            lineTotalKgs: roundMoney(unitPriceKgs * line.qty),
            unitCostKgs,
            lineCostTotalKgs: unitCostKgs === null ? null : roundMoney(unitCostKgs * line.qty),
          });
        }

        const protectedLineIds = new Set(
          sale.lines
            .filter(
              (line) => line.saleReturnLines.length > 0 || line.markingCodeCaptures.length > 0,
            )
            .map((line) => line.id),
        );
        const oldLineById = new Map(sale.lines.map((line) => [line.id, line]));
        for (const normalized of normalizedLines) {
          if (!normalized.lineId || !protectedLineIds.has(normalized.lineId)) {
            continue;
          }
          const oldLine = oldLineById.get(normalized.lineId);
          if (
            oldLine &&
            (oldLine.productId !== normalized.productId ||
              (oldLine.variantId ?? null) !== normalized.variantId)
          ) {
            throw new AppError("posSaleLineEditRestricted", "CONFLICT", 409);
          }
        }

        const lineIdsToDelete = sale.lines
          .filter((line) => !requestedLineIds.has(line.id))
          .map((line) => line.id);
        if (lineIdsToDelete.some((lineId) => protectedLineIds.has(lineId))) {
          throw new AppError("posSaleLineEditRestricted", "CONFLICT", 409);
        }

        const before = {
          sale: {
            id: sale.id,
            number: sale.number,
            customerName: sale.customerName,
            customerEmail: sale.customerEmail,
            customerPhone: sale.customerPhone,
            customerAddress: sale.customerAddress,
            notes: sale.notes,
            subtotalKgs: toMoney(sale.subtotalKgs),
            discountKgs: toMoney(sale.discountKgs),
            totalKgs: toMoney(sale.totalKgs),
          },
          lines: sale.lines.map((line) => ({
            id: line.id,
            productId: line.productId,
            variantId: line.variantId,
            variantKey: line.variantKey,
            qty: line.qty,
            unitPriceKgs: toMoney(line.unitPriceKgs),
            lineTotalKgs: toMoney(line.lineTotalKgs),
            unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
            lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
          })),
        };

        const oldAggregates = new Map<
          string,
          { productId: string; variantId: string | null; variantKey: string; qty: number }
        >();
        for (const line of sale.lines) {
          addLineAggregateQty(oldAggregates, {
            productId: line.productId,
            variantId: line.variantId,
            variantKey: line.variantKey,
            qty: line.qty,
          });
        }
        const desiredAggregates = new Map<
          string,
          { productId: string; variantId: string | null; variantKey: string; qty: number }
        >();
        for (const line of normalizedLines) {
          addLineAggregateQty(desiredAggregates, line);
        }

        const changedProducts = new Map<
          string,
          { storeId: string; productId: string; variantId: string | null; onHand: number | null }
        >();
        const aggregateKeys = new Set([...oldAggregates.keys(), ...desiredAggregates.keys()]);
        for (const key of aggregateKeys) {
          const oldLine = oldAggregates.get(key);
          const desiredLine = desiredAggregates.get(key);
          const oldQty = oldLine?.qty ?? 0;
          const desiredQty = desiredLine?.qty ?? 0;
          const stockDelta = oldQty - desiredQty;
          if (stockDelta === 0) {
            continue;
          }
          const movementLine = desiredLine ?? oldLine;
          if (!movementLine) {
            continue;
          }
          const movement = await applyStockMovement(tx, {
            storeId: sale.storeId,
            productId: movementLine.productId,
            variantId: movementLine.variantId,
            qtyDelta: stockDelta,
            type: StockMovementType.SALE,
            referenceType: "CustomerOrder",
            referenceId: sale.id,
            note: input.reason?.trim() || `Редактирование чека ${sale.number}`,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });
          changedProducts.set(key, {
            storeId: sale.storeId,
            productId: movementLine.productId,
            variantId: movementLine.variantId,
            onHand: movement.snapshot.onHand,
          });
        }

        if (lineIdsToDelete.length) {
          await tx.customerOrderLine.deleteMany({
            where: {
              id: { in: lineIdsToDelete },
              customerOrderId: sale.id,
            },
          });
        }

        for (const line of normalizedLines) {
          const data = {
            productId: line.productId,
            variantId: line.variantId,
            variantKey: line.variantKey,
            qty: line.qty,
            unitPriceKgs: line.unitPriceKgs,
            lineTotalKgs: line.lineTotalKgs,
            unitCostKgs: line.unitCostKgs,
            lineCostTotalKgs: line.lineCostTotalKgs,
          };
          if (line.lineId) {
            await tx.customerOrderLine.update({
              where: { id: line.lineId },
              data,
            });
          } else {
            await tx.customerOrderLine.create({
              data: {
                customerOrderId: sale.id,
                ...data,
              },
            });
          }
          if (!changedProducts.has(lineAggregateKey(line.productId, line.variantKey))) {
            changedProducts.set(lineAggregateKey(line.productId, line.variantKey), {
              storeId: sale.storeId,
              productId: line.productId,
              variantId: line.variantId,
              onHand: null,
            });
          }
        }

        await tx.customerOrder.update({
          where: { id: sale.id },
          data: {
            customerName: input.customerName?.trim() || null,
            customerEmail: input.customerEmail?.trim().toLowerCase() || null,
            customerPhone: input.customerPhone?.trim() || null,
            customerAddress: input.customerAddress?.trim() || null,
            notes: input.notes?.trim() || null,
            updatedById: input.actorId,
          },
        });
        const updatedSale = await recomputeSaleTotals(tx, sale.id, input.actorId);

        const oldTotalKgs = roundMoney(toMoney(sale.totalKgs));
        const newTotalKgs = roundMoney(toMoney(updatedSale.totalKgs));
        const paymentDeltaKgs = roundMoney(newTotalKgs - oldTotalKgs);
        const transactionCurrency = resolveCurrencySnapshot(
          currencySourceWithFallback(
            updatedSale,
            currencySourceWithFallback(sale.shift, sale.store),
          ),
        );
        const preferredPaymentMethod =
          sale.payments.find((payment) => !payment.isRefund)?.method ??
          sale.payments[0]?.method ??
          PosPaymentMethod.CASH;

        if (paymentDeltaKgs !== 0 && (!sale.isDebt || sale.debtSettledAt)) {
          await tx.salePayment.create({
            data: {
              organizationId: input.organizationId,
              storeId: sale.storeId,
              shiftId: sale.shiftId,
              customerOrderId: sale.id,
              method: preferredPaymentMethod,
              amountKgs: Math.abs(paymentDeltaKgs),
              ...transactionCurrency,
              providerRef: `edit:${sale.number}`,
              isRefund: paymentDeltaKgs < 0,
              createdById: input.actorId,
            },
          });
        }

        const afterLines = await tx.customerOrderLine.findMany({
          where: { customerOrderId: sale.id },
          orderBy: { id: "asc" },
        });
        const after = {
          sale: {
            id: updatedSale.id,
            number: updatedSale.number,
            customerName: updatedSale.customerName,
            customerEmail: updatedSale.customerEmail,
            customerPhone: updatedSale.customerPhone,
            customerAddress: updatedSale.customerAddress,
            notes: updatedSale.notes,
            subtotalKgs: toMoney(updatedSale.subtotalKgs),
            discountKgs: toMoney(updatedSale.discountKgs),
            totalKgs: newTotalKgs,
          },
          lines: afterLines.map((line) => ({
            id: line.id,
            productId: line.productId,
            variantId: line.variantId,
            variantKey: line.variantKey,
            qty: line.qty,
            unitPriceKgs: toMoney(line.unitPriceKgs),
            lineTotalKgs: toMoney(line.lineTotalKgs),
            unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
            lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
          })),
          paymentDeltaKgs,
        };

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "POS_SALE_EDIT",
          entity: "CustomerOrder",
          entityId: sale.id,
          before: toJson(before),
          after: toJson(after),
          requestId: input.requestId,
        });

        return {
          id: updatedSale.id,
          number: updatedSale.number,
          status: updatedSale.status,
          storeId: updatedSale.storeId,
          registerId: updatedSale.registerId,
          shiftId: updatedSale.shiftId,
          subtotalKgs: toMoney(updatedSale.subtotalKgs),
          discountKgs: toMoney(updatedSale.discountKgs),
          totalKgs: newTotalKgs,
          paymentDeltaKgs,
          changedItems: Array.from(changedProducts.values()),
        };
      },
    );

    return { ...editResult, replayed };
  });

  if (!result.replayed) {
    result.changedItems.forEach((item) => {
      eventBus.publish({
        type: "inventory.updated",
        payload: {
          storeId: item.storeId,
          productId: item.productId,
          variantId: item.variantId,
        },
      });
    });
  }

  return {
    ...result,
    replayed: undefined,
    changedItems: undefined,
  };
};

export const addPosSaleLine = async (input: {
  organizationId: string;
  saleId: string;
  productId: string;
  variantId?: string | null;
  qty: number;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const sale = await lockPosSaleDraftForEdit(tx, {
      organizationId: input.organizationId,
      saleId: input.saleId,
      user: input.user,
    });

    const resolved = await resolveUnitPrice({
      tx,
      organizationId: input.organizationId,
      storeId: sale.storeId,
      productId: input.productId,
      variantId: input.variantId ?? null,
    });

    const existing = await tx.customerOrderLine.findUnique({
      where: {
        customerOrderId_productId_variantKey: {
          customerOrderId: sale.id,
          productId: input.productId,
          variantKey: resolved.variantKey,
        },
      },
    });

    if (existing) {
      const nextQty = existing.qty + input.qty;
      const updated = await tx.customerOrderLine.update({
        where: { id: existing.id },
        data: {
          qty: nextQty,
          lineTotalKgs: roundMoney(toMoney(existing.unitPriceKgs) * nextQty),
          lineCostTotalKgs:
            existing.unitCostKgs === null
              ? null
              : roundMoney(toMoney(existing.unitCostKgs) * nextQty),
        },
      });

      await recomputeSaleTotals(tx, sale.id, input.actorId);

      await writeAuditLog(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        action: "POS_SALE_LINE_UPDATE",
        entity: "CustomerOrder",
        entityId: sale.id,
        before: toJson(existing),
        after: toJson(updated),
        requestId: input.requestId,
      });

      return {
        ...updated,
        unitPriceKgs: toMoney(updated.unitPriceKgs),
        lineTotalKgs: toMoney(updated.lineTotalKgs),
        unitCostKgs: updated.unitCostKgs ? toMoney(updated.unitCostKgs) : null,
        lineCostTotalKgs: updated.lineCostTotalKgs ? toMoney(updated.lineCostTotalKgs) : null,
        lineAction: "incremented" as const,
      };
    }

    const unitCost = await resolveUnitCost({
      tx,
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      isBundle: resolved.isBundle,
    });

    const line = await tx.customerOrderLine.create({
      data: {
        customerOrderId: sale.id,
        productId: input.productId,
        variantId: input.variantId ?? null,
        variantKey: resolved.variantKey,
        qty: input.qty,
        unitPriceKgs: resolved.unitPrice,
        lineTotalKgs: roundMoney(resolved.unitPrice * input.qty),
        unitCostKgs: unitCost,
        lineCostTotalKgs: unitCost === null ? null : roundMoney(unitCost * input.qty),
      },
    });

    await recomputeSaleTotals(tx, sale.id, input.actorId);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_SALE_LINE_ADD",
      entity: "CustomerOrder",
      entityId: sale.id,
      before: null,
      after: toJson(line),
      requestId: input.requestId,
    });

    return {
      ...line,
      unitPriceKgs: toMoney(line.unitPriceKgs),
      lineTotalKgs: toMoney(line.lineTotalKgs),
      unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
      lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
      lineAction: "created" as const,
    };
  });
};

export const updatePosSaleLine = async (input: {
  organizationId: string;
  lineId: string;
  qty?: number;
  unitPriceKgs?: number;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const line = await tx.customerOrderLine.findUnique({
      where: { id: input.lineId },
      include: { customerOrder: true },
    });
    if (!line || !line.customerOrder.isPosSale) {
      throw new AppError("posSaleLineNotFound", "NOT_FOUND", 404);
    }
    if (line.customerOrder.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }
    await lockPosSaleDraftForEdit(tx, {
      organizationId: input.organizationId,
      saleId: line.customerOrderId,
      user: input.user,
    });
    if (input.qty === undefined && input.unitPriceKgs === undefined) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }
    if (input.qty !== undefined && (!Number.isInteger(input.qty) || input.qty <= 0)) {
      throw new AppError("invalidQuantity", "BAD_REQUEST", 400);
    }
    if (
      input.unitPriceKgs !== undefined &&
      (!Number.isFinite(input.unitPriceKgs) || input.unitPriceKgs < 0)
    ) {
      throw new AppError("invalidInput", "BAD_REQUEST", 400);
    }

    const nextQty = input.qty ?? line.qty;
    const nextUnitPriceKgs = roundMoney(input.unitPriceKgs ?? toMoney(line.unitPriceKgs));
    const updated = await tx.customerOrderLine.update({
      where: { id: line.id },
      data: {
        qty: nextQty,
        unitPriceKgs: nextUnitPriceKgs,
        lineTotalKgs: roundMoney(nextUnitPriceKgs * nextQty),
        lineCostTotalKgs:
          line.unitCostKgs === null ? null : roundMoney(toMoney(line.unitCostKgs) * nextQty),
      },
    });

    await recomputeSaleTotals(tx, line.customerOrderId, input.actorId);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_SALE_LINE_UPDATE",
      entity: "CustomerOrder",
      entityId: line.customerOrderId,
      before: toJson(line),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return {
      ...updated,
      unitPriceKgs: toMoney(updated.unitPriceKgs),
      lineTotalKgs: toMoney(updated.lineTotalKgs),
      unitCostKgs: updated.unitCostKgs ? toMoney(updated.unitCostKgs) : null,
      lineCostTotalKgs: updated.lineCostTotalKgs ? toMoney(updated.lineCostTotalKgs) : null,
    };
  });
};

export const removePosSaleLine = async (input: {
  organizationId: string;
  lineId: string;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const line = await tx.customerOrderLine.findUnique({
      where: { id: input.lineId },
      include: { customerOrder: true },
    });
    if (!line || !line.customerOrder.isPosSale) {
      throw new AppError("posSaleLineNotFound", "NOT_FOUND", 404);
    }
    if (line.customerOrder.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }
    await lockPosSaleDraftForEdit(tx, {
      organizationId: input.organizationId,
      saleId: line.customerOrderId,
      user: input.user,
    });

    await tx.customerOrderLine.delete({ where: { id: line.id } });
    await recomputeSaleTotals(tx, line.customerOrderId, input.actorId);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_SALE_LINE_REMOVE",
      entity: "CustomerOrder",
      entityId: line.customerOrderId,
      before: toJson(line),
      after: null,
      requestId: input.requestId,
    });

    return { saleId: line.customerOrderId };
  });
};

export const updatePosSaleDiscount = async (input: {
  organizationId: string;
  saleId: string;
  discountKgs: number;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
}) => {
  const discountKgs = roundMoney(input.discountKgs);
  if (!Number.isFinite(discountKgs) || discountKgs < 0) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }

  return prisma.$transaction(async (tx) => {
    const sale = await lockPosSaleDraftForEdit(tx, {
      organizationId: input.organizationId,
      saleId: input.saleId,
      user: input.user,
    });

    const subtotal = toMoney(sale.subtotalKgs);
    if (discountKgs > subtotal) {
      throw new AppError("posDiscountExceedsSubtotal", "BAD_REQUEST", 400);
    }

    const updated = await tx.customerOrder.update({
      where: { id: sale.id },
      data: {
        discountKgs,
        totalKgs: roundMoney(Math.max(0, subtotal - discountKgs)),
        updatedById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_SALE_DISCOUNT_UPDATE",
      entity: "CustomerOrder",
      entityId: sale.id,
      before: toJson({
        discountKgs: toMoney(sale.discountKgs),
        totalKgs: toMoney(sale.totalKgs),
      }),
      after: toJson({
        discountKgs: toMoney(updated.discountKgs),
        totalKgs: toMoney(updated.totalKgs),
      }),
      requestId: input.requestId,
    });

    return {
      id: updated.id,
      subtotalKgs: toMoney(updated.subtotalKgs),
      discountKgs: toMoney(updated.discountKgs),
      totalKgs: toMoney(updated.totalKgs),
    };
  });
};

export const upsertSaleLineMarkingCodes = async (input: {
  organizationId: string;
  saleId: string;
  lineId: string;
  codes: string[];
  actorId: string;
  requestId: string;
}) => {
  const normalizedCodes = normalizeMarkingCodes(input.codes);
  if (normalizedCodes.length > 200) {
    throw new AppError("posMarkingCodesLimitExceeded", "BAD_REQUEST", 400);
  }

  return prisma.$transaction(async (tx) => {
    const sale = await tx.customerOrder.findFirst({
      where: {
        id: input.saleId,
        organizationId: input.organizationId,
        isPosSale: true,
      },
      select: {
        id: true,
        storeId: true,
        status: true,
      },
    });

    if (!sale) {
      throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    }
    if (sale.status !== CustomerOrderStatus.DRAFT) {
      throw new AppError("posSaleNotEditable", "CONFLICT", 409);
    }

    const line = await tx.customerOrderLine.findUnique({
      where: { id: input.lineId },
      include: { product: { select: { id: true, name: true, sku: true } } },
    });
    if (!line || line.customerOrderId !== sale.id) {
      throw new AppError("posSaleLineNotFound", "NOT_FOUND", 404);
    }

    const existingActive = await tx.markingCodeCapture.findMany({
      where: {
        saleLineId: line.id,
        status: MarkingCodeStatus.CAPTURED,
      },
      select: { id: true, code: true },
    });

    if (existingActive.length) {
      const toVoidIds = existingActive
        .filter((capture) => !normalizedCodes.includes(capture.code))
        .map((capture) => capture.id);
      if (toVoidIds.length) {
        await tx.markingCodeCapture.updateMany({
          where: { id: { in: toVoidIds } },
          data: { status: MarkingCodeStatus.VOIDED },
        });
      }
    }

    for (const code of normalizedCodes) {
      await tx.markingCodeCapture.upsert({
        where: {
          saleLineId_code: {
            saleLineId: line.id,
            code,
          },
        },
        create: {
          organizationId: input.organizationId,
          storeId: sale.storeId,
          saleId: sale.id,
          saleLineId: line.id,
          code,
          status: MarkingCodeStatus.CAPTURED,
          capturedById: input.actorId,
        },
        update: {
          status: MarkingCodeStatus.CAPTURED,
          capturedAt: new Date(),
          capturedById: input.actorId,
        },
      });
    }

    const current = await tx.markingCodeCapture.findMany({
      where: {
        saleLineId: line.id,
        status: MarkingCodeStatus.CAPTURED,
      },
      select: { code: true },
      orderBy: { capturedAt: "asc" },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_MARKING_CODES_UPSERT",
      entity: "CustomerOrderLine",
      entityId: line.id,
      before: toJson({ codes: existingActive.map((capture) => capture.code) }),
      after: toJson({ codes: current.map((capture) => capture.code) }),
      requestId: input.requestId,
    });

    return {
      saleId: sale.id,
      lineId: line.id,
      productId: line.productId,
      productName: line.product.name,
      productSku: line.product.sku,
      codes: current.map((capture) => capture.code),
    };
  });
};

export const listPosReceipts = async (input: {
  organizationId: string;
  storeId?: string;
  shiftId?: string;
  registerId?: string;
  cashierId?: string;
  statuses?: CustomerOrderStatus[];
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}) => {
  const where: Prisma.CustomerOrderWhereInput = {
    organizationId: input.organizationId,
    isPosSale: true,
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.shiftId ? { shiftId: input.shiftId } : {}),
    ...(input.registerId ? { registerId: input.registerId } : {}),
    ...(input.cashierId ? { createdById: input.cashierId } : {}),
    ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
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
        store: {
          select: {
            id: true,
            name: true,
            code: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
        register: { select: { id: true, name: true, code: true } },
        shift: {
          select: {
            id: true,
            openedAt: true,
            closedAt: true,
            status: true,
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        payments: {
          where: { isRefund: false },
          select: {
            method: true,
            amountKgs: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
        fiscalReceipts: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            providerReceiptId: true,
            fiscalNumber: true,
            kkmFactoryNumber: true,
            kkmRegistrationNumber: true,
            fiscalModeStatus: true,
            upfdOrFiscalMemory: true,
            qrPayload: true,
            qr: true,
            lastError: true,
            mode: true,
            sentAt: true,
            fiscalizedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    items: items.map((item) => {
      const paymentBreakdown: Record<PosPaymentMethod, number> = {
        CASH: 0,
        CARD: 0,
        TRANSFER: 0,
        OTHER: 0,
      };
      for (const payment of item.payments) {
        paymentBreakdown[payment.method] = roundMoney(
          paymentBreakdown[payment.method] + toMoney(payment.amountKgs),
        );
      }
      const receipt = item.fiscalReceipts[0] ?? null;
      return {
        id: item.id,
        number: item.number,
        status: item.status,
        createdAt: item.createdAt,
        completedAt: item.completedAt,
        totalKgs: toMoney(item.totalKgs),
        subtotalKgs: toMoney(item.subtotalKgs),
        currencyCode: item.currencyCode,
        currencyRateKgsPerUnit: item.currencyRateKgsPerUnit,
        customerName: item.customerName,
        customerPhone: item.customerPhone,
        store: item.store,
        register: item.register,
        shift: item.shift,
        cashier: item.createdBy,
        paymentBreakdown,
        kkmStatus: item.kkmStatus,
        fiscalReceipt: receipt,
      };
    }),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const completePosSale = async (input: {
  organizationId: string;
  saleId: string;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
  idempotencyKey: string;
  debtCustomerName?: string | null;
  payments: Array<{ method: PosPaymentMethod; amountKgs: number; providerRef?: string | null }>;
}) => {
  const logger = getLogger(input.requestId);
  const debtCustomerName = input.debtCustomerName?.trim() || null;
  const normalizedPayments = debtCustomerName
    ? []
    : normalizePayments(input.payments, { requirePayment: false });

  const result = await prisma.$transaction(async (tx) => {
    const { result: completion, replayed } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "pos.sales.complete",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT id FROM "CustomerOrder" WHERE id = ${input.saleId} FOR UPDATE
        `;

        const sale = await tx.customerOrder.findFirst({
          where: {
            id: input.saleId,
            organizationId: input.organizationId,
            isPosSale: true,
          },
          include: {
            lines: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                  },
                },
              },
            },
            store: {
              select: {
                id: true,
                name: true,
                code: true,
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
          },
        });

        if (!sale) {
          throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
        }
        if (input.user) {
          await assertUserCanAccessStore(tx, input.user, sale.storeId);
        }
        if (!sale.shiftId || !sale.registerId) {
          throw new AppError("posSaleMissingShift", "CONFLICT", 409);
        }

        const shift = await tx.registerShift.findFirst({
          where: {
            id: sale.shiftId,
            organizationId: input.organizationId,
          },
          select: {
            id: true,
            status: true,
            registerId: true,
            storeId: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        });
        if (!shift) {
          throw new AppError("posShiftNotFound", "NOT_FOUND", 404);
        }
        if (shift.status !== RegisterShiftStatus.OPEN) {
          throw new AppError("posShiftClosed", "CONFLICT", 409);
        }
        if (shift.id !== sale.shiftId || shift.registerId !== sale.registerId) {
          throw new AppError("posShiftMismatch", "CONFLICT", 409);
        }

        if (sale.status === CustomerOrderStatus.COMPLETED) {
          return {
            id: sale.id,
            number: sale.number,
            status: sale.status,
            storeId: sale.storeId,
            registerId: sale.registerId,
            shiftId: sale.shiftId,
            productIds: sale.lines.map((line) => line.productId),
            kkmCandidate: null,
          };
        }

        if (sale.status !== CustomerOrderStatus.DRAFT) {
          throw new AppError("posSaleNotEditable", "CONFLICT", 409);
        }

        if (!sale.lines.length) {
          throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
        }

        const orderTotalMinorUnits = moneyToMinorUnits(toMoney(sale.totalKgs)) ?? 0;
        const paymentTotalMinorUnits = sumPaymentMinorUnits(normalizedPayments);
        if (!debtCustomerName && orderTotalMinorUnits > 0 && !normalizedPayments.length) {
          throw new AppError("posPaymentMissing", "BAD_REQUEST", 400);
        }
        if (!debtCustomerName && paymentTotalMinorUnits !== orderTotalMinorUnits) {
          throw new AppError("posPaymentTotalMismatch", "BAD_REQUEST", 400);
        }
        const transactionCurrency = resolveCurrencySnapshot(
          currencySourceWithFallback(sale, currencySourceWithFallback(shift, sale.store)),
        );

        const compliance = await tx.storeComplianceProfile.findUnique({
          where: { storeId: sale.storeId },
          select: {
            enableKkm: true,
            kkmMode: true,
            kkmProviderKey: true,
            enableMarking: true,
            markingMode: true,
          },
        });

        if (compliance?.enableMarking && compliance.markingMode === MarkingMode.REQUIRED_ON_SALE) {
          const productIds = Array.from(new Set(sale.lines.map((line) => line.productId)));
          const requiredFlags = productIds.length
            ? await tx.productComplianceFlags.findMany({
                where: {
                  organizationId: input.organizationId,
                  productId: { in: productIds },
                  requiresMarking: true,
                },
                select: { productId: true },
              })
            : [];
          const requiredProducts = new Set(requiredFlags.map((flag) => flag.productId));

          const requiredLines = sale.lines.filter((line) => requiredProducts.has(line.productId));
          if (requiredLines.length) {
            const captures = await tx.markingCodeCapture.groupBy({
              by: ["saleLineId"],
              where: {
                saleId: sale.id,
                saleLineId: { in: requiredLines.map((line) => line.id) },
                status: MarkingCodeStatus.CAPTURED,
              },
              _count: { _all: true },
            });
            const counts = new Map(captures.map((row) => [row.saleLineId, row._count._all]));

            const missingLine = requiredLines.find((line) => (counts.get(line.id) ?? 0) < 1);
            if (missingLine) {
              throw new AppError("posMarkingCodeRequired", "BAD_REQUEST", 400);
            }
          }
        }

        for (const line of sale.lines) {
          await applyStockMovement(tx, {
            storeId: sale.storeId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: -line.qty,
            type: StockMovementType.SALE,
            referenceType: "CustomerOrder",
            referenceId: sale.id,
            note: sale.number,
            actorId: input.actorId,
            organizationId: input.organizationId,
            allowNegativeStock: true,
          });
        }

        if (normalizedPayments.length) {
          await tx.salePayment.createMany({
            data: normalizedPayments.map((payment) => ({
              organizationId: input.organizationId,
              storeId: sale.storeId,
              shiftId: shift.id,
              customerOrderId: sale.id,
              method: payment.method,
              amountKgs: payment.amountKgs,
              ...transactionCurrency,
              providerRef: payment.providerRef,
              isRefund: false,
              createdById: input.actorId,
            })),
          });
        }

        const updated = await tx.customerOrder.update({
          where: { id: sale.id },
          data: {
            status: CustomerOrderStatus.COMPLETED,
            completedAt: new Date(),
            completedEventId: input.idempotencyKey,
            isDebt: Boolean(debtCustomerName),
            debtCustomerName,
            customerName: debtCustomerName ?? sale.customerName,
            ...transactionCurrency,
            updatedById: input.actorId,
          },
        });

        await upsertCustomerFromOrderTx(tx, {
          organizationId: input.organizationId,
          storeId: sale.storeId,
          customerName: updated.customerName,
          customerEmail: updated.customerEmail,
          customerPhone: updated.customerPhone,
          orderedAt: updated.completedAt,
          countOrder: true,
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "POS_SALE_COMPLETE",
          entity: "CustomerOrder",
          entityId: sale.id,
          before: toJson({ status: sale.status }),
          after: toJson({ status: updated.status }),
          requestId: input.requestId,
        });

        const kkmMode =
          !debtCustomerName && compliance?.enableKkm && compliance.kkmMode !== KkmMode.OFF
            ? compliance.kkmMode
            : null;
        const kkmCandidate: FiscalReceiptDraft | null = kkmMode
          ? {
              storeId: sale.storeId,
              receiptId: sale.number,
              cashierName: input.actorId,
              customerName: sale.customerName ?? undefined,
              lines: sale.lines.map((line) => ({
                sku: line.product.sku,
                name: line.product.name,
                qty: line.qty,
                priceKgs: toMoney(line.unitPriceKgs),
              })),
              payments: normalizedPayments.map((payment) => ({
                type: payment.method,
                amountKgs: payment.amountKgs,
              })),
              metadata: {
                saleId: sale.id,
                shiftId: shift.id,
                registerId: sale.registerId,
                mode: kkmMode,
              },
            }
          : null;

        const fiscalReceipt = kkmCandidate
          ? await queueFiscalReceipt({
              tx,
              organizationId: input.organizationId,
              storeId: sale.storeId,
              customerOrderId: sale.id,
              idempotencyKey: `pos-sale:${sale.id}:${input.idempotencyKey}`,
              mode: kkmMode ?? KkmMode.EXPORT_ONLY,
              providerKey: compliance?.kkmProviderKey ?? null,
              ...transactionCurrency,
              payload: kkmCandidate,
            })
          : null;

        return {
          id: updated.id,
          number: updated.number,
          status: updated.status,
          storeId: updated.storeId,
          registerId: updated.registerId,
          shiftId: updated.shiftId,
          productIds: sale.lines.map((line) => line.productId),
          kkmCandidate: kkmMode === KkmMode.ADAPTER ? kkmCandidate : null,
          kkmMode,
          kkmProviderKey: compliance?.kkmProviderKey ?? null,
          fiscalReceiptId: fiscalReceipt?.id ?? null,
        };
      },
    );

    return { ...completion, replayed };
  });

  if (!result.replayed && result.fiscalReceiptId) {
    incrementCounter(kkmReceiptsQueuedTotal, {
      mode: result.kkmMode ?? KkmMode.EXPORT_ONLY,
    });
  }

  if (!result.replayed && result.kkmCandidate && result.kkmMode === KkmMode.ADAPTER) {
    try {
      const adapter = getKkmAdapter(result.kkmProviderKey);
      const fiscalized = await adapter.fiscalizeReceipt(result.kkmCandidate);
      const fiscalMeta = resolveFiscalMetadataFromResult({
        result: fiscalized,
        fallbackStatus: "SENT",
      });
      const fiscalizedAt = fiscalized.fiscalizedAt ?? new Date();
      await prisma.$transaction(async (tx) => {
        await tx.customerOrder.update({
          where: { id: result.id },
          data: {
            kkmStatus: "SENT",
            kkmReceiptId: fiscalized.providerReceiptId,
            kkmRawJson: fiscalized.rawJson ?? Prisma.DbNull,
          },
        });
        if (result.fiscalReceiptId) {
          await tx.fiscalReceipt.update({
            where: { id: result.fiscalReceiptId },
            data: {
              status: "SENT",
              providerReceiptId: fiscalized.providerReceiptId,
              fiscalNumber: fiscalized.fiscalNumber ?? null,
              kkmFactoryNumber: fiscalMeta.kkmFactoryNumber,
              kkmRegistrationNumber: fiscalMeta.kkmRegistrationNumber,
              fiscalModeStatus: fiscalMeta.fiscalModeStatus ?? "SENT",
              upfdOrFiscalMemory: fiscalMeta.upfdOrFiscalMemory,
              qrPayload: fiscalMeta.qrPayload,
              qr: fiscalMeta.qrPayload,
              fiscalizedAt,
              sentAt: fiscalizedAt,
              attemptCount: { increment: 1 },
              lastError: null,
              nextAttemptAt: null,
            },
          });
        }
      });
      incrementCounter(kkmReceiptsSentTotal, { mode: KkmMode.ADAPTER });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.$transaction(async (tx) => {
        await tx.customerOrder.update({
          where: { id: result.id },
          data: {
            kkmStatus: "FAILED",
            kkmRawJson: toJson({
              message,
            }) as Prisma.InputJsonValue,
          },
        });
        if (result.fiscalReceiptId) {
          await tx.fiscalReceipt.update({
            where: { id: result.fiscalReceiptId },
            data: {
              status: "FAILED",
              fiscalModeStatus: "FAILED",
              lastError: message,
              nextAttemptAt: new Date(Date.now() + 60_000),
              attemptCount: { increment: 1 },
            },
          });
        }
      });
      incrementCounter(kkmReceiptsFailedTotal, { mode: KkmMode.ADAPTER });
    }
  }

  const productIds = Array.from(new Set(result.productIds));
  for (const productId of productIds) {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: result.storeId, productId, variantId: null },
    });
  }

  eventBus.publish({
    type: "sale.completed",
    payload: {
      saleId: result.id,
      storeId: result.storeId,
      registerId: result.registerId ?? null,
      shiftId: result.shiftId ?? null,
      number: result.number,
    },
  });

  logger.info({ saleId: result.id, number: result.number }, "pos sale completed");
  const completedSale = await prisma.customerOrder.findUnique({
    where: { id: result.id },
    select: { kkmStatus: true },
  });

  return {
    id: result.id,
    number: result.number,
    status: result.status,
    kkmStatus: completedSale?.kkmStatus ?? "NOT_SENT",
  };
};

export const createSaleReturnDraft = async (input: {
  organizationId: string;
  shiftId: string;
  originalSaleId: string;
  notes?: string | null;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const shift = await tx.registerShift.findFirst({
      where: {
        id: input.shiftId,
        organizationId: input.organizationId,
        status: RegisterShiftStatus.OPEN,
      },
      select: {
        id: true,
        registerId: true,
        storeId: true,
        currencyCode: true,
        currencyRateKgsPerUnit: true,
        store: {
          select: {
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
      },
    });
    if (!shift) {
      throw new AppError("posShiftNotOpen", "CONFLICT", 409);
    }

    const originalSale = await tx.customerOrder.findFirst({
      where: {
        id: input.originalSaleId,
        organizationId: input.organizationId,
        isPosSale: true,
        status: CustomerOrderStatus.COMPLETED,
      },
      select: {
        id: true,
        storeId: true,
        isDebt: true,
        debtSettledAt: true,
        currencyCode: true,
        currencyRateKgsPerUnit: true,
        store: {
          select: {
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
      },
    });
    if (!originalSale) {
      throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    }
    if (originalSale.storeId !== shift.storeId) {
      throw new AppError("posReturnStoreMismatch", "CONFLICT", 409);
    }
    if (originalSale.isDebt && !originalSale.debtSettledAt) {
      throw new AppError("posDebtReturnUnsettled", "CONFLICT", 409);
    }

    const number = await nextPosReturnNumber(tx, input.organizationId);
    const transactionCurrency = resolveCurrencySnapshot(
      currencySourceWithFallback(originalSale, currencySourceWithFallback(shift, shift.store)),
    );

    const created = await tx.saleReturn.create({
      data: {
        organizationId: input.organizationId,
        storeId: shift.storeId,
        registerId: shift.registerId,
        shiftId: shift.id,
        originalSaleId: originalSale.id,
        number,
        notes: input.notes ?? null,
        ...transactionCurrency,
        createdById: input.actorId,
      },
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_RETURN_CREATE",
      entity: "SaleReturn",
      entityId: created.id,
      before: null,
      after: toJson(created),
      requestId: input.requestId,
    });

    return created;
  });
};

const assertReturnLineAvailable = async (
  tx: Prisma.TransactionClient,
  input: {
    customerOrderLineId: string;
    requestedQty: number;
    excludeReturnLineId?: string;
  },
) => {
  const orderLine = await tx.customerOrderLine.findUnique({
    where: { id: input.customerOrderLineId },
    include: {
      customerOrder: {
        select: {
          id: true,
          isPosSale: true,
          status: true,
        },
      },
    },
  });

  if (!orderLine || !orderLine.customerOrder.isPosSale) {
    throw new AppError("posSaleLineNotFound", "NOT_FOUND", 404);
  }
  if (orderLine.customerOrder.status !== CustomerOrderStatus.COMPLETED) {
    throw new AppError("posReturnSourceNotCompleted", "CONFLICT", 409);
  }

  const alreadyReturned = await tx.saleReturnLine.aggregate({
    where: {
      customerOrderLineId: input.customerOrderLineId,
      saleReturn: { status: PosReturnStatus.COMPLETED },
      ...(input.excludeReturnLineId ? { id: { not: input.excludeReturnLineId } } : {}),
    },
    _sum: { qty: true },
  });

  const usedQty = alreadyReturned._sum.qty ?? 0;
  const availableQty = orderLine.qty - usedQty;

  if (availableQty <= 0) {
    throw new AppError("posReturnQtyExceeded", "CONFLICT", 409);
  }
  if (input.requestedQty > availableQty) {
    throw new AppError("posReturnQtyExceeded", "CONFLICT", 409);
  }

  return orderLine;
};

export const addSaleReturnLine = async (input: {
  organizationId: string;
  saleReturnId: string;
  customerOrderLineId: string;
  qty: number;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const saleReturn = await tx.saleReturn.findFirst({
      where: { id: input.saleReturnId, organizationId: input.organizationId },
      select: {
        id: true,
        status: true,
        originalSaleId: true,
      },
    });
    if (!saleReturn) {
      throw new AppError("posReturnNotFound", "NOT_FOUND", 404);
    }
    if (saleReturn.status !== PosReturnStatus.DRAFT) {
      throw new AppError("posReturnNotEditable", "CONFLICT", 409);
    }

    const existing = await tx.saleReturnLine.findUnique({
      where: {
        saleReturnId_customerOrderLineId: {
          saleReturnId: saleReturn.id,
          customerOrderLineId: input.customerOrderLineId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw new AppError("duplicateLineItem", "CONFLICT", 409);
    }

    const orderLine = await assertReturnLineAvailable(tx, {
      customerOrderLineId: input.customerOrderLineId,
      requestedQty: input.qty,
    });

    if (orderLine.customerOrderId !== saleReturn.originalSaleId) {
      throw new AppError("posReturnSourceMismatch", "CONFLICT", 409);
    }

    const line = await tx.saleReturnLine.create({
      data: {
        saleReturnId: saleReturn.id,
        customerOrderLineId: orderLine.id,
        productId: orderLine.productId,
        variantId: orderLine.variantId,
        variantKey: orderLine.variantKey,
        qty: input.qty,
        unitPriceKgs: orderLine.unitPriceKgs,
        lineTotalKgs: roundMoney(toMoney(orderLine.unitPriceKgs) * input.qty),
        unitCostKgs: orderLine.unitCostKgs,
        lineCostTotalKgs:
          orderLine.unitCostKgs === null
            ? null
            : roundMoney(toMoney(orderLine.unitCostKgs) * input.qty),
      },
    });

    await recomputeSaleReturnTotals(tx, saleReturn.id);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_RETURN_LINE_ADD",
      entity: "SaleReturn",
      entityId: saleReturn.id,
      before: null,
      after: toJson(line),
      requestId: input.requestId,
    });

    return {
      ...line,
      unitPriceKgs: toMoney(line.unitPriceKgs),
      lineTotalKgs: toMoney(line.lineTotalKgs),
      unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
      lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
    };
  });
};

export const updateSaleReturnLine = async (input: {
  organizationId: string;
  returnLineId: string;
  qty: number;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const line = await tx.saleReturnLine.findUnique({
      where: { id: input.returnLineId },
      include: {
        saleReturn: true,
      },
    });
    if (!line) {
      throw new AppError("posReturnLineNotFound", "NOT_FOUND", 404);
    }
    if (line.saleReturn.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }
    if (line.saleReturn.status !== PosReturnStatus.DRAFT) {
      throw new AppError("posReturnNotEditable", "CONFLICT", 409);
    }

    await assertReturnLineAvailable(tx, {
      customerOrderLineId: line.customerOrderLineId,
      requestedQty: input.qty,
      excludeReturnLineId: line.id,
    });

    const updated = await tx.saleReturnLine.update({
      where: { id: line.id },
      data: {
        qty: input.qty,
        lineTotalKgs: roundMoney(toMoney(line.unitPriceKgs) * input.qty),
        lineCostTotalKgs:
          line.unitCostKgs === null ? null : roundMoney(toMoney(line.unitCostKgs) * input.qty),
      },
    });

    await recomputeSaleReturnTotals(tx, line.saleReturnId);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_RETURN_LINE_UPDATE",
      entity: "SaleReturn",
      entityId: line.saleReturnId,
      before: toJson(line),
      after: toJson(updated),
      requestId: input.requestId,
    });

    return {
      ...updated,
      unitPriceKgs: toMoney(updated.unitPriceKgs),
      lineTotalKgs: toMoney(updated.lineTotalKgs),
      unitCostKgs: updated.unitCostKgs ? toMoney(updated.unitCostKgs) : null,
      lineCostTotalKgs: updated.lineCostTotalKgs ? toMoney(updated.lineCostTotalKgs) : null,
    };
  });
};

export const removeSaleReturnLine = async (input: {
  organizationId: string;
  returnLineId: string;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const line = await tx.saleReturnLine.findUnique({
      where: { id: input.returnLineId },
      include: {
        saleReturn: true,
      },
    });
    if (!line) {
      throw new AppError("posReturnLineNotFound", "NOT_FOUND", 404);
    }
    if (line.saleReturn.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }
    if (line.saleReturn.status !== PosReturnStatus.DRAFT) {
      throw new AppError("posReturnNotEditable", "CONFLICT", 409);
    }

    await tx.saleReturnLine.delete({ where: { id: line.id } });
    await recomputeSaleReturnTotals(tx, line.saleReturnId);

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_RETURN_LINE_REMOVE",
      entity: "SaleReturn",
      entityId: line.saleReturnId,
      before: toJson(line),
      after: null,
      requestId: input.requestId,
    });

    return { saleReturnId: line.saleReturnId };
  });
};

export const listSaleReturns = async (input: {
  organizationId: string;
  shiftId?: string;
  registerId?: string;
  originalSaleId?: string;
  page: number;
  pageSize: number;
}) => {
  const where: Prisma.SaleReturnWhereInput = {
    organizationId: input.organizationId,
    ...(input.shiftId ? { shiftId: input.shiftId } : {}),
    ...(input.registerId ? { registerId: input.registerId } : {}),
    ...(input.originalSaleId ? { originalSaleId: input.originalSaleId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.saleReturn.count({ where }),
    prisma.saleReturn.findMany({
      where,
      include: {
        register: { select: { id: true, name: true, code: true } },
        store: {
          select: {
            id: true,
            name: true,
            code: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        },
        originalSale: { select: { id: true, number: true } },
        lines: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      subtotalKgs: toMoney(item.subtotalKgs),
      totalKgs: toMoney(item.totalKgs),
      lines: item.lines.map((line) => ({
        ...line,
        unitPriceKgs: toMoney(line.unitPriceKgs),
        lineTotalKgs: toMoney(line.lineTotalKgs),
        unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
        lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
      })),
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const getSaleReturn = async (input: { organizationId: string; saleReturnId: string }) => {
  const saleReturn = await prisma.saleReturn.findFirst({
    where: {
      id: input.saleReturnId,
      organizationId: input.organizationId,
    },
    include: {
      register: { select: { id: true, name: true, code: true } },
      store: {
        select: {
          id: true,
          name: true,
          code: true,
          currencyCode: true,
          currencyRateKgsPerUnit: true,
        },
      },
      originalSale: {
        select: {
          id: true,
          number: true,
          customerName: true,
          customerPhone: true,
          lines: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      },
      lines: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
          customerOrderLine: { select: { id: true, qty: true } },
        },
      },
      payments: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!saleReturn) {
    return null;
  }

  return {
    ...saleReturn,
    subtotalKgs: toMoney(saleReturn.subtotalKgs),
    totalKgs: toMoney(saleReturn.totalKgs),
    lines: saleReturn.lines.map((line) => ({
      ...line,
      unitPriceKgs: toMoney(line.unitPriceKgs),
      lineTotalKgs: toMoney(line.lineTotalKgs),
      unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
      lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
    })),
    payments: saleReturn.payments.map((payment) => ({
      ...payment,
      amountKgs: toMoney(payment.amountKgs),
    })),
  };
};

export const editCompletedSaleReturn = async (input: {
  organizationId: string;
  saleReturnId: string;
  lines: PosReturnEditLineInput[];
  notes?: string | null;
  reason?: string | null;
  actorId: string;
  user?: StoreAccessUser;
  requestId: string;
  idempotencyKey: string;
}) => {
  if (!input.lines.length) {
    throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const { result: editResult, replayed } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "pos.returns.editCompleted",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT id FROM "SaleReturn" WHERE id = ${input.saleReturnId} FOR UPDATE
        `;

        const saleReturn = await tx.saleReturn.findFirst({
          where: {
            id: input.saleReturnId,
            organizationId: input.organizationId,
          },
          include: {
            lines: {
              orderBy: { id: "asc" },
            },
            payments: {
              orderBy: { createdAt: "asc" },
            },
            originalSale: {
              include: {
                lines: {
                  include: {
                    product: { select: { isBundle: true } },
                  },
                  orderBy: { id: "asc" },
                },
              },
            },
            store: {
              select: {
                id: true,
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
            shift: {
              select: {
                id: true,
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
          },
        });

        if (!saleReturn) {
          throw new AppError("posReturnNotFound", "NOT_FOUND", 404);
        }
        if (input.user) {
          await assertUserCanAccessStore(tx, input.user, saleReturn.storeId);
        }
        if (saleReturn.status !== PosReturnStatus.COMPLETED) {
          throw new AppError("posReturnNotEditable", "CONFLICT", 409);
        }

        const originalLineById = new Map(
          saleReturn.originalSale.lines.map((line) => [line.id, line]),
        );
        const originalLineByProduct = new Map(
          saleReturn.originalSale.lines.map((line) => [
            lineAggregateKey(line.productId, line.variantKey),
            line,
          ]),
        );
        const existingLineIds = new Set(saleReturn.lines.map((line) => line.id));
        const requestedLineIds = new Set<string>();
        const desiredKeys = new Set<string>();
        const normalizedLines: Array<{
          lineId: string | null;
          customerOrderLineId: string;
          productId: string;
          variantId: string | null;
          variantKey: string;
          qty: number;
          unitPriceKgs: number;
          lineTotalKgs: number;
          unitCostKgs: number | null;
          lineCostTotalKgs: number | null;
        }> = [];

        for (const line of input.lines) {
          const lineId = line.lineId?.trim() || null;
          if (lineId) {
            if (!existingLineIds.has(lineId)) {
              throw new AppError("posReturnLineNotFound", "NOT_FOUND", 404);
            }
            if (requestedLineIds.has(lineId)) {
              throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
            }
            requestedLineIds.add(lineId);
          }
          if (!Number.isInteger(line.qty) || line.qty <= 0) {
            throw new AppError("invalidReturnQuantity", "BAD_REQUEST", 400);
          }
          const unitPriceKgs = roundMoney(line.unitPriceKgs);
          if (!Number.isFinite(unitPriceKgs) || unitPriceKgs < 0) {
            throw new AppError("unitPriceInvalid", "BAD_REQUEST", 400);
          }

          const requestedVariantKey = variantKeyFrom(line.variantId ?? null);
          const originalLine =
            (line.customerOrderLineId
              ? originalLineById.get(line.customerOrderLineId)
              : undefined) ??
            originalLineByProduct.get(lineAggregateKey(line.productId, requestedVariantKey));
          if (!originalLine) {
            throw new AppError("posReturnOriginalLineNotFound", "CONFLICT", 409);
          }
          if (
            originalLine.productId !== line.productId ||
            (originalLine.variantId ?? null) !== (line.variantId ?? null)
          ) {
            throw new AppError("posReturnOriginalLineNotFound", "CONFLICT", 409);
          }
          await assertReturnLineAvailable(tx, {
            customerOrderLineId: originalLine.id,
            requestedQty: line.qty,
            excludeReturnLineId: lineId ?? undefined,
          });

          const key = lineAggregateKey(originalLine.productId, originalLine.variantKey);
          if (desiredKeys.has(key)) {
            throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
          }
          desiredKeys.add(key);

          const unitCostKgs = originalLine.unitCostKgs
            ? toMoney(originalLine.unitCostKgs)
            : await resolveUnitCost({
                tx,
                organizationId: input.organizationId,
                productId: originalLine.productId,
                variantId: originalLine.variantId,
                isBundle: originalLine.product.isBundle,
              });

          normalizedLines.push({
            lineId,
            customerOrderLineId: originalLine.id,
            productId: originalLine.productId,
            variantId: originalLine.variantId ?? null,
            variantKey: originalLine.variantKey,
            qty: line.qty,
            unitPriceKgs,
            lineTotalKgs: roundMoney(unitPriceKgs * line.qty),
            unitCostKgs,
            lineCostTotalKgs: unitCostKgs === null ? null : roundMoney(unitCostKgs * line.qty),
          });
        }

        const before = {
          saleReturn: {
            id: saleReturn.id,
            number: saleReturn.number,
            notes: saleReturn.notes,
            subtotalKgs: toMoney(saleReturn.subtotalKgs),
            totalKgs: toMoney(saleReturn.totalKgs),
          },
          lines: saleReturn.lines.map((line) => ({
            id: line.id,
            customerOrderLineId: line.customerOrderLineId,
            productId: line.productId,
            variantId: line.variantId,
            variantKey: line.variantKey,
            qty: line.qty,
            unitPriceKgs: toMoney(line.unitPriceKgs),
            lineTotalKgs: toMoney(line.lineTotalKgs),
          })),
        };

        const oldAggregates = new Map<
          string,
          { productId: string; variantId: string | null; variantKey: string; qty: number }
        >();
        saleReturn.lines.forEach((line) => {
          addLineAggregateQty(oldAggregates, {
            productId: line.productId,
            variantId: line.variantId,
            variantKey: line.variantKey,
            qty: line.qty,
          });
        });
        const desiredAggregates = new Map<
          string,
          { productId: string; variantId: string | null; variantKey: string; qty: number }
        >();
        normalizedLines.forEach((line) => addLineAggregateQty(desiredAggregates, line));

        const changedProducts = new Map<
          string,
          { storeId: string; productId: string; variantId: string | null; onHand: number | null }
        >();
        const aggregateKeys = new Set([...oldAggregates.keys(), ...desiredAggregates.keys()]);
        for (const key of aggregateKeys) {
          const oldLine = oldAggregates.get(key);
          const desiredLine = desiredAggregates.get(key);
          const stockDelta = (desiredLine?.qty ?? 0) - (oldLine?.qty ?? 0);
          if (stockDelta === 0) {
            continue;
          }
          const movementLine = desiredLine ?? oldLine;
          if (!movementLine) {
            continue;
          }
          const movement = await applyStockMovement(tx, {
            storeId: saleReturn.storeId,
            productId: movementLine.productId,
            variantId: movementLine.variantId,
            qtyDelta: stockDelta,
            type: StockMovementType.RETURN,
            referenceType: "SaleReturn",
            referenceId: saleReturn.id,
            note: input.reason?.trim() || `Редактирование возврата ${saleReturn.number}`,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });
          changedProducts.set(key, {
            storeId: saleReturn.storeId,
            productId: movementLine.productId,
            variantId: movementLine.variantId,
            onHand: movement.snapshot.onHand,
          });
        }

        const lineIdsToDelete = saleReturn.lines
          .filter((line) => !requestedLineIds.has(line.id))
          .map((line) => line.id);
        if (lineIdsToDelete.length) {
          await tx.saleReturnLine.deleteMany({
            where: {
              id: { in: lineIdsToDelete },
              saleReturnId: saleReturn.id,
            },
          });
        }

        for (const line of normalizedLines) {
          const data = {
            customerOrderLineId: line.customerOrderLineId,
            productId: line.productId,
            variantId: line.variantId,
            variantKey: line.variantKey,
            qty: line.qty,
            unitPriceKgs: line.unitPriceKgs,
            lineTotalKgs: line.lineTotalKgs,
            unitCostKgs: line.unitCostKgs,
            lineCostTotalKgs: line.lineCostTotalKgs,
          };
          if (line.lineId) {
            await tx.saleReturnLine.update({
              where: { id: line.lineId },
              data,
            });
          } else {
            await tx.saleReturnLine.create({
              data: {
                saleReturnId: saleReturn.id,
                ...data,
              },
            });
          }
        }

        await tx.saleReturn.update({
          where: { id: saleReturn.id },
          data: {
            notes: input.notes?.trim() || null,
          },
        });
        const updatedReturn = await recomputeSaleReturnTotals(tx, saleReturn.id);

        const oldTotalKgs = roundMoney(toMoney(saleReturn.totalKgs));
        const newTotalKgs = roundMoney(toMoney(updatedReturn.totalKgs));
        const refundDeltaKgs = roundMoney(newTotalKgs - oldTotalKgs);
        const transactionCurrency = resolveCurrencySnapshot(
          currencySourceWithFallback(
            updatedReturn,
            currencySourceWithFallback(
              saleReturn.originalSale,
              currencySourceWithFallback(saleReturn.shift, saleReturn.store),
            ),
          ),
        );
        const preferredPaymentMethod =
          saleReturn.payments.find((payment) => payment.isRefund)?.method ??
          saleReturn.payments[0]?.method ??
          PosPaymentMethod.CASH;
        if (refundDeltaKgs !== 0) {
          await tx.salePayment.create({
            data: {
              organizationId: input.organizationId,
              storeId: saleReturn.storeId,
              shiftId: saleReturn.shiftId,
              customerOrderId: saleReturn.originalSaleId,
              saleReturnId: saleReturn.id,
              method: preferredPaymentMethod,
              amountKgs: refundDeltaKgs,
              ...transactionCurrency,
              providerRef: `edit:${saleReturn.number}`,
              isRefund: true,
              createdById: input.actorId,
            },
          });
        }

        const afterLines = await tx.saleReturnLine.findMany({
          where: { saleReturnId: saleReturn.id },
          orderBy: { id: "asc" },
        });
        const after = {
          saleReturn: {
            id: updatedReturn.id,
            number: updatedReturn.number,
            notes: updatedReturn.notes,
            subtotalKgs: toMoney(updatedReturn.subtotalKgs),
            totalKgs: newTotalKgs,
          },
          lines: afterLines.map((line) => ({
            id: line.id,
            customerOrderLineId: line.customerOrderLineId,
            productId: line.productId,
            variantId: line.variantId,
            variantKey: line.variantKey,
            qty: line.qty,
            unitPriceKgs: toMoney(line.unitPriceKgs),
            lineTotalKgs: toMoney(line.lineTotalKgs),
          })),
          refundDeltaKgs,
        };

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "POS_RETURN_EDIT",
          entity: "SaleReturn",
          entityId: saleReturn.id,
          before: toJson(before),
          after: toJson(after),
          requestId: input.requestId,
        });

        return {
          id: updatedReturn.id,
          number: updatedReturn.number,
          status: updatedReturn.status,
          storeId: updatedReturn.storeId,
          registerId: updatedReturn.registerId,
          shiftId: updatedReturn.shiftId,
          subtotalKgs: toMoney(updatedReturn.subtotalKgs),
          totalKgs: newTotalKgs,
          refundDeltaKgs,
          changedItems: Array.from(changedProducts.values()),
        };
      },
    );

    return { ...editResult, replayed };
  });

  if (!result.replayed) {
    result.changedItems.forEach((item) => {
      eventBus.publish({
        type: "inventory.updated",
        payload: {
          storeId: item.storeId,
          productId: item.productId,
          variantId: item.variantId,
        },
      });
    });
  }

  return {
    ...result,
    replayed: undefined,
    changedItems: undefined,
  };
};

export const completeSaleReturn = async (input: {
  organizationId: string;
  saleReturnId: string;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  payments: Array<{ method: PosPaymentMethod; amountKgs: number; providerRef?: string | null }>;
}) => {
  const normalizedPayments = normalizePayments(input.payments);

  const result = await prisma.$transaction(async (tx) => {
    const { result: completion } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "pos.returns.complete",
        userId: input.actorId,
      },
      async () => {
        await tx.$queryRaw`
          SELECT id FROM "SaleReturn" WHERE id = ${input.saleReturnId} FOR UPDATE
        `;

        const saleReturn = await tx.saleReturn.findFirst({
          where: {
            id: input.saleReturnId,
            organizationId: input.organizationId,
          },
          include: {
            lines: true,
          },
        });

        if (!saleReturn) {
          throw new AppError("posReturnNotFound", "NOT_FOUND", 404);
        }

        if (saleReturn.status === PosReturnStatus.COMPLETED) {
          return {
            id: saleReturn.id,
            number: saleReturn.number,
            status: saleReturn.status,
            storeId: saleReturn.storeId,
            registerId: saleReturn.registerId,
            shiftId: saleReturn.shiftId,
            productIds: saleReturn.lines.map((line) => line.productId),
          };
        }

        if (saleReturn.status !== PosReturnStatus.DRAFT) {
          throw new AppError("posReturnNotEditable", "CONFLICT", 409);
        }

        const shift = await tx.registerShift.findFirst({
          where: {
            id: saleReturn.shiftId,
            organizationId: input.organizationId,
            status: RegisterShiftStatus.OPEN,
          },
          select: {
            id: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
          },
        });
        if (!shift) {
          throw new AppError("posShiftNotOpen", "CONFLICT", 409);
        }

        const originalSale = await tx.customerOrder.findFirst({
          where: {
            id: saleReturn.originalSaleId,
            organizationId: input.organizationId,
            isPosSale: true,
            status: CustomerOrderStatus.COMPLETED,
          },
          select: {
            id: true,
            shiftId: true,
            isDebt: true,
            debtSettledAt: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
            store: {
              select: {
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
            payments: {
              where: { isRefund: false },
              select: { method: true },
            },
          },
        });
        if (!originalSale) {
          throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
        }
        if (originalSale.isDebt && !originalSale.debtSettledAt) {
          throw new AppError("posDebtReturnUnsettled", "CONFLICT", 409);
        }

        const refundHasCard = normalizedPayments.some(
          (payment) => payment.method === PosPaymentMethod.CARD,
        );
        const refundHasQrLike = normalizedPayments.some(
          (payment) => payment.method === PosPaymentMethod.TRANSFER,
        );
        const originalHasQrLike = originalSale.payments.some(
          (payment) => payment.method === PosPaymentMethod.TRANSFER,
        );
        const transactionCurrency = resolveCurrencySnapshot(
          currencySourceWithFallback(
            saleReturn,
            currencySourceWithFallback(
              originalSale,
              currencySourceWithFallback(shift, originalSale.store),
            ),
          ),
        );

        if (
          refundHasCard &&
          (!originalSale.shiftId || originalSale.shiftId !== saleReturn.shiftId)
        ) {
          throw new AppError("posCardRefundShiftMismatch", "CONFLICT", 409);
        }

        if (!saleReturn.lines.length) {
          throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
        }

        const returnTotalMinorUnits = moneyToMinorUnits(toMoney(saleReturn.totalKgs)) ?? 0;
        const paymentTotalMinorUnits = sumPaymentMinorUnits(normalizedPayments);
        if (paymentTotalMinorUnits !== returnTotalMinorUnits) {
          throw new AppError("posPaymentTotalMismatch", "BAD_REQUEST", 400);
        }

        let manualRefundRequestId: string | null = null;
        if (refundHasQrLike || originalHasQrLike) {
          const request = await tx.refundRequest.upsert({
            where: { saleReturnId: saleReturn.id },
            create: {
              organizationId: input.organizationId,
              storeId: saleReturn.storeId,
              saleReturnId: saleReturn.id,
              originalSaleId: saleReturn.originalSaleId,
              paymentMethod: refundHasQrLike ? PosPaymentMethod.TRANSFER : PosPaymentMethod.OTHER,
              ...transactionCurrency,
              reasonCode: "MKASSA_QR_MANUAL",
              notes: saleReturn.notes,
              createdById: input.actorId,
              status: RefundRequestStatus.OPEN,
            },
            update: {
              paymentMethod: refundHasQrLike ? PosPaymentMethod.TRANSFER : PosPaymentMethod.OTHER,
              ...transactionCurrency,
              reasonCode: "MKASSA_QR_MANUAL",
              notes: saleReturn.notes,
              status: RefundRequestStatus.OPEN,
            },
          });
          manualRefundRequestId = request.id;
        }

        for (const line of saleReturn.lines) {
          await applyStockMovement(tx, {
            storeId: saleReturn.storeId,
            productId: line.productId,
            variantId: line.variantId,
            qtyDelta: line.qty,
            type: StockMovementType.RETURN,
            referenceType: "SaleReturn",
            referenceId: saleReturn.id,
            note: saleReturn.number,
            actorId: input.actorId,
            organizationId: input.organizationId,
          });
        }

        await tx.salePayment.createMany({
          data: normalizedPayments.map((payment) => ({
            organizationId: input.organizationId,
            storeId: saleReturn.storeId,
            shiftId: saleReturn.shiftId,
            customerOrderId: saleReturn.originalSaleId,
            saleReturnId: saleReturn.id,
            method: payment.method,
            amountKgs: payment.amountKgs,
            ...transactionCurrency,
            providerRef: payment.providerRef,
            isRefund: true,
            createdById: input.actorId,
          })),
        });

        const updated = await tx.saleReturn.update({
          where: { id: saleReturn.id },
          data: {
            status: PosReturnStatus.COMPLETED,
            completedAt: new Date(),
            completedEventId: input.idempotencyKey,
            ...transactionCurrency,
            completedById: input.actorId,
          },
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "POS_RETURN_COMPLETE",
          entity: "SaleReturn",
          entityId: saleReturn.id,
          before: toJson({ status: saleReturn.status }),
          after: toJson({ status: updated.status }),
          requestId: input.requestId,
        });

        return {
          id: updated.id,
          number: updated.number,
          status: updated.status,
          storeId: updated.storeId,
          registerId: updated.registerId,
          shiftId: updated.shiftId,
          productIds: saleReturn.lines.map((line) => line.productId),
          manualRequired: Boolean(manualRefundRequestId),
          refundRequestId: manualRefundRequestId,
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

  eventBus.publish({
    type: "sale.refunded",
    payload: {
      saleReturnId: result.id,
      storeId: result.storeId,
      registerId: result.registerId,
      shiftId: result.shiftId,
      number: result.number,
    },
  });

  return {
    id: result.id,
    number: result.number,
    status: result.status,
    manualRequired: result.manualRequired,
    refundRequestId: result.refundRequestId,
  };
};

export const retryPosSaleKkm = async (input: {
  organizationId: string;
  saleId: string;
  actorId: string;
  requestId: string;
}) => {
  const sale = await prisma.customerOrder.findFirst({
    where: {
      id: input.saleId,
      organizationId: input.organizationId,
      isPosSale: true,
      status: CustomerOrderStatus.COMPLETED,
    },
    include: {
      lines: {
        include: {
          product: {
            select: {
              sku: true,
              name: true,
            },
          },
        },
      },
      payments: {
        where: { isRefund: false },
        orderBy: { createdAt: "asc" },
      },
      fiscalReceipts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });

  if (!sale) {
    throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
  }

  const compliance = await prisma.storeComplianceProfile.findUnique({
    where: { storeId: sale.storeId },
    select: {
      enableKkm: true,
      kkmMode: true,
      kkmProviderKey: true,
    },
  });
  if (!compliance?.enableKkm || compliance.kkmMode !== "ADAPTER") {
    throw new AppError("kkmNotConfigured", "BAD_REQUEST", 400);
  }
  if (sale.kkmStatus === "SENT") {
    return {
      saleId: sale.id,
      kkmStatus: sale.kkmStatus,
      kkmReceiptId: sale.kkmReceiptId,
      errorMessage: null,
      retried: false,
    };
  }

  const draft: FiscalReceiptDraft = {
    storeId: sale.storeId,
    receiptId: sale.number,
    cashierName: input.actorId,
    customerName: sale.customerName ?? undefined,
    lines: sale.lines.map((line) => ({
      sku: line.product.sku,
      name: line.product.name,
      qty: line.qty,
      priceKgs: toMoney(line.unitPriceKgs),
    })),
    payments: sale.payments.map((payment) => ({
      type: payment.method,
      amountKgs: toMoney(payment.amountKgs),
    })),
    metadata: {
      saleId: sale.id,
      shiftId: sale.shiftId,
      registerId: sale.registerId,
      retriedBy: input.actorId,
    },
  };

  try {
    const adapter = getKkmAdapter(compliance.kkmProviderKey);
    const fiscalized = await adapter.fiscalizeReceipt(draft);
    const fiscalMeta = resolveFiscalMetadataFromResult({
      result: fiscalized,
      fallbackStatus: "SENT",
    });
    const fiscalizedAt = fiscalized.fiscalizedAt ?? new Date();
    const latestFiscalReceiptId = sale.fiscalReceipts[0]?.id ?? null;

    await prisma.$transaction(async (tx) => {
      await tx.customerOrder.update({
        where: { id: sale.id },
        data: {
          kkmStatus: "SENT",
          kkmReceiptId: fiscalized.providerReceiptId,
          kkmRawJson: fiscalized.rawJson ?? Prisma.DbNull,
        },
      });

      if (latestFiscalReceiptId) {
        await tx.fiscalReceipt.update({
          where: { id: latestFiscalReceiptId },
          data: {
            status: "SENT",
            providerReceiptId: fiscalized.providerReceiptId,
            fiscalNumber: fiscalized.fiscalNumber ?? null,
            kkmFactoryNumber: fiscalMeta.kkmFactoryNumber,
            kkmRegistrationNumber: fiscalMeta.kkmRegistrationNumber,
            fiscalModeStatus: fiscalMeta.fiscalModeStatus ?? "SENT",
            upfdOrFiscalMemory: fiscalMeta.upfdOrFiscalMemory,
            qrPayload: fiscalMeta.qrPayload,
            qr: fiscalMeta.qrPayload,
            fiscalizedAt,
            sentAt: fiscalizedAt,
            lastError: null,
            nextAttemptAt: null,
            attemptCount: { increment: 1 },
          },
        });
      }
    });

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_KKM_RETRY",
      entity: "CustomerOrder",
      entityId: sale.id,
      before: toJson({ kkmStatus: sale.kkmStatus, kkmReceiptId: sale.kkmReceiptId }),
      after: toJson({ kkmStatus: "SENT", kkmReceiptId: fiscalized.providerReceiptId }),
      requestId: input.requestId,
    });

    return {
      saleId: sale.id,
      kkmStatus: "SENT" as const,
      kkmReceiptId: fiscalized.providerReceiptId,
      errorMessage: null,
      retried: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latestFiscalReceiptId = sale.fiscalReceipts[0]?.id ?? null;
    await prisma.$transaction(async (tx) => {
      await tx.customerOrder.update({
        where: { id: sale.id },
        data: {
          kkmStatus: "FAILED",
          kkmRawJson: toJson({
            message,
            retriedAt: new Date().toISOString(),
            retriedBy: input.actorId,
          }) as Prisma.InputJsonValue,
        },
      });

      if (latestFiscalReceiptId) {
        await tx.fiscalReceipt.update({
          where: { id: latestFiscalReceiptId },
          data: {
            status: "FAILED",
            fiscalModeStatus: "FAILED",
            lastError: message,
            nextAttemptAt: new Date(Date.now() + 60_000),
            attemptCount: { increment: 1 },
          },
        });
      }
    });

    await writeAuditLog(prisma, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "POS_KKM_RETRY",
      entity: "CustomerOrder",
      entityId: sale.id,
      before: toJson({ kkmStatus: sale.kkmStatus, kkmReceiptId: sale.kkmReceiptId }),
      after: toJson({ kkmStatus: "FAILED", errorMessage: message }),
      requestId: input.requestId,
    });

    return {
      saleId: sale.id,
      kkmStatus: "FAILED" as const,
      kkmReceiptId: null,
      errorMessage: message,
      retried: true,
    };
  }
};

export const recordCashDrawerMovement = async (input: {
  organizationId: string;
  shiftId: string;
  type: CashDrawerMovementType;
  amountKgs: number;
  reason: string;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const { result: movement } = await withIdempotency(
      tx,
      {
        key: input.idempotencyKey,
        route: "pos.cash.record",
        userId: input.actorId,
      },
      async () => {
        const shift = await tx.registerShift.findFirst({
          where: {
            id: input.shiftId,
            organizationId: input.organizationId,
          },
          select: {
            id: true,
            storeId: true,
            status: true,
            currencyCode: true,
            currencyRateKgsPerUnit: true,
            store: {
              select: {
                currencyCode: true,
                currencyRateKgsPerUnit: true,
              },
            },
          },
        });
        if (!shift) {
          throw new AppError("posShiftNotFound", "NOT_FOUND", 404);
        }
        if (shift.status !== RegisterShiftStatus.OPEN) {
          throw new AppError("posShiftClosed", "CONFLICT", 409);
        }

        const created = await tx.cashDrawerMovement.create({
          data: {
            organizationId: input.organizationId,
            storeId: shift.storeId,
            shiftId: shift.id,
            type: input.type,
            amountKgs: roundMoney(input.amountKgs),
            ...resolveCurrencySnapshot(currencySourceWithFallback(shift, shift.store)),
            reason: input.reason,
            createdById: input.actorId,
          },
        });

        await writeAuditLog(tx, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          action: "POS_CASH_DRAWER_MOVEMENT",
          entity: "CashDrawerMovement",
          entityId: created.id,
          before: null,
          after: toJson(created),
          requestId: input.requestId,
        });

        return {
          ...created,
          amountKgs: toMoney(created.amountKgs),
        };
      },
    );

    return movement;
  });
};
