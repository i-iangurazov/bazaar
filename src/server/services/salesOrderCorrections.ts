import { createHash } from "node:crypto";
import {
  CustomerOrderSource,
  CustomerOrderStatus,
  PosPaymentMethod,
  PosReturnStatus,
  Prisma,
  RefundRequestStatus,
  RegisterShiftStatus,
  SalePaymentSettlement,
  StockMovementType,
} from "@prisma/client";

import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { withIdempotency } from "@/server/services/idempotency";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";
import { applyStockMovement } from "@/server/services/inventory";
import { lockAssortmentForSale } from "@/server/services/assortmentPolicy";
import { assertUserCanAccessStore, type StoreAccessUser } from "@/server/services/storeAccess";
import { reverseLoyaltyForReturn } from "@/server/services/loyalty/apply";
import { eventBus } from "@/server/events/eventBus";
import { resolveCurrencySnapshot } from "@/lib/currencyDisplay";
import { roundQuantity } from "@/lib/quantity";
import {
  allocatedReturnAmount,
  assertRefundWithinPaidAmount,
  assertReturnLineAvailable,
  nextPosReturnNumber,
} from "@/server/services/pos";
import {
  completeCustomerOrderTx,
  nextSalesOrderNumber,
  orderLineTotal,
  recomputeTotals,
  resolveUnitCost,
  resolveUnitPrice,
} from "@/server/services/salesOrders";
import type { StorePriceMode } from "@/server/services/storeSellingPrice";

const FAST_CORRECTION_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 };
const MAX_REASON_LENGTH = 500;

export type CorrectionReturnLineInput = {
  lineId: string;
  qty: number;
  restock: boolean;
};

export type CorrectionAdditionLineInput = {
  productId: string;
  variantId?: string | null;
  qty: number;
  unitPriceKgs?: number;
  priceMode?: StorePriceMode | null;
};

type CorrectionMoneySnapshot = {
  /** Non-refund payments with a settled money state (actual or credited by an exchange). */
  paidKgs: number;
  /** Completed sale return documents for this order, at their gross document value. */
  returnedKgs: number;
  /** Refund payments whose money has actually left the register. */
  actualRefundedKgs: number;
  /** Open correction refund requests that still oblige the store to pay out. */
  pendingRefundKgs: number;
  /** Refund payments settled by exchanging goods instead of money. */
  offsetKgs: number;
  /** Paid value not consumed by a completed return or exchange. */
  netPaidKgs: number;
  /** UI alias kept for the correction quote: previously refunded money. */
  refundedKgs: number;
  orderTotalKgs: number;
};

type CorrectionReturnQuote = {
  lineId: string;
  productId: string;
  productName: string;
  productSku: string;
  variantName: string | null;
  qty: number;
  selectedQty: number;
  returnedQty: number;
  availableQty: number;
  unitPriceKgs: number;
  returnAmountKgs: number;
  restock: boolean;
};

type CorrectionAdditionQuote = {
  productId: string;
  variantId: string | null;
  productName: string;
  productSku: string;
  variantName: string | null;
  qty: number;
  unitPriceKgs: number;
  lineTotalKgs: number;
  priceSource: string;
  onHand: number | null;
};

type CorrectionQuoteResult = {
  originalOrderId: string;
  originalNumber: string;
  status: CustomerOrderStatus;
  storeId: string;
  storeName: string;
  currencyCode: string;
  currencyRateKgsPerUnit: number;
  priceMode: StorePriceMode;
  retailWholesaleEnabled: boolean;
  money: CorrectionMoneySnapshot;
  returns: CorrectionReturnQuote[];
  additions: CorrectionAdditionQuote[];
  returnedKgs: number;
  addedKgs: number;
  refundKgs: number;
  chargeKgs: number;
  openShifts: Array<{ id: string; registerId: string; registerName: string; openedAt: Date }>;
  fingerprint: string;
  warnings: string[];
};

type CorrectionQuoteInput = {
  organizationId: string;
  actorId: string;
  originalOrderId: string;
  returns: CorrectionReturnLineInput[];
  additions: CorrectionAdditionLineInput[];
  priceMode?: StorePriceMode | null;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const assertActorCanManageCorrectionsTx = async (
  tx: Prisma.TransactionClient,
  input: { organizationId: string; actorId: string; storeId: string },
) => {
  const actor = await tx.user.findFirst({
    where: { id: input.actorId, organizationId: input.organizationId, isActive: true },
    select: { id: true, organizationId: true, role: true, isOrgOwner: true },
  });
  if (!actor?.organizationId) throw new AppError("storeAccessDenied", "FORBIDDEN", 403);
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") {
    throw new AppError("forbidden", "FORBIDDEN", 403);
  }
  await assertUserCanAccessStore(tx, actor as StoreAccessUser, input.storeId);
  return actor;
};

const nextCorrectionNumber = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const rows = await tx.$queryRaw<Array<{ salesCorrectionNumber: number }>>(Prisma.sql`
    INSERT INTO "OrganizationCounter" (
      "organizationId", "salesOrderNumber", "posSaleNumber", "posReturnNumber", "salesCorrectionNumber", "updatedAt"
    )
    VALUES (${organizationId}, 0, 0, 0, 1, NOW())
    ON CONFLICT ("organizationId")
    DO UPDATE SET
      "salesCorrectionNumber" = "OrganizationCounter"."salesCorrectionNumber" + 1,
      "updatedAt" = NOW()
    RETURNING "salesCorrectionNumber"
  `);
  const sequence = rows[0]?.salesCorrectionNumber;
  if (!sequence) throw new AppError("salesCorrectionCounterFailed", "INTERNAL_SERVER_ERROR", 500);
  return `CR-${String(sequence).padStart(6, "0")}`;
};

const normalizeReturns = (input: CorrectionReturnLineInput[]) => {
  if (input.length > 500) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const seen = new Set<string>();
  return input.map((line) => {
    if (!line.lineId || seen.has(line.lineId)) {
      throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
    }
    seen.add(line.lineId);
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      throw new AppError("invalidSalesQuantity", "BAD_REQUEST", 400);
    }
    return { ...line, qty: roundQuantity(line.qty) };
  });
};

const normalizeAdditions = (input: CorrectionAdditionLineInput[]) => {
  if (input.length > 500) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const seen = new Set<string>();
  return input.map((line) => {
    const key = `${line.productId}:${line.variantId ?? "BASE"}`;
    if (!line.productId || seen.has(key)) {
      throw new AppError("duplicateLineItem", "BAD_REQUEST", 400);
    }
    seen.add(key);
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      throw new AppError("invalidSalesQuantity", "BAD_REQUEST", 400);
    }
    return { ...line, qty: roundQuantity(line.qty) };
  });
};

const loadPaidSnapshot = async (
  tx: Prisma.TransactionClient,
  customerOrderId: string,
): Promise<CorrectionMoneySnapshot> => {
  const [paid, actualRefunded, offsetRefunded, returned, pending, order] = await Promise.all([
    tx.salePayment.aggregate({
      where: {
        customerOrderId,
        isRefund: false,
        settlementStatus: { in: [SalePaymentSettlement.ACTUAL, SalePaymentSettlement.OFFSET] },
      },
      _sum: { amountKgs: true },
    }),
    tx.salePayment.aggregate({
      where: {
        customerOrderId,
        isRefund: true,
        settlementStatus: SalePaymentSettlement.ACTUAL,
      },
      _sum: { amountKgs: true },
    }),
    tx.salePayment.aggregate({
      where: {
        customerOrderId,
        isRefund: true,
        settlementStatus: SalePaymentSettlement.OFFSET,
      },
      _sum: { amountKgs: true },
    }),
    tx.saleReturn.aggregate({
      where: { originalSaleId: customerOrderId, status: PosReturnStatus.COMPLETED },
      _sum: { totalKgs: true },
    }),
    tx.refundRequest.aggregate({
      where: {
        originalSaleId: customerOrderId,
        status: RefundRequestStatus.OPEN,
        reasonCode: "SALES_ORDER_CORRECTION",
      },
      _sum: { amountKgs: true },
    }),
    tx.customerOrder.findUniqueOrThrow({
      where: { id: customerOrderId },
      select: { totalKgs: true },
    }),
  ]);
  const paidKgs = roundMoney(Number(paid._sum.amountKgs ?? 0));
  const returnedKgs = roundMoney(Number(returned._sum.totalKgs ?? 0));
  const actualRefundedKgs = roundMoney(Number(actualRefunded._sum.amountKgs ?? 0));
  const pendingRefundKgs = roundMoney(Number(pending._sum.amountKgs ?? 0));
  const offsetKgs = roundMoney(Number(offsetRefunded._sum.amountKgs ?? 0));
  return {
    paidKgs,
    returnedKgs,
    actualRefundedKgs,
    pendingRefundKgs,
    offsetKgs,
    // A pending obligation is reserved even before money leaves the register,
    // so the balance does not look larger until the payout is confirmed.
    netPaidKgs: roundMoney(paidKgs - actualRefundedKgs - pendingRefundKgs - offsetKgs),
    refundedKgs: actualRefundedKgs,
    orderTotalKgs: Number(order.totalKgs),
  };
};

const assertCorrectionAccountingAvailable = async (
  tx: Prisma.TransactionClient,
  customerOrderId: string,
) => {
  const [order, fiscal, pendingRefund] = await Promise.all([
    tx.customerOrder.findUniqueOrThrow({
      where: { id: customerOrderId },
      select: { kkmStatus: true, kkmReceiptId: true, kkmRawJson: true },
    }),
    tx.fiscalReceipt.findFirst({ where: { customerOrderId }, select: { id: true } }),
    tx.refundRequest.findFirst({
      where: { originalSaleId: customerOrderId, status: "OPEN" },
      select: { id: true },
    }),
  ]);
  if (
    fiscal ||
    order.kkmStatus !== "NOT_SENT" ||
    order.kkmReceiptId ||
    order.kkmRawJson
  ) {
    throw new AppError("salesOrderCorrectionFiscalUnsupported", "CONFLICT", 409);
  }
  if (pendingRefund) {
    throw new AppError("salesOrderCorrectionRefundPending", "CONFLICT", 409);
  }
};

const quoteHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const quoteSalesOrderCorrection = async (
  input: CorrectionQuoteInput,
): Promise<CorrectionQuoteResult> =>
  prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findFirst({
      where: {
        id: input.originalOrderId,
        organizationId: input.organizationId,
        isPosSale: false,
      },
      include: {
        store: { select: { id: true, name: true, currencyCode: true, currencyRateKgsPerUnit: true } },
        lines: {
          orderBy: { id: "asc" },
          include: {
            product: { select: { name: true, sku: true } },
            variant: { select: { name: true } },
            saleReturnLines: {
              where: { saleReturn: { status: PosReturnStatus.COMPLETED } },
              select: { qty: true },
            },
          },
        },
      },
    });
    if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
    await assertActorCanManageCorrectionsTx(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      storeId: order.storeId,
    });
    if (order.status !== CustomerOrderStatus.COMPLETED) {
      throw new AppError("salesOrderCorrectionRequiresCompleted", "CONFLICT", 409);
    }
    const money = await loadPaidSnapshot(tx, order.id);
    if (money.paidKgs + 0.005 < money.orderTotalKgs) {
      throw new AppError("onlineReturnRequiresPayment", "CONFLICT", 409);
    }
    await assertCorrectionAccountingAvailable(tx, order.id);
    const returns = normalizeReturns(input.returns ?? []);
    const additions = normalizeAdditions(input.additions ?? []);
    const retailWholesaleEnabled =
      (
        await tx.organization.findUnique({
          where: { id: input.organizationId },
          select: { retailWholesaleEnabled: true },
        })
      )?.retailWholesaleEnabled ?? false;
    const priceMode: StorePriceMode =
      retailWholesaleEnabled && (input.priceMode ?? order.priceMode) === "WHOLESALE"
        ? "WHOLESALE"
        : "RETAIL";

    const returnQuotes: CorrectionReturnQuote[] = [];
    for (const line of returns) {
      const source = order.lines.find((row) => row.id === line.lineId);
      if (!source) throw new AppError("salesOrderLineNotFound", "NOT_FOUND", 404);
      await assertReturnLineAvailable(tx, {
        customerOrderLineId: source.id,
        requestedQty: line.qty,
      });
      const returnAmount = await allocatedReturnAmount(tx, source, line.qty);
      const returnedQty = source.saleReturnLines.reduce((sum, row) => sum + row.qty, 0);
      returnQuotes.push({
        lineId: source.id,
        productId: source.productId,
        productName: source.product.name,
        productSku: source.product.sku,
        variantName: source.variant?.name ?? null,
        qty: source.qty,
        selectedQty: line.qty,
        returnedQty: roundQuantity(returnedQty),
        availableQty: roundQuantity(source.qty - returnedQty),
        unitPriceKgs: Number(source.unitPriceKgs),
        returnAmountKgs: Number(returnAmount),
        restock: line.restock !== false,
      });
    }

    const additionQuotes: CorrectionAdditionQuote[] = [];
    for (const line of additions) {
      const resolved = await resolveUnitPrice({
        tx,
        organizationId: input.organizationId,
        storeId: order.storeId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        priceMode,
        retailWholesaleEnabled,
      });
      const unitPriceKgs =
        line.unitPriceKgs === undefined ? resolved.unitPrice : Number(line.unitPriceKgs);
      if (line.unitPriceKgs === undefined && !resolved.hasConfiguredPrice) {
        throw new AppError("salesOrderPriceRequired", "BAD_REQUEST", 400);
      }
      const product = await tx.product.findFirst({
        where: {
          id: line.productId,
          organizationId: input.organizationId,
          isDeleted: false,
          storeProducts: { some: { organizationId: input.organizationId, storeId: order.storeId, isActive: true } },
        },
        select: { name: true, sku: true },
      });
      if (!product) throw new AppError("productNotFound", "NOT_FOUND", 404);
      const variant = line.variantId
        ? await tx.productVariant.findFirst({
            where: { id: line.variantId, productId: line.productId, isActive: true },
            select: { name: true },
          })
        : null;
      const snapshot = await tx.inventorySnapshot.findUnique({
        where: {
          storeId_productId_variantKey: {
            storeId: order.storeId,
            productId: line.productId,
            variantKey: line.variantId ?? "BASE",
          },
        },
        select: { onHand: true },
      });
      additionQuotes.push({
        productId: line.productId,
        variantId: line.variantId ?? null,
        productName: product.name,
        productSku: product.sku,
        variantName: variant?.name ?? null,
        qty: line.qty,
        unitPriceKgs,
        lineTotalKgs: orderLineTotal(unitPriceKgs, line.qty),
        priceSource: line.unitPriceKgs === undefined ? resolved.priceSource : "MANUAL",
        onHand: snapshot?.onHand ?? null,
      });
    }

    const returnedKgs = roundMoney(
      returnQuotes.reduce((sum, line) => sum + line.returnAmountKgs, 0),
    );
    const addedKgs = roundMoney(
      additionQuotes.reduce((sum, line) => sum + line.lineTotalKgs, 0),
    );
    const net = roundMoney(returnedKgs - addedKgs);
    const openShifts = await tx.registerShift.findMany({
      where: {
        organizationId: input.organizationId,
        storeId: order.storeId,
        status: RegisterShiftStatus.OPEN,
        register: { isActive: true },
      },
      select: { id: true, registerId: true, openedAt: true, register: { select: { name: true } } },
      orderBy: { openedAt: "desc" },
    });
    const fingerprint = quoteHash({
      orderId: order.id,
      money,
      priceMode,
      returns: returnQuotes.map((line) => ({
        lineId: line.lineId,
        qty: line.selectedQty,
        amount: line.returnAmountKgs,
        restock: line.restock,
      })),
      additions: additionQuotes.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        qty: line.qty,
        price: line.unitPriceKgs,
      })),
    });
    return {
      originalOrderId: order.id,
      originalNumber: order.number,
      status: order.status,
      storeId: order.storeId,
      storeName: order.store.name,
      currencyCode: order.currencyCode ?? order.store.currencyCode,
      currencyRateKgsPerUnit: Number(
        order.currencyRateKgsPerUnit ?? order.store.currencyRateKgsPerUnit,
      ),
      priceMode,
      retailWholesaleEnabled,
      money,
      returns: returnQuotes,
      additions: additionQuotes,
      returnedKgs,
      addedKgs,
      refundKgs: net > 0 ? net : 0,
      chargeKgs: net < 0 ? roundMoney(-net) : 0,
      openShifts: openShifts.map((shift) => ({
        id: shift.id,
        registerId: shift.registerId,
        registerName: shift.register.name,
        openedAt: shift.openedAt,
      })),
      fingerprint,
      warnings: [
        ...(retailWholesaleEnabled
          ? []
          : ["Цены розница/опт не включены в настройках организации; новые товары получат обычную цену магазина."]),
        ...(openShifts.length
          ? []
          : ["Нет открытой смены: корректировка с возвратом или доплатой недоступна до открытия смены."]),
      ],
    };
  });

export type CorrectCompletedCustomerOrderInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  originalOrderId: string;
  expectedFingerprint: string;
  reason: string;
  notes?: string | null;
  returns: CorrectionReturnLineInput[];
  additions: CorrectionAdditionLineInput[];
  priceMode?: StorePriceMode | null;
  shiftId: string;
  paymentMethod: PosPaymentMethod;
  idempotencyKey: string;
  /**
   * Test-only synchronization point. Never exposed through tRPC: it runs inside
   * the correction transaction after every read and validation, immediately
   * before the first financial or stock write.
   */
  testHooks?: {
    afterValidation?: (tx: Prisma.TransactionClient) => Promise<void>;
  } | null;
};

export const correctCompletedCustomerOrder = async (
  input: CorrectCompletedCustomerOrderInput,
) => {
  const reason = input.reason.trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  }
  const returns = normalizeReturns(input.returns ?? []);
  const additions = normalizeAdditions(input.additions ?? []);
  if (!returns.length && !additions.length) {
    throw new AppError("salesOrderCorrectionEmpty", "BAD_REQUEST", 400);
  }

  let completion: { id: string; storeId: string; productIds: string[]; previousStatus: CustomerOrderStatus; status: CustomerOrderStatus; alreadyCompleted: boolean } | null = null;
  const correctionEvents: Array<{ storeId: string; productId: string }> = [];

  const operation = await prisma.$transaction(
    async (tx) => {
      await lockAssortmentForSale(tx, input.organizationId);
      const { result } = await withIdempotency(
        tx,
        {
          key: input.idempotencyKey,
          route: "salesOrders.correction.v1",
          userId: input.actorId,
          request: {
            originalOrderId: input.originalOrderId,
            expectedFingerprint: input.expectedFingerprint,
            reason,
            notes: input.notes ?? null,
            returns,
            additions,
            shiftId: input.shiftId,
            paymentMethod: input.paymentMethod,
          },
        },
        async () => {
          // Lock order matches closeRegisterShift and payment recording: the
          // shift is locked before the customer order so a shift close can
          // never compute totals while a correction is being written into it.
          await tx.$queryRaw`
            SELECT "id"
            FROM "RegisterShift"
            WHERE "id" = ${input.shiftId}
              AND "organizationId" = ${input.organizationId}
            FOR UPDATE
          `;
          await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${input.originalOrderId} FOR UPDATE`;
          const order = await tx.customerOrder.findFirst({
            where: {
              id: input.originalOrderId,
              organizationId: input.organizationId,
              isPosSale: false,
            },
            include: {
              store: {
                select: {
                  id: true,
                  currencyCode: true,
                  currencyRateKgsPerUnit: true,
                  allowNegativeStock: true,
                },
              },
              lines: {
                orderBy: { id: "asc" },
                include: {
                  product: { select: { name: true, sku: true } },
                  variant: { select: { name: true } },
                  saleReturnLines: {
                    where: { saleReturn: { status: PosReturnStatus.COMPLETED } },
                    select: { qty: true },
                  },
                },
              },
              payments: { where: { isRefund: false }, select: { id: true, method: true, shiftId: true, amountKgs: true } },
            },
          });
          if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
          await assertActorCanManageCorrectionsTx(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            storeId: order.storeId,
          });
          if (order.status !== CustomerOrderStatus.COMPLETED) {
            throw new AppError("salesOrderCorrectionRequiresCompleted", "CONFLICT", 409);
          }
          const money = await loadPaidSnapshot(tx, order.id);
          if (money.paidKgs + 0.005 < money.orderTotalKgs) {
            throw new AppError("onlineReturnRequiresPayment", "CONFLICT", 409);
          }
          // Re-check after the row lock: a fiscal receipt or a manual refund
          // may have been written after the operator obtained the quote.
          await assertCorrectionAccountingAvailable(tx, order.id);

          const retailWholesaleEnabled =
            (
              await tx.organization.findUnique({
                where: { id: input.organizationId },
                select: { retailWholesaleEnabled: true },
              })
            )?.retailWholesaleEnabled ?? false;
          const priceMode: StorePriceMode =
            retailWholesaleEnabled && (input.priceMode ?? order.priceMode) === "WHOLESALE"
              ? "WHOLESALE"
              : "RETAIL";

          const returnQuotes: Array<{
            source: (typeof order.lines)[number];
            qty: number;
            restock: boolean;
            amount: Prisma.Decimal;
          }> = [];
          for (const line of returns) {
            const source = order.lines.find((row) => row.id === line.lineId);
            if (!source) throw new AppError("salesOrderLineNotFound", "NOT_FOUND", 404);
            await assertReturnLineAvailable(tx, {
              customerOrderLineId: source.id,
              requestedQty: line.qty,
            });
            const amount = await allocatedReturnAmount(tx, source, line.qty);
            returnQuotes.push({ source, qty: line.qty, restock: line.restock !== false, amount });
          }

          const additionQuotes: Array<{
            productId: string;
            variantId: string | null;
            qty: number;
            unitPriceKgs: number;
            lineTotalKgs: number;
            priceSource: string;
            baseUnitPriceKgs: number;
            appliedDiscountType: string | null;
            appliedDiscountPercentage: number | null;
            appliedDiscountAmountKgs: number | null;
            unitCostKgs: number | null;
            lineCostTotalKgs: number | null;
            variantKey: string;
            isBundle: boolean;
          }> = [];
          for (const line of additions) {
            const resolved = await resolveUnitPrice({
              tx,
              organizationId: input.organizationId,
              storeId: order.storeId,
              productId: line.productId,
              variantId: line.variantId ?? null,
              priceMode,
              retailWholesaleEnabled,
            });
            if (line.unitPriceKgs === undefined && !resolved.hasConfiguredPrice) {
              throw new AppError("salesOrderPriceRequired", "BAD_REQUEST", 400);
            }
            const unitPriceKgs =
              line.unitPriceKgs === undefined
                ? resolved.unitPrice
                : new Prisma.Decimal(line.unitPriceKgs)
                    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
                    .toNumber();
            if (
              !Number.isFinite(unitPriceKgs) ||
              unitPriceKgs < 0 ||
              unitPriceKgs > 9_999_999_999.99
            ) {
              throw new AppError("invalidInput", "BAD_REQUEST", 400);
            }
            const unitCostKgs = await resolveUnitCost({
              tx,
              organizationId: input.organizationId,
              productId: line.productId,
              variantId: line.variantId ?? null,
              isBundle: resolved.isBundle,
            });
            additionQuotes.push({
              productId: line.productId,
              variantId: line.variantId ?? null,
              qty: line.qty,
              unitPriceKgs,
              lineTotalKgs: orderLineTotal(unitPriceKgs, line.qty),
              priceSource: line.unitPriceKgs === undefined ? resolved.priceSource : "MANUAL",
              baseUnitPriceKgs:
                line.unitPriceKgs === undefined
                  ? Number(resolved.baseUnitPriceKgs)
                  : unitPriceKgs,
              appliedDiscountType:
                line.unitPriceKgs === undefined ? resolved.appliedDiscountType : null,
              appliedDiscountPercentage:
                line.unitPriceKgs === undefined && resolved.appliedDiscountPercentage !== null
                  ? Number(resolved.appliedDiscountPercentage)
                  : null,
              appliedDiscountAmountKgs:
                line.unitPriceKgs === undefined && resolved.appliedDiscountAmountKgs !== null
                  ? Number(resolved.appliedDiscountAmountKgs)
                  : null,
              unitCostKgs,
              lineCostTotalKgs:
                unitCostKgs === null ? null : roundMoney(unitCostKgs * line.qty),
              variantKey: resolved.variantKey,
              isBundle: resolved.isBundle,
            });
          }

          const returnedKgs = roundMoney(
            returnQuotes.reduce((sum, line) => sum + Number(line.amount), 0),
          );
          const addedKgs = roundMoney(
            additionQuotes.reduce((sum, line) => sum + line.lineTotalKgs, 0),
          );
          const net = roundMoney(returnedKgs - addedKgs);
          const offsetKgs = roundMoney(Math.min(returnedKgs, addedKgs));
          const refundKgs = net > 0 ? net : 0;
          const chargeKgs = net < 0 ? roundMoney(-net) : 0;
          const actualRefundKgs =
            refundKgs > 0 && input.paymentMethod !== PosPaymentMethod.TRANSFER ? refundKgs : 0;
          const pendingRefundKgs =
            refundKgs > 0 && input.paymentMethod === PosPaymentMethod.TRANSFER ? refundKgs : 0;
          const actualChargeKgs = chargeKgs;

          const shift = await tx.registerShift.findFirst({
            where: {
              id: input.shiftId,
              organizationId: input.organizationId,
              storeId: order.storeId,
              status: RegisterShiftStatus.OPEN,
              register: { isActive: true },
            },
            select: {
              id: true,
              registerId: true,
              currencyCode: true,
              currencyRateKgsPerUnit: true,
              store: { select: { currencyCode: true, currencyRateKgsPerUnit: true } },
            },
          });
          if (!shift) throw new AppError("posShiftNotOpen", "CONFLICT", 409);
          if (
            input.paymentMethod === PosPaymentMethod.CARD &&
            refundKgs > 0 &&
            !order.payments.some(
              (payment) => payment.method === PosPaymentMethod.CARD && payment.shiftId === shift.id,
            )
          ) {
            throw new AppError("posCardRefundShiftMismatch", "CONFLICT", 409);
          }
          // One correction currency: the original sale snapshot with the
          // current store values only as a legacy fallback. The store rate may
          // have changed since the sale, so it must not reinterpret the
          // addition order or its payments.
          const correctionCurrency = resolveCurrencySnapshot({
            currencyCode: order.currencyCode ?? order.store.currencyCode,
            currencyRateKgsPerUnit:
              order.currencyRateKgsPerUnit ?? order.store.currencyRateKgsPerUnit,
          });

          const expectedFingerprint = quoteHash({
            orderId: order.id,
            money,
            priceMode,
            returns: returnQuotes.map((line) => ({
              lineId: line.source.id,
              qty: line.qty,
              amount: Number(line.amount),
              restock: line.restock,
            })),
            additions: additionQuotes.map((line) => ({
              productId: line.productId,
              variantId: line.variantId,
              qty: line.qty,
              price: line.unitPriceKgs,
            })),
          });
          if (expectedFingerprint !== input.expectedFingerprint) {
            throw new AppError("salesOrderCorrectionChanged", "CONFLICT", 409);
          }
          if (refundKgs > 0) {
            await assertRefundWithinPaidAmount(
              tx,
              order.id,
              order.totalKgs,
              new Prisma.Decimal(refundKgs),
            );
          }

          // Test-only deterministic race point: all reads and validation have
          // completed and the shift/order locks are held, but no financial or
          // stock row has been written yet.
          if (input.testHooks?.afterValidation) {
            await input.testHooks.afterValidation(tx);
          }

          let saleReturnId: string | null = null;
          let saleReturnNumber: string | null = null;
          let refundRequestId: string | null = null;
          if (returnQuotes.length) {
            saleReturnNumber = await nextPosReturnNumber(tx, input.organizationId);
            const saleReturn = await tx.saleReturn.create({
              data: {
                organizationId: input.organizationId,
                storeId: order.storeId,
                registerId: shift.registerId,
                shiftId: shift.id,
                originalSaleId: order.id,
                number: saleReturnNumber,
                status: PosReturnStatus.COMPLETED,
                subtotalKgs: new Prisma.Decimal(returnedKgs),
                totalKgs: new Prisma.Decimal(returnedKgs),
                notes: `Корректировка: ${reason}`,
                completedAt: new Date(),
                completedById: input.actorId,
                completedEventId: `${input.idempotencyKey}:return`,
                createdById: input.actorId,
                ...correctionCurrency,
              },
            });
            saleReturnId = saleReturn.id;
            for (const line of returnQuotes) {
              await tx.saleReturnLine.create({
                data: {
                  saleReturnId: saleReturn.id,
                  customerOrderLineId: line.source.id,
                  productId: line.source.productId,
                  variantId: line.source.variantId,
                  variantKey: line.source.variantKey,
                  qty: line.qty,
                  unitPriceKgs: line.source.unitPriceKgs,
                  lineTotalKgs: line.amount,
                  unitCostKgs: line.source.unitCostKgs,
                  lineCostTotalKgs:
                    line.source.unitCostKgs === null
                      ? null
                      : roundMoney(Number(line.source.unitCostKgs) * line.qty),
                  restock: line.restock,
                },
              });
              if (line.restock) {
                await applyStockMovement(tx, {
                  storeId: order.storeId,
                  productId: line.source.productId,
                  variantId: line.source.variantId,
                  qtyDelta: line.qty,
                  type: StockMovementType.RETURN,
                  referenceType: "SaleReturn",
                  referenceId: saleReturn.id,
                  note: saleReturnNumber ?? undefined,
                  actorId: input.actorId,
                  organizationId: input.organizationId,
                });
              }
              correctionEvents.push({ storeId: order.storeId, productId: line.source.productId });
            }
            if (offsetKgs > 0) {
              await tx.salePayment.create({
                data: {
                  organizationId: input.organizationId,
                  storeId: order.storeId,
                  shiftId: shift.id,
                  customerOrderId: order.id,
                  saleReturnId: saleReturn.id,
                  method: input.paymentMethod,
                  amountKgs: new Prisma.Decimal(offsetKgs),
                  ...correctionCurrency,
                  isRefund: true,
                  settlementStatus: SalePaymentSettlement.OFFSET,
                  createdById: input.actorId,
                },
              });
            }
            if (actualRefundKgs > 0) {
              await tx.salePayment.create({
                data: {
                  organizationId: input.organizationId,
                  storeId: order.storeId,
                  shiftId: shift.id,
                  customerOrderId: order.id,
                  saleReturnId: saleReturn.id,
                  method: input.paymentMethod,
                  amountKgs: new Prisma.Decimal(actualRefundKgs),
                  ...correctionCurrency,
                  isRefund: true,
                  settlementStatus: SalePaymentSettlement.ACTUAL,
                  createdById: input.actorId,
                },
              });
            }
            if (pendingRefundKgs > 0) {
              const request = await tx.refundRequest.create({
                data: {
                  organizationId: input.organizationId,
                  storeId: order.storeId,
                  shiftId: shift.id,
                  saleReturnId: saleReturn.id,
                  originalSaleId: order.id,
                  paymentMethod: PosPaymentMethod.TRANSFER,
                  amountKgs: new Prisma.Decimal(pendingRefundKgs),
                  ...correctionCurrency,
                  reasonCode: "SALES_ORDER_CORRECTION",
                  notes: `${reason}\nReturn ${returnedKgs}, addition ${addedKgs}, offset ${offsetKgs}, net refund ${refundKgs}.`,
                  createdById: input.actorId,
                  status: RefundRequestStatus.OPEN,
                },
              });
              refundRequestId = request.id;
              // The obligation is recorded, but an ACTUAL payment is created
              // only after a manager confirms the payout into an open shift.
              await tx.salePayment.create({
                data: {
                  organizationId: input.organizationId,
                  storeId: order.storeId,
                  shiftId: shift.id,
                  customerOrderId: order.id,
                  saleReturnId: saleReturn.id,
                  refundRequestId: request.id,
                  method: PosPaymentMethod.TRANSFER,
                  amountKgs: new Prisma.Decimal(pendingRefundKgs),
                  ...correctionCurrency,
                  isRefund: true,
                  settlementStatus: SalePaymentSettlement.PENDING,
                  createdById: input.actorId,
                },
              });
            }
            await reverseLoyaltyForReturn(tx, {
              organizationId: input.organizationId,
              customerOrderId: order.id,
              saleReturnId: saleReturn.id,
            });
          }

          let additionOrderId: string | null = null;
          let additionNumber: string | null = null;
          if (additionQuotes.length) {
            additionNumber = await nextSalesOrderNumber(tx, input.organizationId);
            const addition = await tx.customerOrder.create({
              data: {
                organizationId: input.organizationId,
                storeId: order.storeId,
                number: additionNumber,
                source: CustomerOrderSource.MANUAL,
                saleChannel: order.saleChannel,
                status: CustomerOrderStatus.DRAFT,
                priceMode,
                customerId: order.customerId,
                customerName: order.customerName,
                customerEmail: order.customerEmail,
                customerPhone: order.customerPhone,
                customerAddress: order.customerAddress,
                notes: [
                  `Корректировка к ${order.number}`,
                  reason,
                  input.notes?.trim() || null,
                ]
                  .filter(Boolean)
                  .join("\n"),
                currencyCode: correctionCurrency.currencyCode,
                currencyRateKgsPerUnit: correctionCurrency.currencyRateKgsPerUnit,
                createdById: input.actorId,
                updatedById: input.actorId,
                lines: {
                  create: additionQuotes.map((line) => ({
                    productId: line.productId,
                    variantId: line.variantId,
                    variantKey: line.variantKey,
                    qty: line.qty,
                    unitPriceKgs: new Prisma.Decimal(line.unitPriceKgs),
                    baseUnitPriceKgs: new Prisma.Decimal(line.baseUnitPriceKgs),
                    priceSource: line.priceSource,
                    manualPrice: line.priceSource === "MANUAL",
                    appliedDiscountType: line.appliedDiscountType as never,
                    appliedDiscountPercentage:
                      line.appliedDiscountPercentage === null
                        ? null
                        : new Prisma.Decimal(line.appliedDiscountPercentage),
                    appliedDiscountAmountKgs:
                      line.appliedDiscountAmountKgs === null
                        ? null
                        : new Prisma.Decimal(line.appliedDiscountAmountKgs),
                    lineTotalKgs: new Prisma.Decimal(line.lineTotalKgs),
                    unitCostKgs:
                      line.unitCostKgs === null ? null : new Prisma.Decimal(line.unitCostKgs),
                    lineCostTotalKgs:
                      line.lineCostTotalKgs === null
                        ? null
                        : new Prisma.Decimal(line.lineCostTotalKgs),
                  })),
                },
              },
            });
            additionOrderId = addition.id;
            await recomputeTotals(tx, addition.id, input.actorId);
            if (offsetKgs > 0) {
              await tx.salePayment.create({
                data: {
                  organizationId: input.organizationId,
                  storeId: order.storeId,
                  shiftId: shift.id,
                  customerOrderId: addition.id,
                  method: input.paymentMethod,
                  amountKgs: new Prisma.Decimal(offsetKgs),
                  ...correctionCurrency,
                  isRefund: false,
                  settlementStatus: SalePaymentSettlement.OFFSET,
                  createdById: input.actorId,
                },
              });
            }
            if (actualChargeKgs > 0) {
              await tx.salePayment.create({
                data: {
                  organizationId: input.organizationId,
                  storeId: order.storeId,
                  shiftId: shift.id,
                  customerOrderId: addition.id,
                  method: input.paymentMethod,
                  amountKgs: new Prisma.Decimal(actualChargeKgs),
                  ...correctionCurrency,
                  isRefund: false,
                  settlementStatus: SalePaymentSettlement.ACTUAL,
                  createdById: input.actorId,
                },
              });
            }
            completion = await completeCustomerOrderTx(tx, {
              customerOrderId: addition.id,
              organizationId: input.organizationId,
              actorId: input.actorId,
              requestId: input.requestId,
              idempotencyKey: `${input.idempotencyKey}:addition`,
              allowImmediate: true,
              completionEventKey: `salesOrders.correction:${input.organizationId}:${input.actorId}:${input.idempotencyKey}:addition`,
            });
            for (const line of additionQuotes) {
              correctionEvents.push({ storeId: order.storeId, productId: line.productId });
            }
          }

          const number = await nextCorrectionNumber(tx, input.organizationId);
          const correction = await tx.salesOrderCorrection.create({
            data: {
              organizationId: input.organizationId,
              storeId: order.storeId,
              number,
              originalOrderId: order.id,
              saleReturnId,
              additionOrderId,
              shiftId: shift.id,
              reason,
              notes: input.notes?.trim() || null,
              returnedKgs: new Prisma.Decimal(returnedKgs),
              addedKgs: new Prisma.Decimal(addedKgs),
              offsetKgs: new Prisma.Decimal(offsetKgs),
              refundKgs: new Prisma.Decimal(refundKgs),
              chargeKgs: new Prisma.Decimal(chargeKgs),
              restock: returnQuotes.every((line) => line.restock),
              paymentMethod: input.paymentMethod,
              before: toJson({
                totalKgs: order.totalKgs,
                paidKgs: money.paidKgs,
                returnedKgs: money.returnedKgs,
                actualRefundedKgs: money.actualRefundedKgs,
                pendingRefundKgs: money.pendingRefundKgs,
                offsetKgs: money.offsetKgs,
                paymentMethod: input.paymentMethod,
                lines: order.lines.map((line) => ({
                  id: line.id,
                  productId: line.productId,
                  qty: line.qty,
                  unitPriceKgs: line.unitPriceKgs,
                })),
              }),
              after: toJson({
                grossReturnKgs: returnedKgs,
                grossAdditionKgs: addedKgs,
                offsetKgs,
                actualRefundKgs: actualRefundKgs,
                actualChargeKgs,
                pendingRefundKgs,
                netRefundKgs: refundKgs,
                netChargeKgs: chargeKgs,
                paymentMethod: input.paymentMethod,
                saleReturnId,
                saleReturnNumber,
                additionOrderId,
                additionNumber,
                refundRequestId,
                returns: returnQuotes.map((line) => ({
                  lineId: line.source.id,
                  qty: line.qty,
                  restock: line.restock,
                  amountKgs: Number(line.amount),
                })),
                additions: additionQuotes.map((line) => ({
                  productId: line.productId,
                  variantId: line.variantId,
                  qty: line.qty,
                  unitPriceKgs: line.unitPriceKgs,
                  lineTotalKgs: line.lineTotalKgs,
                })),
              }),
              createdById: input.actorId,
            },
          });
          await writeAuditLog(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: "SALES_ORDER_CORRECTION",
            entity: "CustomerOrder",
            entityId: order.id,
            before: toJson({
              totalKgs: order.totalKgs,
              paidKgs: money.paidKgs,
              returnedKgs: money.returnedKgs,
              pendingRefundKgs: money.pendingRefundKgs,
              offsetKgs: money.offsetKgs,
            }),
            after: toJson({
              correctionId: correction.id,
              number,
              reason,
              grossReturnKgs: returnedKgs,
              grossAdditionKgs: addedKgs,
              offsetKgs,
              actualRefundKgs,
              actualChargeKgs,
              pendingRefundKgs,
              netRefundKgs: refundKgs,
              netChargeKgs: chargeKgs,
              paymentMethod: input.paymentMethod,
              saleReturnId,
              additionOrderId,
              refundRequestId,
            }),
            requestId: input.requestId,
          });
          return {
            correctionId: correction.id,
            correctionNumber: number,
            originalOrderId: order.id,
            originalNumber: order.number,
            returnedKgs,
            addedKgs,
            offsetKgs,
            refundKgs,
            chargeKgs,
            actualRefundKgs,
            pendingRefundKgs,
            saleReturnId,
            saleReturnNumber,
            additionOrderId,
            additionNumber,
            refundRequestId,
            manualRefundRequired: pendingRefundKgs > 0,
          };
        },
      );
      return result;
    },
    FAST_CORRECTION_TRANSACTION_OPTIONS,
  );

  if (completion) {
    const done = completion as { id: string; storeId: string; productIds: string[]; previousStatus: CustomerOrderStatus; status: CustomerOrderStatus; alreadyCompleted: boolean };
    if (!done.alreadyCompleted) {
      for (const productId of new Set(done.productIds)) {
        eventBus.publish({ type: "inventory.updated", payload: { storeId: done.storeId, productId, variantId: null } });
      }
      eventBus.publish({
        type: "customerOrder.statusChanged",
        payload: {
          customerOrderId: done.id,
          storeId: done.storeId,
          oldStatus: done.previousStatus,
          newStatus: done.status,
        },
      });
    }
  }
  for (const event of correctionEvents) {
    eventBus.publish({
      type: "inventory.updated",
      payload: { storeId: event.storeId, productId: event.productId, variantId: null },
    });
  }
  return operation;
};

export type ResolveCorrectionRefundInput = {
  organizationId: string;
  actorId: string;
  requestId: string;
  refundRequestId: string;
  action: "RESOLVED" | "CANCELED";
  shiftId?: string | null;
  idempotencyKey: string;
};

/**
 * Confirms an OPEN manual refund created by a completed-sale correction.
 * Confirmation turns the single PENDING payment into ACTUAL money inside an
 * open shift. Final cancellation is rejected: the accepted return remains a
 * payable obligation until it is paid exactly once.
 */
export const resolveCorrectionRefundRequest = async (
  input: ResolveCorrectionRefundInput,
) => {
  const { result, replayed } = await prisma.$transaction(
    async (tx) => {
      return withIdempotency(
        tx,
        {
          key: input.idempotencyKey,
          route: "salesOrders.correctionRefund.v1",
          userId: input.actorId,
          request: {
            refundRequestId: input.refundRequestId,
            action: input.action,
            shiftId: input.shiftId ?? null,
          },
        },
        async () => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "RefundRequest"
            WHERE "id" = ${input.refundRequestId}
              AND "organizationId" = ${input.organizationId}
            FOR UPDATE
          `;
          if (!locked.length) {
            throw new AppError("salesOrderCorrectionRefundNotFound", "NOT_FOUND", 404);
          }
          const request = await tx.refundRequest.findUniqueOrThrow({
            where: { id: input.refundRequestId },
            select: {
              id: true,
              organizationId: true,
              storeId: true,
              saleReturnId: true,
              originalSaleId: true,
              status: true,
              paymentMethod: true,
              amountKgs: true,
              shiftId: true,
              reasonCode: true,
              shift: { select: { registerId: true } },
              payment: {
                select: {
                  id: true,
                  isRefund: true,
                  amountKgs: true,
                  shiftId: true,
                  settlementStatus: true,
                },
              },
            },
          });
          if (request.reasonCode !== "SALES_ORDER_CORRECTION") {
            throw new AppError("salesOrderCorrectionRefundNotFound", "NOT_FOUND", 404);
          }
          await assertActorCanManageCorrectionsTx(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            storeId: request.storeId,
          });
          if (request.status !== RefundRequestStatus.OPEN) {
            throw new AppError("salesOrderCorrectionRefundNotOpen", "CONFLICT", 409);
          }
          const payment = request.payment;
          if (
            !payment?.isRefund ||
            payment.settlementStatus !== SalePaymentSettlement.PENDING ||
            !new Prisma.Decimal(payment.amountKgs).equals(request.amountKgs)
          ) {
            throw new AppError("salesOrderCorrectionRefundPaymentMismatch", "CONFLICT", 409);
          }

          const now = new Date();
          if (input.action === "CANCELED") {
            // The return was accepted and may already have restored stock. The
            // store still owes the refund, so a correction request cannot be
            // finally canceled; it must be paid exactly once instead.
            throw new AppError(
              "salesOrderCorrectionRefundCannotCancel",
              "CONFLICT",
              409,
            );
          }

          if (!input.shiftId) {
            throw new AppError("invalidInput", "BAD_REQUEST", 400);
          }
          await tx.$queryRaw`
            SELECT "id"
            FROM "RegisterShift"
            WHERE "id" = ${input.shiftId}
              AND "organizationId" = ${input.organizationId}
            FOR UPDATE
          `;
          const shift = await tx.registerShift.findFirst({
            where: {
              id: input.shiftId,
              organizationId: input.organizationId,
              storeId: request.storeId,
              status: RegisterShiftStatus.OPEN,
              register: { isActive: true },
            },
            select: { id: true, registerId: true },
          });
          if (!shift) {
            throw new AppError("posShiftNotOpen", "CONFLICT", 409);
          }
          // Re-read after acquiring both locks: another resolver may have won
          // while this transaction was waiting for the shift row.
          const fresh = await tx.refundRequest.findUniqueOrThrow({
            where: { id: request.id },
            select: { status: true },
          });
          if (fresh.status !== RefundRequestStatus.OPEN) {
            throw new AppError("salesOrderCorrectionRefundNotOpen", "CONFLICT", 409);
          }

          await tx.salePayment.update({
            where: { id: payment.id },
            data: {
              settlementStatus: SalePaymentSettlement.ACTUAL,
              shiftId: shift.id,
              createdAt: now,
            },
          });
          await tx.refundRequest.update({
            where: { id: request.id },
            data: {
              status: RefundRequestStatus.RESOLVED,
              shiftId: shift.id,
              reviewedById: input.actorId,
              reviewedAt: now,
            },
          });
          await writeAuditLog(tx, {
            organizationId: input.organizationId,
            actorId: input.actorId,
            action: "SALES_ORDER_CORRECTION_REFUND_RESOLVED",
            entity: "RefundRequest",
            entityId: request.id,
            before: toJson({
              status: request.status,
              paymentSettlementStatus: payment.settlementStatus,
              paymentShiftId: payment.shiftId,
              amountKgs: Number(request.amountKgs),
            }),
            after: toJson({
              status: RefundRequestStatus.RESOLVED,
              paymentSettlementStatus: SalePaymentSettlement.ACTUAL,
              paymentShiftId: shift.id,
              amountKgs: Number(request.amountKgs),
              reviewedById: input.actorId,
              reviewedAt: now,
            }),
            requestId: input.requestId,
          });
          return {
            refundRequestId: request.id,
            status: RefundRequestStatus.RESOLVED,
            paymentId: payment.id,
            amountKgs: Number(request.amountKgs),
            shiftId: shift.id,
            storeId: request.storeId,
            registerId: shift.registerId,
          };
        },
      );
    },
    FAST_CORRECTION_TRANSACTION_OPTIONS,
  );

  if (!replayed && result.shiftId && result.registerId) {
    eventBus.publish({
      type: "shift.updated",
      payload: {
        shiftId: result.shiftId,
        storeId: result.storeId,
        registerId: result.registerId,
      },
    });
  }
  return result;
};
