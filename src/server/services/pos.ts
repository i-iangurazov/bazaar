import {
  CashDrawerMovementType,
  CustomerOrderStatus,
  PosReturnStatus,
  Prisma,
  RegisterShiftStatus,
  StockMovementType,
} from "@prisma/client";
import type { PosPaymentMethod } from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { eventBus } from "@/server/events/eventBus";
import type { FiscalReceiptDraft } from "@/server/kkm/adapter";
import { getKkmAdapter } from "@/server/kkm/registry";
import { getLogger } from "@/server/logging";
import { writeAuditLog } from "@/server/services/audit";
import { AppError } from "@/server/services/errors";
import { applyStockMovement } from "@/server/services/inventory";
import { withIdempotency } from "@/server/services/idempotency";
import { toJson } from "@/server/services/json";

const toMoney = (value: Prisma.Decimal | number | null | undefined) =>
  typeof value === "number" ? value : value ? Number(value) : 0;
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const variantKeyFrom = (variantId?: string | null) => variantId ?? "BASE";

const sumPayments = (payments: Array<{ amountKgs: number }>) =>
  roundMoney(payments.reduce((total, payment) => total + payment.amountKgs, 0));

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
  return tx.customerOrder.update({
    where: { id: customerOrderId },
    data: {
      subtotalKgs: subtotal,
      totalKgs: subtotal,
      updatedById,
    },
  });
};

const recomputeSaleReturnTotals = async (
  tx: Prisma.TransactionClient,
  saleReturnId: string,
) => {
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

const requireOpenShift = async (tx: Prisma.TransactionClient, input: {
  organizationId: string;
  registerId: string;
}) => {
  const shift = await tx.registerShift.findFirst({
    where: {
      organizationId: input.organizationId,
      registerId: input.registerId,
      status: RegisterShiftStatus.OPEN,
    },
    orderBy: { openedAt: "desc" },
    include: {
      register: {
        select: { id: true, storeId: true, code: true, name: true, isActive: true },
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
) => {
  const normalized = payments
    .map((payment) => ({
      method: payment.method,
      amountKgs: roundMoney(payment.amountKgs),
      providerRef: payment.providerRef?.trim() || null,
    }))
    .filter((payment) => payment.amountKgs > 0);

  if (!normalized.length) {
    throw new AppError("posPaymentMissing", "BAD_REQUEST", 400);
  }

  return normalized;
};

const loadShiftReport = async (tx: Prisma.TransactionClient, input: {
  organizationId: string;
  shiftId: string;
}) => {
  const shift = await tx.registerShift.findFirst({
    where: { id: input.shiftId, organizationId: input.organizationId },
    include: {
      register: { select: { id: true, code: true, name: true } },
      store: { select: { id: true, name: true, code: true } },
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
  const expectedCashKgs = roundMoney(
    toMoney(shift.openingCashKgs) + payInKgs - payOutKgs + cashSalesKgs - cashRefundsKgs,
  );

  return {
    shift: {
      id: shift.id,
      status: shift.status,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      openingCashKgs: toMoney(shift.openingCashKgs),
      closingCashCountedKgs: shift.closingCashCountedKgs ? toMoney(shift.closingCashCountedKgs) : null,
      expectedCashKgs: shift.expectedCashKgs ? toMoney(shift.expectedCashKgs) : expectedCashKgs,
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
}) => {
  const registers = await prisma.posRegister.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.storeId ? { storeId: input.storeId } : {}),
    },
    include: {
      store: { select: { id: true, name: true, code: true } },
      shifts: {
        where: { status: RegisterShiftStatus.OPEN },
        orderBy: { openedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          openedAt: true,
          openedBy: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ store: { name: "asc" } }, { code: "asc" }],
  });

  return registers.map((register) => ({
    ...register,
    openShift: register.shifts[0] ?? null,
    shifts: undefined,
  }));
};

export const createPosRegister = async (input: {
  organizationId: string;
  storeId: string;
  name: string;
  code: string;
  actorId: string;
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
  name?: string;
  code?: string;
  isActive?: boolean;
  actorId: string;
  requestId: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const register = await tx.posRegister.findFirst({
      where: { id: input.registerId, organizationId: input.organizationId },
    });
    if (!register) {
      throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
    }

    const updated = await tx.posRegister.update({
      where: { id: register.id },
      data: {
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

export const getPosEntry = async (input: {
  organizationId: string;
  registerId?: string;
}) => {
  const registers = await listPosRegisters({ organizationId: input.organizationId });
  if (!registers.length) {
    return {
      registers: [],
      selectedRegister: null,
      currentShift: null,
    };
  }

  const selectedRegister =
    registers.find((register) => register.id === input.registerId) ?? registers[0] ?? null;

  const currentShift = selectedRegister?.openShift
    ? await getCurrentRegisterShift({
        organizationId: input.organizationId,
        registerId: selectedRegister.id,
      })
    : null;

  return {
    registers,
    selectedRegister,
    currentShift,
  };
};

export const openRegisterShift = async (input: {
  organizationId: string;
  registerId: string;
  openingCashKgs: number;
  notes?: string | null;
  actorId: string;
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
          select: { id: true, isActive: true, storeId: true, code: true },
        });
        if (!register) {
          throw new AppError("posRegisterNotFound", "NOT_FOUND", 404);
        }
        if (!register.isActive) {
          throw new AppError("posRegisterInactive", "CONFLICT", 409);
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

  return result;
};

export const getCurrentRegisterShift = async (input: {
  organizationId: string;
  registerId: string;
}) => {
  const shift = await prisma.registerShift.findFirst({
    where: {
      organizationId: input.organizationId,
      registerId: input.registerId,
      status: RegisterShiftStatus.OPEN,
    },
    include: {
      register: { select: { id: true, name: true, code: true } },
      store: { select: { id: true, name: true, code: true } },
      openedBy: { select: { id: true, name: true } },
    },
    orderBy: { openedAt: "desc" },
  });

  if (!shift) {
    return null;
  }

  return {
    ...shift,
    openingCashKgs: toMoney(shift.openingCashKgs),
    closingCashCountedKgs: shift.closingCashCountedKgs ? toMoney(shift.closingCashCountedKgs) : null,
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
        store: { select: { id: true, name: true, code: true } },
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
      closingCashCountedKgs: item.closingCashCountedKgs ? toMoney(item.closingCashCountedKgs) : null,
      expectedCashKgs: item.expectedCashKgs ? toMoney(item.expectedCashKgs) : null,
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
};

export const getShiftXReport = async (input: {
  organizationId: string;
  shiftId: string;
}) => {
  return prisma.$transaction(async (tx) => loadShiftReport(tx, input));
};

export const closeRegisterShift = async (input: {
  organizationId: string;
  shiftId: string;
  closingCashCountedKgs: number;
  notes?: string | null;
  actorId: string;
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
                ? roundMoney(toMoney(shift.closingCashCountedKgs) - toMoney(shift.expectedCashKgs))
                : null,
          };
        }

        const report = await loadShiftReport(tx, {
          organizationId: input.organizationId,
          shiftId: shift.id,
        });

        const counted = roundMoney(input.closingCashCountedKgs);
        const expected = roundMoney(report.summary.expectedCashKgs);
        const discrepancy = roundMoney(counted - expected);

        const updated = await tx.registerShift.update({
          where: { id: shift.id },
          data: {
            status: RegisterShiftStatus.CLOSED,
            closedAt: new Date(),
            closedById: input.actorId,
            closingCashCountedKgs: counted,
            expectedCashKgs: expected,
            notes: input.notes ?? shift.notes,
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

  return result;
};

export const createPosSaleDraft = async (input: {
  organizationId: string;
  registerId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  actorId: string;
  requestId: string;
  lines?: Array<{ productId: string; variantId?: string | null; qty: number }>;
}) => {
  return prisma.$transaction(async (tx) => {
    const shift = await requireOpenShift(tx, {
      organizationId: input.organizationId,
      registerId: input.registerId,
    });

    const existingDraft = await tx.customerOrder.findFirst({
      where: {
        organizationId: input.organizationId,
        storeId: shift.storeId,
        registerId: shift.registerId,
        shiftId: shift.id,
        createdById: input.actorId,
        isPosSale: true,
        status: CustomerOrderStatus.DRAFT,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        storeId: true,
        registerId: true,
        shiftId: true,
      },
    });
    if (existingDraft) {
      return existingDraft;
    }

    const number = await nextPosSaleNumber(tx, input.organizationId);

    const createOrder = () =>
      tx.customerOrder.create({
        data: {
          organizationId: input.organizationId,
          storeId: shift.storeId,
          registerId: shift.registerId,
          shiftId: shift.id,
          number,
          isPosSale: true,
          status: CustomerOrderStatus.DRAFT,
          customerName: input.customerName ?? null,
          customerPhone: input.customerPhone ?? null,
          notes: input.notes ?? null,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
      });

    let order: Awaited<ReturnType<typeof createOrder>>;
    try {
      order = await createOrder();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const concurrentDraft = await tx.customerOrder.findFirst({
          where: {
            organizationId: input.organizationId,
            storeId: shift.storeId,
            registerId: shift.registerId,
            shiftId: shift.id,
            createdById: input.actorId,
            isPosSale: true,
            status: CustomerOrderStatus.DRAFT,
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            number: true,
            status: true,
            storeId: true,
            registerId: true,
            shiftId: true,
          },
        });
        if (concurrentDraft) {
          return concurrentDraft;
        }
      }
      throw error;
    }

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
    };
  });
};

export const getActivePosSaleDraft = async (input: {
  organizationId: string;
  registerId: string;
  actorId: string;
}) => {
  const draft = await prisma.customerOrder.findFirst({
    where: {
      organizationId: input.organizationId,
      registerId: input.registerId,
      createdById: input.actorId,
      isPosSale: true,
      status: CustomerOrderStatus.DRAFT,
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
    },
  });
  return draft;
};

export const cancelPosSaleDraft = async (input: {
  organizationId: string;
  saleId: string;
  actorId: string;
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
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}) => {
  const where: Prisma.CustomerOrderWhereInput = {
    organizationId: input.organizationId,
    isPosSale: true,
    ...(input.storeId ? { storeId: input.storeId } : {}),
    ...(input.registerId ? { registerId: input.registerId } : {}),
    ...(input.statuses?.length ? { status: { in: input.statuses } } : {}),
    ...(input.search
      ? {
          OR: [
            { number: { contains: input.search, mode: "insensitive" } },
            { customerName: { contains: input.search, mode: "insensitive" } },
            { customerPhone: { contains: input.search, mode: "insensitive" } },
          ],
        }
      : {}),
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
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, code: true } },
        register: { select: { id: true, name: true, code: true } },
        payments: {
          select: { id: true, method: true, amountKgs: true, isRefund: true, createdAt: true },
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
      returnedTotalKgs: roundMoney(item.saleReturns.reduce((sum, row) => sum + toMoney(row.totalKgs), 0)),
      ...item,
      subtotalKgs: toMoney(item.subtotalKgs),
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

export const getPosSale = async (input: {
  organizationId: string;
  saleId: string;
}) => {
  const sale = await prisma.customerOrder.findFirst({
    where: {
      id: input.saleId,
      organizationId: input.organizationId,
      isPosSale: true,
    },
    include: {
      store: { select: { id: true, name: true, code: true } },
      register: { select: { id: true, name: true, code: true } },
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
              isBundle: true,
              baseUnit: { select: { code: true, labelRu: true, labelKg: true } },
            },
          },
          variant: { select: { id: true, name: true } },
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

  return {
    ...sale,
    subtotalKgs: toMoney(sale.subtotalKgs),
    totalKgs: toMoney(sale.totalKgs),
    lines: sale.lines.map((line) => ({
      ...line,
      unitPriceKgs: toMoney(line.unitPriceKgs),
      lineTotalKgs: toMoney(line.lineTotalKgs),
      unitCostKgs: line.unitCostKgs ? toMoney(line.unitCostKgs) : null,
      lineCostTotalKgs: line.lineCostTotalKgs ? toMoney(line.lineCostTotalKgs) : null,
    })),
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

export const addPosSaleLine = async (input: {
  organizationId: string;
  saleId: string;
  productId: string;
  variantId?: string | null;
  qty: number;
  actorId: string;
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
      },
    });
    if (!sale) {
      throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    }
    if (sale.status !== CustomerOrderStatus.DRAFT) {
      throw new AppError("posSaleNotEditable", "CONFLICT", 409);
    }

    const resolved = await resolveUnitPrice({
      tx,
      organizationId: input.organizationId,
      storeId: sale.storeId,
      productId: input.productId,
      variantId: input.variantId ?? null,
    });
    const unitCost = await resolveUnitCost({
      tx,
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      isBundle: resolved.isBundle,
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
      throw new AppError("duplicateLineItem", "CONFLICT", 409);
    }

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
    };
  });
};

export const updatePosSaleLine = async (input: {
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
    if (!line || !line.customerOrder.isPosSale) {
      throw new AppError("posSaleLineNotFound", "NOT_FOUND", 404);
    }
    if (line.customerOrder.organizationId !== input.organizationId) {
      throw new AppError("salesOrderOrgMismatch", "FORBIDDEN", 403);
    }
    if (line.customerOrder.status !== CustomerOrderStatus.DRAFT) {
      throw new AppError("posSaleNotEditable", "CONFLICT", 409);
    }

    const updated = await tx.customerOrderLine.update({
      where: { id: line.id },
      data: {
        qty: input.qty,
        lineTotalKgs: roundMoney(toMoney(line.unitPriceKgs) * input.qty),
        lineCostTotalKgs:
          line.unitCostKgs === null
            ? null
            : roundMoney(toMoney(line.unitCostKgs) * input.qty),
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
    if (line.customerOrder.status !== CustomerOrderStatus.DRAFT) {
      throw new AppError("posSaleNotEditable", "CONFLICT", 409);
    }

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

export const completePosSale = async (input: {
  organizationId: string;
  saleId: string;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  payments: Array<{ method: PosPaymentMethod; amountKgs: number; providerRef?: string | null }>;
}) => {
  const logger = getLogger(input.requestId);
  const normalizedPayments = normalizePayments(input.payments);

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
              select: { id: true, name: true, code: true },
            },
          },
        });

        if (!sale) {
          throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
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

        const orderTotal = roundMoney(toMoney(sale.totalKgs));
        const paymentsTotal = sumPayments(normalizedPayments);
        if (Math.abs(paymentsTotal - orderTotal) > 0.009) {
          throw new AppError("posPaymentTotalMismatch", "BAD_REQUEST", 400);
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
          });
        }

        await tx.salePayment.createMany({
          data: normalizedPayments.map((payment) => ({
            organizationId: input.organizationId,
            storeId: sale.storeId,
            shiftId: shift.id,
            customerOrderId: sale.id,
            method: payment.method,
            amountKgs: payment.amountKgs,
            providerRef: payment.providerRef,
            isRefund: false,
            createdById: input.actorId,
          })),
        });

        const updated = await tx.customerOrder.update({
          where: { id: sale.id },
          data: {
            status: CustomerOrderStatus.COMPLETED,
            completedAt: new Date(),
            completedEventId: input.idempotencyKey,
            updatedById: input.actorId,
          },
        });

        const compliance = await tx.storeComplianceProfile.findUnique({
          where: { storeId: sale.storeId },
          select: {
            enableKkm: true,
            kkmMode: true,
            kkmProviderKey: true,
          },
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

        const kkmCandidate: FiscalReceiptDraft | null =
          compliance?.enableKkm && compliance.kkmMode === "ADAPTER"
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
                },
              }
            : null;

        return {
          id: updated.id,
          number: updated.number,
          status: updated.status,
          storeId: updated.storeId,
          registerId: updated.registerId,
          shiftId: updated.shiftId,
          productIds: sale.lines.map((line) => line.productId),
          kkmCandidate,
          kkmProviderKey: compliance?.kkmProviderKey ?? null,
        };
      },
    );

    return { ...completion, replayed };
  });

  if (!result.replayed && result.kkmCandidate) {
    try {
      const adapter = getKkmAdapter(result.kkmProviderKey);
      const fiscalized = await adapter.fiscalizeReceipt(result.kkmCandidate);
      await prisma.customerOrder.update({
        where: { id: result.id },
        data: {
          kkmStatus: "SENT",
          kkmReceiptId: fiscalized.providerReceiptId,
          kkmRawJson: fiscalized.rawJson ?? Prisma.DbNull,
        },
      });
    } catch (error) {
      await prisma.customerOrder.update({
        where: { id: result.id },
        data: {
          kkmStatus: "FAILED",
          kkmRawJson: toJson({
            message: error instanceof Error ? error.message : String(error),
          }) as Prisma.InputJsonValue,
        },
      });
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

  return {
    id: result.id,
    number: result.number,
    status: result.status,
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
      select: { id: true, registerId: true, storeId: true },
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
      },
    });
    if (!originalSale) {
      throw new AppError("posSaleNotFound", "NOT_FOUND", 404);
    }
    if (originalSale.storeId !== shift.storeId) {
      throw new AppError("posReturnStoreMismatch", "CONFLICT", 409);
    }

    const number = await nextPosReturnNumber(tx, input.organizationId);

    const created = await tx.saleReturn.create({
      data: {
        organizationId: input.organizationId,
        storeId: shift.storeId,
        registerId: shift.registerId,
        shiftId: shift.id,
        originalSaleId: originalSale.id,
        number,
        notes: input.notes ?? null,
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

const assertReturnLineAvailable = async (tx: Prisma.TransactionClient, input: {
  customerOrderLineId: string;
  requestedQty: number;
  excludeReturnLineId?: string;
}) => {
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
          line.unitCostKgs === null
            ? null
            : roundMoney(toMoney(line.unitCostKgs) * input.qty),
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
        store: { select: { id: true, name: true, code: true } },
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

export const getSaleReturn = async (input: {
  organizationId: string;
  saleReturnId: string;
}) => {
  const saleReturn = await prisma.saleReturn.findFirst({
    where: {
      id: input.saleReturnId,
      organizationId: input.organizationId,
    },
    include: {
      register: { select: { id: true, name: true, code: true } },
      store: { select: { id: true, name: true, code: true } },
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
          select: { id: true },
        });
        if (!shift) {
          throw new AppError("posShiftNotOpen", "CONFLICT", 409);
        }

        if (!saleReturn.lines.length) {
          throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
        }

        const returnTotal = roundMoney(toMoney(saleReturn.totalKgs));
        const paymentsTotal = sumPayments(normalizedPayments);
        if (Math.abs(paymentsTotal - returnTotal) > 0.009) {
          throw new AppError("posPaymentTotalMismatch", "BAD_REQUEST", 400);
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

    await prisma.customerOrder.update({
      where: { id: sale.id },
      data: {
        kkmStatus: "SENT",
        kkmReceiptId: fiscalized.providerReceiptId,
        kkmRawJson: fiscalized.rawJson ?? Prisma.DbNull,
      },
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
    await prisma.customerOrder.update({
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
          select: { id: true, storeId: true, status: true },
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
