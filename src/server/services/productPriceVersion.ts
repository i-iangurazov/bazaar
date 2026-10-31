import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

type Money = { toString(): string } | number | string | null;
export function productPriceVersion(
  standard: Array<{ variantKey: string; priceKgs: Money; updatedAt: Date }>,
  extra: Array<{
    variantKey: string;
    retailPriceKgs: Money;
    wholesalePriceKgs: Money;
    updatedAt: Date;
  }>,
) {
  const a = standard
    .map((p) => [p.variantKey, p.priceKgs?.toString() ?? null, p.updatedAt.toISOString()])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const b = extra
    .map((p) => [
      p.variantKey,
      p.retailPriceKgs?.toString() ?? null,
      p.wholesalePriceKgs?.toString() ?? null,
      p.updatedAt.toISOString(),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256")
    .update(JSON.stringify([a, b]))
    .digest("hex");
}
export async function readProductPriceVersion(
  tx: Prisma.TransactionClient,
  organizationId: string,
  storeId: string,
  productId: string,
) {
  const [standard, extra] = await Promise.all([
    tx.storePrice.findMany({
      where: { organizationId, storeId, productId },
      select: { variantKey: true, priceKgs: true, updatedAt: true },
    }),
    tx.storePriceTypes.findMany({
      where: { organizationId, storeId, productId },
      select: { variantKey: true, retailPriceKgs: true, wholesalePriceKgs: true, updatedAt: true },
    }),
  ]);
  return productPriceVersion(standard, extra);
}
