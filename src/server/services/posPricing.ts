import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { AppError } from "@/server/services/errors";
import { lockPosSaleDraftForEdit } from "@/server/services/pos";
import { resolveStoreSellingPrice, type StorePriceMode } from "@/server/services/storeSellingPrice";
import { getEffectiveProductPrice } from "@/server/services/effectiveProductPrice";
import { releaseLoyaltyForOrder, applyLoyaltyToOrder, loyaltyCartFingerprint } from "@/server/services/loyalty/apply";
import { calculateLoyalty } from "@/server/services/loyalty/calc";
import { assertLoyaltyEnabled, toLoyaltyRules } from "@/server/services/loyalty/program";
import { writeAuditLog } from "@/server/services/audit";
import type { StoreAccessUser } from "@/server/services/storeAccess";

export async function changePosPriceMode(input: { saleId: string; mode: StorePriceMode; confirmation?: string; expectedTotal?: number; user: StoreAccessUser; requestId: string }) {
  return prisma.$transaction(async (tx) => {
    const sale = await lockPosSaleDraftForEdit(tx, { saleId: input.saleId, organizationId: input.user.organizationId, actorId: input.user.id, user: input.user });
    const store = await tx.store.findUniqueOrThrow({ where: { id: sale.storeId } });
    if (!store.retailWholesaleEnabled) throw new AppError("forbidden", "FORBIDDEN", 403);
    if (sale.priceMode === input.mode) return { needsConfirmation: false, totalKgs: Number(sale.totalKgs), fingerprint: "", pointsReleased: false };
    const rows = await tx.customerOrderLine.findMany({ where: { customerOrderId: sale.id }, include: { product: { select: { basePriceKgs: true } } } });
    const prices = await tx.storePrice.findMany({ where: { organizationId: input.user.organizationId, storeId: sale.storeId, productId: { in: rows.map((row) => row.productId) } } });
    const extras = await tx.storePriceTypes.findMany({ where: { organizationId: input.user.organizationId, storeId: sale.storeId, productId: { in: rows.map(row => row.productId) } } });
    const extrasByKey = new Map(extras.map(row => [`${row.productId}:${row.variantKey}`, row]));
    const priceByKey = new Map(prices.map((row) => [`${row.productId}:${row.variantKey}`, row]));
    const loyalty = await tx.loyaltyOrderApplication.findUnique({ where: { customerOrderId: sale.id } });
    const activeLoyalty = loyalty?.status === "APPLIED" ? loyalty : null;
    const originals = activeLoyalty?.lineDistribution as unknown as Array<{lineId: string; originalUnitPriceKgs?: string; originalLineTotalKgs?: string}> | undefined;
    const proposed = rows.map((row) => {
      if (row.manualPrice || row.priceSource === "LEGACY" || row.priceSource === "MANUAL") {
        const original = originals?.find((line) => line.lineId === row.id);
        const unitPriceKgs = new Prisma.Decimal(original?.originalUnitPriceKgs ?? row.unitPriceKgs);
        return { id: row.id, qty: row.qty, manual: true, unitPriceKgs, baseUnitPriceKgs: row.baseUnitPriceKgs ?? unitPriceKgs, lineTotalKgs: new Prisma.Decimal(original?.originalLineTotalKgs ?? row.lineTotalKgs), source: "MANUAL", discountType: row.appliedDiscountType, discountPercentage: row.appliedDiscountPercentage, discountAmountKgs: row.appliedDiscountAmountKgs };
      }
      const price = priceByKey.get(`${row.productId}:${row.variantKey}`);
      const extra = extrasByKey.get(`${row.productId}:${row.variantKey}`);
      const selected = resolveStoreSellingPrice({enabled: true, mode: input.mode, standard: price?.priceKgs ?? row.product.basePriceKgs ?? new Prisma.Decimal(0), retail: extra?.retailPriceKgs, wholesale: extra?.wholesalePriceKgs});
      const discount = price?.discountType === "PERCENTAGE" && price.discountPercentage ? {type: "PERCENTAGE" as const, percentage: price.discountPercentage, startsAt: price.discountStartsAt, endsAt: price.discountEndsAt} : null;
      const effective = getEffectiveProductPrice({basePrice: selected.price, discount, now: new Date(), currency: "KGS"});
      return {id: row.id, qty: row.qty, manual: false, unitPriceKgs: effective.effectivePrice, baseUnitPriceKgs: effective.basePrice, lineTotalKgs: effective.effectivePrice.mul(row.qty).toDecimalPlaces(2), source: selected.source, discountType: effective.hasActiveDiscount ? "PERCENTAGE" as const : null, discountPercentage: effective.hasActiveDiscount ? effective.discountPercentage : null, discountAmountKgs: effective.hasActiveDiscount ? effective.basePrice.minus(effective.effectivePrice) : null};
    });
    const subtotal = proposed.reduce((sum, row) => sum.plus(row.lineTotalKgs), new Prisma.Decimal(0));
    let total = Prisma.Decimal.max(0, subtotal.minus(activeLoyalty ? 0 : sale.discountKgs));
    if (activeLoyalty) {
      const rules = toLoyaltyRules(await assertLoyaltyEnabled(tx, input.user.organizationId, sale.storeId));
      const quote = calculateLoyalty({rules, availablePoints: 0, requestedPoints: 0, lines: proposed.map((row) => { const promo = row.baseUnitPriceKgs.mul(row.qty).minus(row.lineTotalKgs); return {lineId: row.id, qty: row.qty, baseUnitPriceKgs: row.baseUnitPriceKgs, promoDiscountKgs: promo, participates: !(rules.excludePromoItems && promo.gt(0))}; })});
      total = new Prisma.Decimal(quote.payableKgs);
    }
    const fingerprint = await loyaltyCartFingerprint(tx, sale.id);
    if (!total.eq(sale.totalKgs) && !input.confirmation) return {needsConfirmation: true, totalKgs: Number(total), fingerprint, pointsReleased: Boolean(activeLoyalty?.pointsSpent)};
    if (input.confirmation && (input.confirmation !== fingerprint || input.expectedTotal !== Number(total))) throw new AppError("loyaltyCartChanged", "CONFLICT", 409);
    await releaseLoyaltyForOrder(tx, {customerOrderId: sale.id});
    // Old deployed clients omit price provenance. Only this automatic writer may
    // replace an existing base price without the database marking it as manual.
    await tx.$queryRaw`SELECT set_config('bazaar.price_mode_write', 'v1', true)`;
    for (const row of proposed) await tx.customerOrderLine.update({where: {id: row.id}, data: {manualPrice: row.manual, unitPriceKgs: row.unitPriceKgs, baseUnitPriceKgs: row.baseUnitPriceKgs, lineTotalKgs: row.lineTotalKgs, priceSource: row.source, appliedDiscountType: row.discountType, appliedDiscountPercentage: row.discountPercentage, appliedDiscountAmountKgs: row.discountAmountKgs}});
    await tx.customerOrder.update({where: {id: sale.id}, data: {priceMode: input.mode, subtotalKgs: subtotal, totalKgs: Prisma.Decimal.max(0, subtotal.minus(activeLoyalty ? 0 : sale.discountKgs))}});
    if (activeLoyalty) await applyLoyaltyToOrder(tx, {organizationId: input.user.organizationId, storeId: sale.storeId, customerOrderId: sale.id, memberId: activeLoyalty.memberId, requestedPoints: 0, actorId: input.user.id});
    await writeAuditLog(tx, {organizationId: input.user.organizationId, actorId: input.user.id, requestId: input.requestId, action: "POS_PRICE_MODE", entity: "CustomerOrder", entityId: sale.id, before: {mode: sale.priceMode}, after: {mode: input.mode, totalKgs: Number(total)}});
    return {needsConfirmation: false, totalKgs: Number(total), fingerprint, pointsReleased: Boolean(activeLoyalty?.pointsSpent)};
  });
}
