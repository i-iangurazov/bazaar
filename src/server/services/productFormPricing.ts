import type { Prisma } from "@prisma/client";

import { AppError } from "@/server/services/errors";

/** Validate the full product editor using the organization's current setting.
 * Legacy clients may still submit the ordinary price; media-only saves and
 * inventory/import writers do not run this editor-specific requirement. */
export async function resolveProductFormRetailPrice(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    productId?: string;
    storeId?: string | null;
    retailPriceKgs?: number | null;
    storePriceKgs?: number;
    basePriceKgs?: number | null;
  },
) {
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    select: { retailWholesaleEnabled: true },
  });
  if (!organization.retailWholesaleEnabled) return input.retailPriceKgs;
  if (input.retailPriceKgs === null) {
    throw new AppError("retailPriceRequired", "BAD_REQUEST", 400);
  }
  if (input.retailPriceKgs !== undefined) return input.retailPriceKgs;

  const key =
    input.productId && input.storeId
      ? {
          organizationId: input.organizationId,
          storeId: input.storeId,
          productId: input.productId,
          variantKey: "BASE",
        }
      : null;
  const [prices, standard, product] = await Promise.all([
    key
      ? tx.storePriceTypes.findUnique({
          where: { organizationId_storeId_productId_variantKey: key },
          select: { retailPriceKgs: true },
        })
      : null,
    key
      ? tx.storePrice.findUnique({
          where: { organizationId_storeId_productId_variantKey: key },
          select: { priceKgs: true },
        })
      : null,
    input.productId
      ? tx.product.findFirst({
          where: { id: input.productId, organizationId: input.organizationId },
          select: { basePriceKgs: true },
        })
      : null,
  ]);
  const retail =
    input.storePriceKgs ??
    prices?.retailPriceKgs?.toNumber() ??
    input.basePriceKgs ??
    standard?.priceKgs.toNumber() ??
    product?.basePriceKgs?.toNumber();
  if (retail === undefined) throw new AppError("retailPriceRequired", "BAD_REQUEST", 400);
  return retail;
}
