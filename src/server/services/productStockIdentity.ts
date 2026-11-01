import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeProductNameForDiagnostics } from "./products/diagnostics";

/** Store-scoped candidates, never a mapping or permission to combine stock. */
export async function getProductStockCandidates(
  db: PrismaClient,
  input: { organizationId: string; storeId: string; products: Array<{ id: string; name: string }> },
) {
  const names = [
    ...new Set(
      input.products
        .map((p) => normalizeProductNameForDiagnostics(p.name))
        .filter((n) => n.length >= 4),
    ),
  ];
  if (!names.length)
    return new Map<
      string,
      Array<{
        id: string;
        name: string;
        sku: string;
        unit: string;
        onHand: number;
        inAssortment: boolean;
      }>
    >();
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      name: string;
      sku: string;
      unit: string;
      normalized: string;
      onHand: number;
      inAssortment: boolean;
    }>
  >(Prisma.sql`
    WITH candidates AS (
      SELECT p.id,p.name,p.sku,p.unit,
        btrim(regexp_replace(lower(p.name COLLATE "und-x-icu"),'[^[:alnum:]]+',' ','g')) AS normalized,
        COALESCE((SELECT SUM(s."onHand") FROM "InventorySnapshot" s WHERE s."productId"=p.id AND s."storeId"=${input.storeId}),0)::float8 AS "onHand",
        EXISTS(SELECT 1 FROM "StoreProduct" a WHERE a."productId"=p.id AND a."storeId"=${input.storeId} AND a."isActive" AND NOT a."isHidden") AS "inAssortment"
      FROM "Product" p WHERE p."organizationId"=${input.organizationId} AND NOT p."isDeleted"
        AND btrim(regexp_replace(lower(p.name COLLATE "und-x-icu"),'[^[:alnum:]]+',' ','g')) IN (${Prisma.join(names)})
        AND (EXISTS(SELECT 1 FROM "StoreProduct" a WHERE a."productId"=p.id AND a."storeId"=${input.storeId})
          OR EXISTS(SELECT 1 FROM "InventorySnapshot" s WHERE s."productId"=p.id AND s."storeId"=${input.storeId}))
    ), ranked AS (SELECT *,row_number() OVER(PARTITION BY normalized ORDER BY ABS("onHand") DESC,id) AS rank FROM candidates)
    SELECT id,name,sku,unit,normalized,"onHand","inAssortment" FROM ranked WHERE rank<=6
  `);
  const byName = new Map<string, typeof rows>();
  for (const row of rows) byName.set(row.normalized, [...(byName.get(row.normalized) ?? []), row]);
  return new Map(
    input.products.map((product) => [
      product.id,
      (byName.get(normalizeProductNameForDiagnostics(product.name)) ?? [])
        .filter((row) => row.id !== product.id)
        .slice(0, 3)
        .map(({ normalized: _normalized, ...row }) => row),
    ]),
  );
}
