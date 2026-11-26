import type { Prisma } from "@prisma/client";
import { productPhotoSearchModel, productPhotoSearchStreamMaxImages } from "@/lib/productPhotoSearch";

/** Fingerprint the search corpus in PostgreSQL without transferring vectors or URLs. */
export async function productPhotoIndexRevision(
  db: Pick<Prisma.TransactionClient, "$queryRaw">, organizationId: string, storeId: string,
) {
  const limit = productPhotoSearchStreamMaxImages + 1;
  const [row] = await db.$queryRaw<{ revision: string | null }[]>`
    WITH assortment AS MATERIALIZED (
      SELECT p.id, p."photoUrl", CASE WHEN p."photoUrl" <> '' THEN p."updatedAt" END AS revision
      FROM "StoreProduct" s JOIN "Product" p ON p.id = s."productId" AND p."organizationId" = s."organizationId"
      WHERE s."organizationId" = ${organizationId} AND s."storeId" = ${storeId}
        AND s."isActive" AND NOT s."isHidden" AND NOT p."isDeleted"
      LIMIT ${limit}
    ), photos AS MATERIALIZED (
      SELECT i.id, i."productId", i.url, i.position, i."updatedAt"
      FROM "ProductImage" i JOIN assortment p ON p.id = i."productId"
      WHERE i."organizationId" = ${organizationId} AND i.url <> ''
      LIMIT ${limit}
    ), features AS MATERIALIZED (
      SELECT f.id, f."productId", f."sourceKey", f."updatedAt", f.xmin::text AS version
      FROM "ProductPhotoFeature" f JOIN assortment p ON p.id = f."productId"
      WHERE f."organizationId" = ${organizationId} AND f."modelVersion" = ${productPhotoSearchModel}
        AND f.status = 'READY'
      LIMIT ${limit}
    )
    SELECT CASE WHEN EXISTS (SELECT 1 FROM assortment OFFSET ${limit - 1})
      OR EXISTS (SELECT 1 FROM photos OFFSET ${limit - 1})
      OR EXISTS (SELECT 1 FROM features OFFSET ${limit - 1}) THEN NULL
    ELSE encode(sha256(convert_to(concat(
      (SELECT string_agg(json_build_array(id, "photoUrl", revision)::text, chr(10) ORDER BY id COLLATE "C") FROM assortment), chr(10) || chr(10),
      (SELECT string_agg(json_build_array(id, "productId", url, position, "updatedAt")::text, chr(10) ORDER BY id COLLATE "C") FROM photos), chr(10) || chr(10),
      (SELECT string_agg(json_build_array(id, "productId", "sourceKey", "updatedAt", version)::text, chr(10) ORDER BY id COLLATE "C") FROM features)
    ), 'UTF8')), 'hex') END AS revision
  `;
  return row?.revision ?? null;
}
