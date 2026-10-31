import { Prisma, type PrismaClient } from "@prisma/client";

/** Candidates only. Equal names never authorize merging cards or moving their history. */
export async function reviewDuplicateProducts(
  db: PrismaClient,
  input: { organizationId: string; page: number; search?: string },
) {
  return db.$transaction(
    async (tx) => {
      const search = input.search?.trim();
      const rows = await tx.$queryRaw<
        Array<{ normalized: string; cards: number; total: bigint }>
      >(Prisma.sql`
      WITH groups AS (
        SELECT btrim(regexp_replace(lower(name), '[^[:alnum:]]+', ' ', 'g')) AS normalized, count(*)::int AS cards
        FROM "Product" WHERE "organizationId"=${input.organizationId} AND "isDeleted"=false
        GROUP BY btrim(regexp_replace(lower(name), '[^[:alnum:]]+', ' ', 'g')) HAVING count(*)>1
      ) SELECT *, count(*) OVER() AS total FROM groups WHERE normalized<>''
      ${
        search
          ? Prisma.sql`AND normalized ILIKE ${`%${search
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, " ")
              .trim()}%`}`
          : Prisma.empty
      }
      ORDER BY cards DESC, normalized LIMIT 10 OFFSET ${(input.page - 1) * 10}
    `);
      if (!rows.length) return { total: 0, groups: [] };
      const matches = await tx.$queryRaw<Array<{ id: string; normalized: string }>>(Prisma.sql`
      SELECT id, btrim(regexp_replace(lower(name), '[^[:alnum:]]+', ' ', 'g')) AS normalized
      FROM "Product" WHERE "organizationId"=${input.organizationId} AND "isDeleted"=false
      AND btrim(regexp_replace(lower(name), '[^[:alnum:]]+', ' ', 'g')) IN (${Prisma.join(rows.map((r) => r.normalized))})
      ORDER BY name, "createdAt", id LIMIT 201
    `);
      const products = await tx.product.findMany({
        where: {
          organizationId: input.organizationId,
          id: { in: matches.slice(0, 200).map((m) => m.id) },
        },
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          createdAt: true,
          photoUrl: true,
          barcodes: { select: { value: true } },
          storeProducts: {
            where: { OR: [{ isActive: true }, { isHidden: true }] },
            select: {
              isDirect: true,
              isActive: true,
              isHidden: true,
              store: { select: { id: true, name: true } },
            },
          },
          inventorySnapshots: {
            where: { OR: [{ onHand: { not: 0 } }, { onOrder: { not: 0 } }] },
            select: { store: { select: { name: true } } },
          },
          _count: {
            select: {
              stockMovements: true,
              purchaseOrderLines: true,
              customerOrderLines: true,
              variants: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const normalizedById = new Map(matches.map((m) => [m.id, m.normalized]));
      return {
        total: Number(rows[0].total),
        groups: rows.map((r) => ({
          normalized: r.normalized,
          cards: r.cards,
          products: products
            .filter((p) => normalizedById.get(p.id) === r.normalized)
            .map(({ inventorySnapshots, ...p }) => ({
              ...p,
              stockStores: [...new Set(inventorySnapshots.map((s) => s.store.name))],
            })),
        })),
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 30_000 },
  );
}
