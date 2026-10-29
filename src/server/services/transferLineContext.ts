import type { PrismaClient } from "@prisma/client";
import { inventoryProductAccessWhere } from "./storeAccess";

/** Read-only batched validation; never grants assortment or creates snapshots. */
export async function getTransferLineContext(
  db: PrismaClient,
  input: {
    organizationId: string;
    fromStoreId: string;
    toStoreId: string;
    lines: Array<{ productId: string; variantId?: string | null }>;
  },
) {
  const [destinationStore, products] = await Promise.all([
    db.store.findFirst({
      where: { id: input.toStoreId, organizationId: input.organizationId },
      select: { catalogSourcesConfigured: true },
    }),
    db.product.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: [...new Set(input.lines.map((l) => l.productId))] },
        isDeleted: false,
        ...inventoryProductAccessWhere(input.fromStoreId),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        baseUnit: true,
        variants: { where: { isActive: true }, select: { id: true, name: true } },
        inventorySnapshots: {
          where: { storeId: { in: [input.fromStoreId, input.toStoreId] } },
          select: { storeId: true, variantKey: true, onHand: true },
        },
        productCosts: {
          where: { organizationId: input.organizationId },
          select: { variantKey: true, avgCostKgs: true },
        },
        storeProducts: {
          where: { storeId: input.toStoreId },
          select: { isActive: true, isHidden: true },
        },
      },
    }),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  return input.lines.map((line) => {
    const key = `${line.productId}:${line.variantId ?? "BASE"}`;
    const product = byId.get(line.productId);
    const variant = line.variantId ? product?.variants.find((v) => v.id === line.variantId) : null;
    if (!product || (line.variantId && !variant)) return { key, available: false as const };
    const variantKey = line.variantId ?? "BASE";
    const cost =
      product.productCosts.find((c) => c.variantKey === variantKey) ??
      product.productCosts.find((c) => c.variantKey === "BASE");
    return {
      key,
      available: true as const,
      productName: product.name,
      variantName: variant?.name ?? null,
      sku: product.sku,
      quantityPrecision: product.baseUnit.quantityPrecision,
      sourceStock:
        product.inventorySnapshots.find(
          (s) => s.storeId === input.fromStoreId && s.variantKey === variantKey,
        )?.onHand ?? 0,
      destinationStock:
        product.inventorySnapshots.find(
          (s) => s.storeId === input.toStoreId && s.variantKey === variantKey,
        )?.onHand ?? 0,
      destinationInAssortment: product.storeProducts.some((s) => s.isActive && !s.isHidden),
      destinationRequiresAssortment: Boolean(
        destinationStore?.catalogSourcesConfigured &&
        !product.storeProducts.some((s) => s.isActive && !s.isHidden),
      ),
      unitCostKgs: cost ? Number(cost.avgCostKgs) : null,
    };
  });
}
