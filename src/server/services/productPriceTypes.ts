import type { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";
import { writeAuditLog } from "@/server/services/audit";
import { toJson } from "@/server/services/json";

export type ProductPriceTypeValues = {
  retailPriceKgs?: number | null;
  wholesalePriceKgs?: number | null;
};

// Called inside the product transaction, so the product and its prices save together.
export async function saveProductPriceTypes(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorId: string;
    requestId: string;
    storeId?: string | null;
    productId: string;
    prices: Array<ProductPriceTypeValues & { variantId?: string }>;
  },
) {
  const prices = input.prices.filter(
    (price) => price.retailPriceKgs !== undefined || price.wholesalePriceKgs !== undefined,
  );
  if (!prices.length) return;
  if (!input.storeId) throw new AppError("storeRequired", "BAD_REQUEST", 400);

  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    select: { retailWholesaleEnabled: true },
  });
  if (!organization.retailWholesaleEnabled) {
    throw new AppError("retailWholesaleDisabled", "CONFLICT", 409);
  }
  const assignment = await tx.storeProduct.findFirst({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      productId: input.productId,
      isActive: true,
    },
    select: { id: true },
  });
  if (!assignment) throw new AppError("productNotFound", "NOT_FOUND", 404);
  const variantIds = prices.flatMap((price) => (price.variantId ? [price.variantId] : []));
  if (variantIds.length) {
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds }, productId: input.productId, isActive: true },
      select: { id: true },
    });
    if (variants.length !== new Set(variantIds).size) {
      throw new AppError("variantNotFound", "NOT_FOUND", 404);
    }
  }
  const beforeRows = await tx.storePriceTypes.findMany({
    where: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      productId: input.productId,
    },
  });
  const beforeByKey = new Map(beforeRows.map((row) => [row.variantKey, row]));
  for (const price of prices) {
    for (const value of [price.retailPriceKgs, price.wholesalePriceKgs]) {
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        throw new AppError("invalidInput", "BAD_REQUEST", 400);
      }
    }
    const variantKey = price.variantId ?? "BASE";
    const before = beforeByKey.get(variantKey);
    if (!before && price.retailPriceKgs == null && price.wholesalePriceKgs == null) continue;
    const key = {
      organizationId: input.organizationId,
      storeId: input.storeId,
      productId: input.productId,
      variantKey,
    };
    const after = await tx.storePriceTypes.upsert({
      where: { organizationId_storeId_productId_variantKey: key },
      create: {
        ...key,
        variantId: price.variantId,
        retailPriceKgs: price.retailPriceKgs,
        wholesalePriceKgs: price.wholesalePriceKgs,
        updatedById: input.actorId,
      },
      update: {
        retailPriceKgs: price.retailPriceKgs,
        wholesalePriceKgs: price.wholesalePriceKgs,
        updatedById: input.actorId,
      },
    });
    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      requestId: input.requestId,
      action: "STORE_PRICE_UPDATE",
      entity: "StorePrice",
      entityId: after.id,
      before: toJson(before ?? null),
      after: toJson(after),
    });
  }
}
