import { prisma } from "@/server/db/prisma";
import { currencySourceWithFallback, resolveCurrency } from "@/lib/currencyDisplay";
import { AppError } from "@/server/services/errors";
import type { SalesDocumentKind } from "@/lib/salesDocumentKind";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import { assertUserCanAccessStore } from "@/server/services/storeAccess";

export type SalesDocumentPayload = {
  id: string;
  organizationId: string;
  storeId: string;
  number: string;
  status: "DRAFT" | "CONFIRMED" | "READY" | "COMPLETED" | "CANCELED";
  isPosSale: boolean;
  createdAt: Date;
  currencyCode: string;
  currencyRateKgsPerUnit: number;
  seller: { name: string; storeName: string; inn: string | null; address: string | null; phone: string | null };
  customer: { name: string | null; phone: string | null; email: string | null; address: string | null };
  items: { id: string; name: string; variantName: string | null; sku: string; unit: string; qty: number; unitPriceKgs: number; lineTotalKgs: number }[];
  subtotalKgs: number;
  discountKgs: number;
  totalKgs: number;
};

/** Read-only projection: prices come from the sale, never from inventory cost. */
export async function getSalesDocument(input: {
  actorId: string;
  organizationId: string;
  customerOrderId: string;
  locale: string;
  kind?: SalesDocumentKind;
}): Promise<SalesDocumentPayload> {
  // Do not trust stale role, owner or store claims from a session token.
  const actor = await prisma.user.findFirst({
    where: { id: input.actorId, organizationId: input.organizationId, isActive: true },
    select: { id: true, organizationId: true, role: true, isOrgOwner: true },
  });
  if (!actor?.organizationId) throw new AppError("unauthorized", "UNAUTHORIZED", 401);

  const order = await prisma.customerOrder.findFirst({
    where: { id: input.customerOrderId, organizationId: actor.organizationId },
    select: {
      id: true, organizationId: true, storeId: true, number: true, status: true,
      isPosSale: true, createdAt: true, completedAt: true,
      customerName: true, customerPhone: true, customerEmail: true, customerAddress: true,
      currencyCode: true, currencyRateKgsPerUnit: true,
      subtotalKgs: true, discountKgs: true, totalKgs: true,
      store: { select: { name: true, legalName: true, inn: true, address: true, phone: true, currencyCode: true, currencyRateKgsPerUnit: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true, qty: true, unitPriceKgs: true, lineTotalKgs: true, priceSource: true,
          product: { select: { name: true, sku: true, unit: true, baseUnit: { select: { code: true, labelRu: true, labelKg: true } } } },
          variant: { select: { name: true } },
        },
      },
    },
  });
  if (!order) throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
  await assertUserCanAccessStore(prisma, { ...actor, organizationId: actor.organizationId }, order.storeId);
  await assertFeatureEnabled({ organizationId: actor.organizationId, feature: order.isPosSale ? "pos" : "customerOrders" });

  if (input.kind === "estimate") {
    if (order.isPosSale || order.status !== "DRAFT") {
      throw new AppError("invalidTransition", "CONFLICT", 409);
    }
    if (!order.lines.length) throw new AppError("salesOrderEmpty", "BAD_REQUEST", 400);
    if (order.lines.some((line) => line.priceSource === "MISSING")) {
      throw new AppError("salesOrderPriceRequired", "BAD_REQUEST", 400);
    }
  }

  const currency = resolveCurrency(currencySourceWithFallback(order, order.store));
  return {
    id: order.id, organizationId: order.organizationId, storeId: order.storeId,
    number: order.number, status: order.status, isPosSale: order.isPosSale,
    createdAt: order.completedAt ?? order.createdAt,
    currencyCode: currency.currencyCode, currencyRateKgsPerUnit: currency.currencyRateKgsPerUnit,
    seller: {
      name: order.store.legalName?.trim() || order.store.name, storeName: order.store.name,
      inn: order.store.inn, address: order.store.address, phone: order.store.phone,
    },
    // These are order snapshots. A later CRM edit must not rewrite a document.
    customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail, address: order.customerAddress },
    items: order.lines.map((line) => ({
      id: line.id, name: line.product.name, variantName: line.variant?.name ?? null, sku: line.product.sku,
      unit: input.locale.startsWith("kg") || input.locale.startsWith("ky")
        ? line.product.baseUnit?.labelKg || line.product.unit
        : input.locale.startsWith("ru") ? line.product.baseUnit?.labelRu || line.product.unit
          : line.product.baseUnit?.code || line.product.unit,
      qty: line.qty, unitPriceKgs: Number(line.unitPriceKgs), lineTotalKgs: Number(line.lineTotalKgs),
    })),
    subtotalKgs: Number(order.subtotalKgs), discountKgs: Number(order.discountKgs), totalKgs: Number(order.totalKgs),
  };
}
