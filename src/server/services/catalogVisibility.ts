import { Prisma } from "@prisma/client";

type CatalogVisibility = {
  organizationId: string;
  storeId: string;
  hideOutOfStock: boolean;
  hideWithoutPhoto: boolean;
};

/** Applied before counts/pagination and at checkout, using the selected store only. */
export async function catalogVisibilityWhere(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  catalog: CatalogVisibility,
): Promise<Prisma.ProductWhereInput[]> {
  const filters: Prisma.ProductWhereInput[] = [];
  if (catalog.hideWithoutPhoto) {
    // Managed uploads and HTTPS images are supported. Inline data is not public imagery.
    const photo = {
      OR: [{ startsWith: "/" }, { startsWith: "https://" }, { startsWith: "http://" }],
    };
    filters.push({
      OR: [
        { photoUrl: { not: null }, OR: photo.OR.map((url) => ({ photoUrl: url })) },
        { images: { some: { OR: photo.OR.map((url) => ({ url })) } } },
        { variants: { some: { isActive: true, image: { OR: photo.OR.map((url) => ({ url })) } } } },
      ],
    });
  }
  if (catalog.hideOutOfStock) {
    // Bundles have no independent stock: all components must make at least one kit.
    const bundles = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p.id FROM "Product" p
      WHERE p."organizationId" = ${catalog.organizationId} AND p."isBundle" = true
        AND EXISTS (SELECT 1 FROM "ProductBundleComponent" c WHERE c."bundleProductId" = p.id)
        AND NOT EXISTS (
          SELECT 1 FROM "ProductBundleComponent" c
          JOIN "Product" component ON component.id = c."componentProductId"
          LEFT JOIN "ProductVariant" v ON v.id = c."componentVariantId"
          LEFT JOIN "InventorySnapshot" s ON s."productId" = c."componentProductId"
            AND s."storeId" = ${catalog.storeId}
            AND s."variantKey" = COALESCE(c."componentVariantId", 'BASE')
          WHERE c."bundleProductId" = p.id
            AND (c.qty <= 0 OR component."isDeleted" OR
              (c."componentVariantId" IS NOT NULL AND (v.id IS NULL OR NOT v."isActive")) OR
              COALESCE(s."onHand", 0) < (
                SELECT SUM(required.qty) FROM "ProductBundleComponent" required
                WHERE required."bundleProductId" = p.id
                  AND required."componentProductId" = c."componentProductId"
                  AND COALESCE(required."componentVariantId", 'BASE') = COALESCE(c."componentVariantId", 'BASE')
              ))
        )
    `);
    filters.push({
      OR: [
        {
          isBundle: false,
          variants: {
            some: {
              isActive: true,
              inventorySnapshots: { some: { storeId: catalog.storeId, onHand: { gt: 0 } } },
            },
          },
        },
        {
          isBundle: false,
          variants: { none: { isActive: true } },
          inventorySnapshots: {
            some: { storeId: catalog.storeId, variantKey: "BASE", onHand: { gt: 0 } },
          },
        },
        { isBundle: true, id: { in: bundles.map((row) => row.id) } },
      ],
    });
  }
  return filters;
}
