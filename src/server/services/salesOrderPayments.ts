import { Prisma, type PosPaymentMethod } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { AppError } from "./errors";
import { assertUserCanAccessStore, type StoreAccessUser } from "./storeAccess";
import { withIdempotency } from "./idempotency";
import { lockLoyaltyOrder, confirmLoyaltyForOrder, reverseLoyaltyForReturn } from "./loyalty/apply";
import { writeAuditLog } from "./audit";
import { eventBus } from "@/server/events/eventBus";
import { toJson } from "./json";

export async function getOrderPaymentInfo(user: StoreAccessUser, customerOrderId: string) {
  const order = await prisma.customerOrder.findFirst({ where: { id: customerOrderId, organizationId: user.organizationId, isPosSale: false }, select: { id: true, storeId: true, totalKgs: true, status: true, lines: { select: { id: true, qty: true, lineTotalKgs: true, product: { select: { name: true } }, variant: { select: { name: true } }, saleReturnLines: { where: { saleReturn: { status: "COMPLETED" } }, select: { qty: true, lineTotalKgs: true } } } } } });
  if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
  await assertUserCanAccessStore(prisma, user, order.storeId);
  const [payments, shifts] = await Promise.all([
    prisma.salePayment.aggregate({ where: { customerOrderId, isRefund: false }, _sum: { amountKgs: true }, _count: true }),
    prisma.registerShift.findMany({ where: { organizationId: user.organizationId, storeId: order.storeId, status: "OPEN", register: { isActive: true } }, select: { id: true, register: { select: { name: true } } }, orderBy: { openedAt: "desc" } }),
  ]);
  const paid = payments._sum.amountKgs ?? new Prisma.Decimal(0);
  return { canReturn: order.status === "COMPLETED" && paid.gte(order.totalKgs), returnLines: order.lines.map(line => ({ id: line.id, name: [line.product.name, line.variant?.name].filter(Boolean).join(" · "), qty: line.qty, lineTotalKgs: Number(line.lineTotalKgs), returnedQty: line.saleReturnLines.reduce((n, row) => n + row.qty, 0), refundedKgs: line.saleReturnLines.reduce((n, row) => n + Number(row.lineTotalKgs), 0) })), paidKgs: paid.toNumber(), hasEvidence: payments._count > 0, remainingKgs: Prisma.Decimal.max(0, order.totalKgs.minus(paid)).toNumber(), canPay: order.status === "COMPLETED", shifts: shifts.map((shift) => ({ id: shift.id, name: shift.register.name })) };
}

/** Staff records money actually received into an existing open shift. No stock rewrite. */
export async function recordOrderPayment(input: { user: StoreAccessUser; customerOrderId: string; shiftId: string; amountKgs: number; method: PosPaymentMethod; idempotencyKey: string; requestId: string }) {
  const result = await prisma.$transaction(async (tx) => {
    const { result } = await withIdempotency(tx, { key: input.idempotencyKey, route: "salesOrders.recordPayment", userId: input.user.id, request: { customerOrderId: input.customerOrderId, shiftId: input.shiftId, amountKgs: input.amountKgs, method: input.method } }, async () => {
      await tx.$queryRaw`SELECT id FROM "RegisterShift" WHERE id = ${input.shiftId} FOR UPDATE`;
      await lockLoyaltyOrder(tx, input.customerOrderId);
      const order = await tx.customerOrder.findFirst({ where: { id: input.customerOrderId, organizationId: input.user.organizationId, isPosSale: false, status: "COMPLETED" } });
      if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
      await assertUserCanAccessStore(tx, input.user, order.storeId);
      const shift = await tx.registerShift.findFirst({ where: { id: input.shiftId, organizationId: input.user.organizationId, storeId: order.storeId, status: "OPEN", register: { isActive: true } }, include: { store: true } });
      if (!shift) throw new AppError("posShiftNotOpen", "CONFLICT", 409);
      const paid = await tx.salePayment.aggregate({ where: { customerOrderId: order.id, isRefund: false }, _sum: { amountKgs: true } });
      const amount = new Prisma.Decimal(input.amountKgs);
      const paidTotal = (paid._sum.amountKgs ?? new Prisma.Decimal(0)).plus(amount);
      if (!amount.gt(0) || amount.decimalPlaces() > 2 || paidTotal.gt(order.totalKgs)) throw new AppError("posPaymentTotalMismatch", "CONFLICT", 409);
      await tx.salePayment.create({ data: { organizationId: input.user.organizationId, storeId: order.storeId, shiftId: shift.id, customerOrderId: order.id, amountKgs: amount, method: input.method, createdById: input.user.id, currencyCode: order.currencyCode ?? shift.currencyCode ?? shift.store.currencyCode, currencyRateKgsPerUnit: order.currencyRateKgsPerUnit ?? shift.currencyRateKgsPerUnit ?? shift.store.currencyRateKgsPerUnit } });
      await confirmLoyaltyForOrder(tx, { organizationId: input.user.organizationId, customerOrderId: order.id, paidInFull: paidTotal.gte(order.totalKgs), actorId: input.user.id });
      if (paidTotal.gte(order.totalKgs)) {
        const latestReturn = await tx.saleReturn.findFirst({ where: { originalSaleId: order.id, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { id: true } });
        if (latestReturn) await reverseLoyaltyForReturn(tx, { organizationId: input.user.organizationId, customerOrderId: order.id, saleReturnId: latestReturn.id });
      }
      await writeAuditLog(tx, { organizationId: input.user.organizationId, actorId: input.user.id, action: "SALES_ORDER_PAYMENT", entity: "CustomerOrder", entityId: order.id, before: toJson({ paidKgs: paid._sum.amountKgs ?? 0 }), after: toJson({ paidKgs: paidTotal, amountKgs: amount, method: input.method, shiftId: shift.id }), requestId: input.requestId });
      return { storeId: order.storeId, registerId: shift.registerId, shiftId: shift.id, id: order.id, paidKgs: paidTotal.toNumber(), remainingKgs: order.totalKgs.minus(paidTotal).toNumber() };
    });
    return result;
  });
  eventBus.publish({ type: "shift.updated", payload: { storeId: result.storeId, registerId: result.registerId, shiftId: result.shiftId } });
  return result;
}
