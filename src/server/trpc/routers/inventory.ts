import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  adminProcedure,
  managerProcedure,
  protectedProcedure,
  rateLimit,
  router,
} from "@/server/trpc/trpc";
import { logProfileSection } from "@/server/profiling/perf";
import { toTRPCError } from "@/server/trpc/errors";
import {
  adjustStock,
  bulkSetOnHand,
  editStockMovementDocument,
  postStockReceiving,
  postStockWriteOff,
  receiveStock,
  recomputeInventorySnapshots,
  transferStock,
} from "@/server/services/inventory";
import {
  editCompletedPosSale,
  editCompletedSaleReturn,
  getPosSale,
  getSaleReturn,
} from "@/server/services/pos";
import {
  decodeProductMovementDocumentKey,
  getProductMovementDocument,
  listProductMovementJournal,
  productMovementDocumentTypes,
  productMovementPaymentStatuses,
  productMovementSortKeys,
} from "@/server/services/productMovements";
import { buildReorderSuggestion } from "@/server/services/reorderSuggestions";
import { setDefaultMinStock, setMinStock } from "@/server/services/reorderPolicies";
import {
  assertUserCanAccessStore,
  productStoreAssignmentWhere,
} from "@/server/services/storeAccess";
import { WRITE_OFF_REASONS } from "@/lib/inventory/writeOff";

const inventoryStockFilterSchema = z.enum(["all", "lowStock", "outOfStock", "negativeStock"]);
const inventorySortKeySchema = z.enum([
  "sku",
  "image",
  "product",
  "onHand",
  "minStock",
  "lowStock",
  "onOrder",
  "suggestedOrder",
]);
const inventorySortDirectionSchema = z.enum(["asc", "desc"]);
const productMovementDocumentTypeSchema = z.enum(productMovementDocumentTypes);
const productMovementPaymentStatusSchema = z.enum(productMovementPaymentStatuses);
const productMovementSortKeySchema = z.enum(productMovementSortKeys);
const writeOffReasonSchema = z.enum(WRITE_OFF_REASONS);
type InventorySortKey = z.infer<typeof inventorySortKeySchema>;
type InventorySortDirection = z.infer<typeof inventorySortDirectionSchema>;

const inventoryListBaseInputSchema = z.object({
  storeId: z.string(),
  search: z.string().optional(),
  stockFilter: inventoryStockFilterSchema.optional().default("all"),
});

const inventoryListInputSchema = inventoryListBaseInputSchema.extend({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(10).max(200).optional(),
  sortKey: inventorySortKeySchema.optional().default("product"),
  sortDirection: inventorySortDirectionSchema.optional().default("asc"),
});

const inventoryListIdsInputSchema = inventoryListBaseInputSchema;
const inventoryProductSearchFieldSchema = z.enum(["name", "sku", "barcode", "packBarcode"]);
type InventoryProductSearchField = z.infer<typeof inventoryProductSearchFieldSchema>;
const defaultInventoryProductSearchFields: InventoryProductSearchField[] = [
  "name",
  "sku",
  "barcode",
  "packBarcode",
];

const inventoryProductSearchInputSchema = z.object({
  storeId: z.string(),
  search: z.string().optional(),
  productId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  searchFields: z.array(inventoryProductSearchFieldSchema).optional(),
});

const productMovementEditLineSchema = z.object({
  lineId: z.string().min(1).optional().nullable(),
  customerOrderLineId: z.string().min(1).optional().nullable(),
  productId: z.string().min(1),
  variantId: z.string().optional().nullable(),
  quantity: z.number().int().positive(),
  unitPriceKgs: z.number().min(0).optional().nullable(),
  unitCostKgs: z.number().min(0).optional().nullable(),
});

const normalizeInventorySearchTokens = (search?: string | null) =>
  Array.from(
    new Set(
      (search ?? "")
        .trim()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);

const buildInventoryProductSearchWhere = (
  searchTokens: string[],
  searchFields: InventoryProductSearchField[] = defaultInventoryProductSearchFields,
): Prisma.ProductWhereInput => {
  if (!searchTokens.length) {
    return {};
  }

  const enabledFields = new Set(searchFields);
  return {
    AND: searchTokens.map((token) => {
      const or: Prisma.ProductWhereInput[] = [];
      if (enabledFields.has("name")) {
        or.push({ name: { contains: token, mode: "insensitive" as const } });
      }
      if (enabledFields.has("sku")) {
        or.push({ sku: { contains: token, mode: "insensitive" as const } });
      }
      if (enabledFields.has("barcode")) {
        or.push({
          barcodes: {
            some: { value: { contains: token, mode: "insensitive" as const } },
          },
        });
      }
      if (enabledFields.has("packBarcode")) {
        or.push({
          packs: {
            some: { packBarcode: { contains: token, mode: "insensitive" as const } },
          },
        });
      }
      return or.length ? { OR: or } : { id: { in: [] } };
    }),
  };
};

const buildInventorySnapshotWhere = (
  input: z.infer<typeof inventoryListIdsInputSchema>,
): Prisma.InventorySnapshotWhereInput => {
  const searchTokens = normalizeInventorySearchTokens(input.search);
  return {
    storeId: input.storeId,
    ...(input.stockFilter === "negativeStock" ? { onHand: { lt: 0 } } : {}),
    ...(input.stockFilter === "outOfStock" ? { onHand: { equals: 0 } } : {}),
    product: {
      isDeleted: false,
      ...productStoreAssignmentWhere(input.storeId),
      ...buildInventoryProductSearchWhere(searchTokens),
    },
  };
};

const buildLowStockSnapshotSql = (
  input: z.infer<typeof inventoryListIdsInputSchema>,
  organizationId: string,
) => {
  const searchTokens = normalizeInventorySearchTokens(input.search);
  const searchSql = searchTokens.reduce<Prisma.Sql>((sql, token) => {
    const searchPattern = `%${token}%`;
    return Prisma.sql`${sql}
      AND (
        p."name" ILIKE ${searchPattern}
        OR p."sku" ILIKE ${searchPattern}
        OR EXISTS (
          SELECT 1 FROM "ProductBarcode" b
          WHERE b."productId" = p."id" AND b."value" ILIKE ${searchPattern}
        )
        OR EXISTS (
          SELECT 1 FROM "ProductPack" pack
          WHERE pack."productId" = p."id" AND pack."packBarcode" ILIKE ${searchPattern}
        )
      )
    `;
  }, Prisma.empty);

  return Prisma.sql`
    FROM "InventorySnapshot" s
    JOIN "Product" p ON p."id" = s."productId"
    JOIN "StoreProduct" sp
      ON sp."storeId" = s."storeId"
     AND sp."productId" = s."productId"
     AND sp."isActive" = true
    JOIN "ReorderPolicy" rp ON rp."storeId" = s."storeId" AND rp."productId" = s."productId"
    WHERE s."storeId" = ${input.storeId}
      AND p."organizationId" = ${organizationId}
      AND sp."organizationId" = ${organizationId}
      AND p."isDeleted" = false
      AND rp."minStock" > 0
      AND s."onHand" <= rp."minStock"
      AND s."onHand" >= 0
      ${searchSql}
  `;
};

const fullSortInventoryKeys = new Set<InventorySortKey>(["minStock", "lowStock", "suggestedOrder"]);

const inventorySortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const getInventorySnapshotOrderBy = (
  sortKey: InventorySortKey,
  sortDirection: InventorySortDirection,
): Prisma.InventorySnapshotOrderByWithRelationInput[] => {
  const nameFallback: Prisma.InventorySnapshotOrderByWithRelationInput[] = [
    { product: { name: "asc" } },
    { variantKey: "asc" },
    { id: "asc" },
  ];

  switch (sortKey) {
    case "sku":
      return [{ product: { sku: sortDirection } }, ...nameFallback];
    case "image":
      return [
        { product: { images: { _count: sortDirection } } },
        { product: { photoUrl: sortDirection } },
        { product: { name: sortDirection } },
        { product: { sku: sortDirection } },
        { variantKey: sortDirection },
        { id: sortDirection },
      ];
    case "onHand":
      return [{ onHand: sortDirection }, ...nameFallback];
    case "onOrder":
      return [{ onOrder: sortDirection }, ...nameFallback];
    case "product":
    default:
      return [
        { product: { name: sortDirection } },
        { variantKey: sortDirection },
        { product: { sku: "asc" } },
        { id: "asc" },
      ];
  }
};

const getLowStockOrderSql = (sortKey: InventorySortKey, sortDirection: InventorySortDirection) => {
  const direction = sortDirection === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  switch (sortKey) {
    case "sku":
      return Prisma.sql`ORDER BY p."sku" ${direction}, p."name" ASC, s."variantKey" ASC, s."id" ASC`;
    case "image":
      return Prisma.sql`
        ORDER BY CASE WHEN (
          (NULLIF(TRIM(COALESCE(p."photoUrl", '')), '') IS NOT NULL AND p."photoUrl" NOT LIKE 'data:image/%')
          OR EXISTS (
            SELECT 1 FROM "ProductImage" pi
            WHERE pi."productId" = p."id" AND pi."url" NOT LIKE 'data:image/%'
          )
        ) THEN 1 ELSE 0 END ${direction},
        p."name" ${direction},
        p."sku" ${direction},
        s."variantKey" ${direction},
        s."id" ${direction}
      `;
    case "onHand":
      return Prisma.sql`ORDER BY s."onHand" ${direction}, p."name" ASC, s."variantKey" ASC, s."id" ASC`;
    case "onOrder":
      return Prisma.sql`ORDER BY s."onOrder" ${direction}, p."name" ASC, s."variantKey" ASC, s."id" ASC`;
    case "product":
    default:
      return Prisma.sql`ORDER BY p."name" ${direction}, s."variantKey" ${direction}, p."sku" ASC, s."id" ASC`;
  }
};

const inventoryProductSelect = (storeId: string, organizationId: string) =>
  ({
    id: true,
    supplierId: true,
    sku: true,
    name: true,
    basePriceKgs: true,
    baseUnitId: true,
    photoUrl: true,
    baseUnit: true,
    packs: {
      select: {
        id: true,
        packName: true,
        packBarcode: true,
        multiplierToBase: true,
        allowInPurchasing: true,
        allowInReceiving: true,
      },
    },
    images: {
      where: {
        url: {
          not: { startsWith: "data:image/" },
        },
      },
      select: { id: true, url: true, position: true },
      orderBy: { position: "asc" as const },
      take: 1,
    },
    barcodes: {
      select: { value: true },
      take: 5,
    },
    productCosts: {
      where: { organizationId },
      select: { variantKey: true, avgCostKgs: true },
    },
    storePrices: {
      where: { organizationId, storeId },
      select: { variantKey: true, priceKgs: true },
    },
  }) as const;

const inventoryListSnapshotSelect = {
  id: true,
  storeId: true,
  productId: true,
  variantId: true,
  variantKey: true,
  onHand: true,
  onOrder: true,
  allowNegativeStock: true,
  updatedAt: true,
  product: {
    select: {
      id: true,
      supplierId: true,
      sku: true,
      name: true,
      basePriceKgs: true,
      baseUnitId: true,
      photoUrl: true,
      baseUnit: true,
      packs: {
        select: {
          id: true,
          packName: true,
          multiplierToBase: true,
          allowInPurchasing: true,
          allowInReceiving: true,
        },
      },
      images: {
        where: {
          url: {
            not: { startsWith: "data:image/" },
          },
        },
        select: { id: true, url: true, position: true },
        orderBy: { position: "asc" as const },
        take: 1,
      },
      barcodes: {
        select: { value: true },
        take: 5,
      },
    },
  },
  variant: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.InventorySnapshotSelect;

type InventoryListSnapshot = Prisma.InventorySnapshotGetPayload<{
  select: typeof inventoryListSnapshotSelect;
}>;
type InventoryListItem = {
  snapshot: InventoryListSnapshot;
  product: InventoryListSnapshot["product"];
  variant: InventoryListSnapshot["variant"];
  minStock: number;
  lowStock: boolean;
  reorder: ReturnType<typeof buildReorderSuggestion>;
};

const sortInventoryItems = (
  items: InventoryListItem[],
  sortKey: InventorySortKey,
  sortDirection: InventorySortDirection,
) => {
  const directionMultiplier = sortDirection === "asc" ? 1 : -1;
  const hasInventoryItemImage = (item: InventoryListItem) =>
    [...(item.product.images ?? []).map((image) => image.url), item.product.photoUrl].some(
      (url) => {
        const trimmed = url?.trim();
        return Boolean(trimmed && !trimmed.startsWith("data:image/"));
      },
    );
  return [...items].sort((left, right) => {
    let result = 0;
    switch (sortKey) {
      case "sku":
        result = inventorySortCollator.compare(left.product.sku, right.product.sku);
        break;
      case "image":
        result = Number(hasInventoryItemImage(left)) - Number(hasInventoryItemImage(right));
        break;
      case "product":
        result = inventorySortCollator.compare(left.product.name, right.product.name);
        break;
      case "onHand":
        result = left.snapshot.onHand - right.snapshot.onHand;
        break;
      case "minStock":
        result = left.minStock - right.minStock;
        break;
      case "lowStock":
        result = Number(left.lowStock) - Number(right.lowStock);
        break;
      case "onOrder":
        result = left.snapshot.onOrder - right.snapshot.onOrder;
        break;
      case "suggestedOrder":
        result = (left.reorder?.suggestedOrderQty ?? 0) - (right.reorder?.suggestedOrderQty ?? 0);
        break;
      default:
        result = 0;
    }

    if (result === 0) {
      result = inventorySortCollator.compare(left.product.name, right.product.name);
    }
    if (result === 0) {
      result = inventorySortCollator.compare(left.product.sku, right.product.sku);
    }
    if (result === 0) {
      result = inventorySortCollator.compare(left.snapshot.variantKey, right.snapshot.variantKey);
    }
    if (result === 0) {
      result = left.snapshot.id.localeCompare(right.snapshot.id);
    }
    return result * directionMultiplier;
  });
};

export const inventoryRouter = router({
  list: protectedProcedure.input(inventoryListInputSchema).query(async ({ ctx, input }) => {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const sortKey = input.sortKey;
    const sortDirection = input.sortDirection;
    const useFullSort = fullSortInventoryKeys.has(sortKey);
    const storeAccessStartedAt = Date.now();
    await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
    logProfileSection({
      logger: ctx.logger,
      scope: "inventory.list",
      section: "storeAccess",
      startedAt: storeAccessStartedAt,
      details: {
        hasStoreId: true,
      },
    });

    const where = buildInventorySnapshotWhere(input);
    const primaryReadsStartedAt = Date.now();
    let total = 0;
    let snapshots: Array<
      Prisma.InventorySnapshotGetPayload<{ select: typeof inventoryListSnapshotSelect }>
    > = [];
    if (input.stockFilter === "lowStock") {
      const lowStockSql = buildLowStockSnapshotSql(input, ctx.user.organizationId);
      const lowStockOrderSql = useFullSort
        ? Prisma.sql`ORDER BY p."name" ASC, s."variantKey" ASC, s."id" ASC`
        : getLowStockOrderSql(sortKey, sortDirection);
      const lowStockPaginationSql = useFullSort
        ? Prisma.empty
        : Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
      const [countRows, idRows] = await Promise.all([
        ctx.prisma.$queryRaw<Array<{ count: number | bigint }>>(
          Prisma.sql`SELECT COUNT(*)::int AS count ${lowStockSql}`,
        ),
        ctx.prisma.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT s."id"
            ${lowStockSql}
            ${lowStockOrderSql}
            ${lowStockPaginationSql}
          `,
        ),
      ]);
      total = Number(countRows[0]?.count ?? 0);
      const snapshotIds = idRows.map((row) => row.id);
      if (snapshotIds.length) {
        const unorderedSnapshots = await ctx.prisma.inventorySnapshot.findMany({
          where: { id: { in: snapshotIds } },
          select: inventoryListSnapshotSelect,
        });
        const snapshotMap = new Map(unorderedSnapshots.map((snapshot) => [snapshot.id, snapshot]));
        snapshots = snapshotIds
          .map((snapshotId) => snapshotMap.get(snapshotId))
          .filter(
            (
              snapshot,
            ): snapshot is Prisma.InventorySnapshotGetPayload<{
              select: typeof inventoryListSnapshotSelect;
            }> => Boolean(snapshot),
          );
      }
    } else {
      [total, snapshots] = await Promise.all([
        ctx.prisma.inventorySnapshot.count({ where }),
        ctx.prisma.inventorySnapshot.findMany({
          where,
          select: inventoryListSnapshotSelect,
          orderBy: useFullSort
            ? [{ product: { name: "asc" } }, { variantKey: "asc" }, { id: "asc" }]
            : getInventorySnapshotOrderBy(sortKey, sortDirection),
          skip: useFullSort ? undefined : (page - 1) * pageSize,
          take: useFullSort ? undefined : pageSize,
        }),
      ]);
    }
    logProfileSection({
      logger: ctx.logger,
      scope: "inventory.list",
      section: "primaryReads",
      startedAt: primaryReadsStartedAt,
      details: {
        total,
        page,
        pageSize,
        snapshots: snapshots.length,
        hasSearch: Boolean(input.search?.trim()),
        stockFilter: input.stockFilter,
        sortKey,
        sortDirection,
        useFullSort,
      },
    });

    const productIds = snapshots.map((snapshot) => snapshot.productId);
    const enrichmentReadsStartedAt = Date.now();
    const [policies, forecasts] =
      productIds.length > 0
        ? await Promise.all([
            ctx.prisma.reorderPolicy.findMany({
              where: { storeId: input.storeId, productId: { in: productIds } },
            }),
            ctx.prisma.forecastSnapshot.findMany({
              where: { storeId: input.storeId, productId: { in: productIds } },
              orderBy: { generatedAt: "desc" },
              distinct: ["productId"],
            }),
          ])
        : [[], []];
    logProfileSection({
      logger: ctx.logger,
      scope: "inventory.list",
      section: "enrichmentReads",
      startedAt: enrichmentReadsStartedAt,
      details: {
        productIds: productIds.length,
        policies: policies.length,
        forecasts: forecasts.length,
      },
    });

    const policyMap = new Map(policies.map((policy) => [policy.productId, policy]));
    const forecastMap = new Map(forecasts.map((forecast) => [forecast.productId, forecast]));

    const enrichedItems = snapshots.map((snapshot) => {
      const policy = policyMap.get(snapshot.productId) ?? null;
      const minStock = policy?.minStock ?? 0;
      return {
        snapshot,
        product: snapshot.product,
        variant: snapshot.variant,
        minStock,
        lowStock: minStock > 0 && snapshot.onHand <= minStock,
        reorder: buildReorderSuggestion(
          snapshot,
          policy,
          forecastMap.get(snapshot.productId) ?? null,
        ),
      };
    });
    const items = useFullSort
      ? sortInventoryItems(enrichedItems, sortKey, sortDirection).slice(
          (page - 1) * pageSize,
          page * pageSize,
        )
      : enrichedItems;

    return { items, total, page, pageSize };
  }),

  listIds: protectedProcedure.input(inventoryListIdsInputSchema).query(async ({ ctx, input }) => {
    await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);

    if (input.stockFilter === "lowStock") {
      const rows = await ctx.prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT s."id"
          ${buildLowStockSnapshotSql(input, ctx.user.organizationId)}
          ORDER BY p."name" ASC, s."variantKey" ASC
        `,
      );
      return rows.map((row) => row.id);
    }

    const where = buildInventorySnapshotWhere(input);

    const rows = await ctx.prisma.inventorySnapshot.findMany({
      where,
      select: { id: true },
      orderBy: { product: { name: "asc" } },
    });
    return rows.map((row) => row.id);
  }),

  searchProducts: protectedProcedure
    .input(inventoryProductSearchInputSchema)
    .query(async ({ ctx, input }) => {
      await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);

      const searchTokens = normalizeInventorySearchTokens(input.search);
      const limit = input.limit ?? 25;
      const where = {
        organizationId: ctx.user.organizationId,
        isDeleted: false,
        ...productStoreAssignmentWhere(input.storeId),
        ...(input.productId
          ? { id: input.productId }
          : buildInventoryProductSearchWhere(searchTokens, input.searchFields)),
      };

      const products = await ctx.prisma.product.findMany({
        where,
        select: {
          ...inventoryProductSelect(input.storeId, ctx.user.organizationId),
          inventorySnapshots: {
            where: { storeId: input.storeId },
            select: {
              id: true,
              storeId: true,
              productId: true,
              variantId: true,
              variantKey: true,
              onHand: true,
              onOrder: true,
              allowNegativeStock: true,
              updatedAt: true,
            },
            orderBy: [{ variantKey: "asc" }, { id: "asc" }],
          },
          variants: {
            where: { isActive: true },
            select: { id: true, name: true },
          },
        },
        orderBy: [{ name: "asc" }, { sku: "asc" }, { id: "asc" }],
        take: limit,
      });

      return products.flatMap((product) => {
        const snapshots = product.inventorySnapshots.length
          ? product.inventorySnapshots
          : [
              {
                id: `synthetic:${input.storeId}:${product.id}:BASE`,
                storeId: input.storeId,
                productId: product.id,
                variantId: null,
                variantKey: "BASE",
                onHand: 0,
                onOrder: 0,
                allowNegativeStock: false,
                updatedAt: new Date(0),
              },
            ];
        return snapshots.map((snapshot) => {
          const variantKey = snapshot.variantKey;
          const cost =
            product.productCosts.find((item) => item.variantKey === variantKey) ??
            product.productCosts.find((item) => item.variantKey === "BASE") ??
            null;
          const price =
            product.storePrices.find((item) => item.variantKey === variantKey) ??
            product.storePrices.find((item) => item.variantKey === "BASE") ??
            null;
          const resultProduct = {
            id: product.id,
            supplierId: product.supplierId,
            sku: product.sku,
            name: product.name,
            basePriceKgs: product.basePriceKgs,
            baseUnitId: product.baseUnitId,
            photoUrl: product.photoUrl,
            baseUnit: product.baseUnit,
            packs: product.packs,
            images: product.images,
            barcodes: product.barcodes,
          };
          const variant =
            snapshot.variantId === null
              ? null
              : (product.variants.find((item) => item.id === snapshot.variantId) ?? null);
          return {
            snapshot,
            product: resultProduct,
            variant,
            primaryBarcode: resultProduct.barcodes[0]?.value ?? null,
            unitCostKgs: cost ? Number(cost.avgCostKgs) : null,
            priceKgs: price
              ? Number(price.priceKgs)
              : resultProduct.basePriceKgs
                ? Number(resultProduct.basePriceKgs)
                : null,
          };
        });
      });
    }),

  productIdsBySnapshotIds: protectedProcedure
    .input(z.object({ snapshotIds: z.array(z.string()).min(1).max(10_000) }))
    .query(async ({ ctx, input }) => {
      const snapshotIds = Array.from(new Set(input.snapshotIds.filter(Boolean)));
      if (!snapshotIds.length) {
        return [];
      }
      const rows = await ctx.prisma.inventorySnapshot.findMany({
        where: {
          id: { in: snapshotIds },
          store: { organizationId: ctx.user.organizationId },
          product: { isDeleted: false },
        },
        select: { productId: true },
      });
      return Array.from(new Set(rows.map((row) => row.productId)));
    }),

  movements: protectedProcedure
    .input(
      z.object({
        storeId: z.string(),
        productId: z.string(),
        variantId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);

      const product = await ctx.prisma.product.findUnique({ where: { id: input.productId } });
      if (!product || product.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "productAccessDenied" });
      }

      return ctx.prisma.stockMovement.findMany({
        where: {
          storeId: input.storeId,
          productId: input.productId,
          ...(input.variantId ? { variantId: input.variantId } : {}),
        },
        include: {
          createdBy: { select: { name: true, email: true } },
          variant: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    }),

  productMovements: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(200).optional(),
          dateFrom: z.string().trim().max(40).optional(),
          dateTo: z.string().trim().max(40).optional(),
          type: productMovementDocumentTypeSchema.optional(),
          status: z.string().trim().max(40).optional(),
          paymentStatus: productMovementPaymentStatusSchema.optional(),
          orderStatus: z.string().trim().max(40).optional(),
          storeId: z.string().trim().optional(),
          authorId: z.string().trim().optional(),
          authorSearch: z.string().trim().max(120).optional(),
          senderSearch: z.string().trim().max(160).optional(),
          recipientSearch: z.string().trim().max(160).optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(10).max(100).optional(),
          sortBy: productMovementSortKeySchema.optional(),
          sortDirection: inventorySortDirectionSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => listProductMovementJournal(ctx.prisma, ctx.user, input ?? {})),

  productMovementDocument: protectedProcedure
    .input(z.object({ documentKey: z.string().min(1).max(300) }))
    .query(async ({ ctx, input }) =>
      getProductMovementDocument(ctx.prisma, ctx.user, input.documentKey),
    ),

  editableProductMovementDocument: protectedProcedure
    .input(z.object({ documentKey: z.string().min(1).max(300) }))
    .query(async ({ ctx, input }) => {
      const decoded = decodeProductMovementDocumentKey(input.documentKey);
      if (!decoded) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "productMovementDocumentInvalid" });
      }

      if (decoded.documentType === "SALE" && decoded.documentReferenceType === "CustomerOrder") {
        const sale = await getPosSale({
          organizationId: ctx.user.organizationId,
          saleId: decoded.documentReferenceId,
          user: ctx.user,
        });
        if (!sale) {
          throw new TRPCError({ code: "NOT_FOUND", message: "productMovementDocumentNotFound" });
        }
        return {
          documentType: decoded.documentType,
          referenceType: decoded.documentReferenceType,
          referenceId: decoded.documentReferenceId,
          documentNumber: sale.number,
          storeId: sale.storeId,
          customerName: sale.customerName,
          customerEmail: sale.customerEmail,
          customerPhone: sale.customerPhone,
          customerAddress: sale.customerAddress,
          notes: sale.notes,
          lines: sale.lines.map((line) => ({
            lineId: line.id,
            customerOrderLineId: null as string | null,
            productId: line.productId,
            variantId: line.variantId ?? null,
            productName: line.product.name,
            variantName: line.variant?.name ?? null,
            quantity: line.qty,
            unitPriceKgs: line.unitPriceKgs,
            unitCostKgs: line.unitCostKgs,
          })),
        };
      }

      if (decoded.documentType === "RETURN" && decoded.documentReferenceType === "SaleReturn") {
        const saleReturn = await getSaleReturn({
          organizationId: ctx.user.organizationId,
          saleReturnId: decoded.documentReferenceId,
        });
        if (!saleReturn) {
          throw new TRPCError({ code: "NOT_FOUND", message: "productMovementDocumentNotFound" });
        }
        await assertUserCanAccessStore(ctx.prisma, ctx.user, saleReturn.storeId);
        return {
          documentType: decoded.documentType,
          referenceType: decoded.documentReferenceType,
          referenceId: decoded.documentReferenceId,
          documentNumber: saleReturn.number,
          storeId: saleReturn.storeId,
          customerName: saleReturn.originalSale.customerName,
          customerEmail: null as string | null,
          customerPhone: saleReturn.originalSale.customerPhone,
          customerAddress: null as string | null,
          notes: saleReturn.notes,
          returnableLines: saleReturn.originalSale.lines.map((line) => ({
            customerOrderLineId: line.id,
            productId: line.productId,
            variantId: line.variantId ?? null,
            productName: line.product.name,
            variantName: null as string | null,
            quantity: line.qty,
            unitPriceKgs: Number(line.unitPriceKgs),
            unitCostKgs: line.unitCostKgs === null ? null : Number(line.unitCostKgs),
          })),
          lines: saleReturn.lines.map((line) => ({
            lineId: line.id,
            customerOrderLineId: line.customerOrderLineId,
            productId: line.productId,
            variantId: line.variantId ?? null,
            productName: line.product.name,
            variantName: null as string | null,
            quantity: line.qty,
            unitPriceKgs: line.unitPriceKgs,
            unitCostKgs: line.unitCostKgs,
          })),
        };
      }

      if (
        decoded.documentType !== "STOCK_RECEIVING" &&
        decoded.documentType !== "TRANSFER" &&
        decoded.documentType !== "WRITE_OFF"
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "productMovementDocumentUnsupported" });
      }

      const document = await getProductMovementDocument(ctx.prisma, ctx.user, input.documentKey);
      if (!document) {
        throw new TRPCError({ code: "NOT_FOUND", message: "productMovementDocumentNotFound" });
      }

      const aggregates = new Map<
        string,
        {
          productId: string;
          variantId: string | null;
          productName: string;
          variantName: string | null;
          quantityDelta: number;
          lineTotalKgs: number;
          hasLineTotal: boolean;
          unitCostKgs: number | null;
          storeId: string;
        }
      >();
      document.lines.forEach((line) => {
        if (decoded.documentType === "TRANSFER" && line.movementType !== "TRANSFER_OUT") {
          return;
        }
        const variantKey = line.variantId ?? "BASE";
        const key = `${line.productId}:${variantKey}`;
        const existing = aggregates.get(key);
        if (existing) {
          existing.quantityDelta += line.qtyDelta;
          if (line.lineTotalKgs !== null) {
            existing.lineTotalKgs += line.lineTotalKgs;
            existing.hasLineTotal = true;
          }
          if (line.unitCostKgs !== null) {
            existing.unitCostKgs = line.unitCostKgs;
          }
          return;
        }
        aggregates.set(key, {
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName,
          variantName: line.variantName,
          quantityDelta: line.qtyDelta,
          lineTotalKgs: line.lineTotalKgs ?? 0,
          hasLineTotal: line.lineTotalKgs !== null,
          unitCostKgs: line.unitCostKgs,
          storeId: line.storeId,
        });
      });
      const sourceStoreId =
        decoded.documentType === "TRANSFER"
          ? (document.sourceStoreId ??
            document.lines.find((line) => line.movementType === "TRANSFER_OUT")?.storeId ??
            "")
          : (aggregates.values().next().value?.storeId ?? "");
      const destinationStoreId =
        decoded.documentType === "TRANSFER"
          ? (document.destinationStoreId ?? null)
          : null;

      return {
        documentType: decoded.documentType,
        referenceType: decoded.documentReferenceType,
        referenceId: decoded.documentReferenceId,
        documentNumber: document.documentNumber,
        storeId: sourceStoreId,
        sourceStoreId,
        destinationStoreId,
        customerName: null as string | null,
        customerEmail: null as string | null,
        customerPhone: null as string | null,
        customerAddress: null as string | null,
        notes: document.comment,
        reason: document.reason,
        lines: Array.from(aggregates.values())
          .map((line) => {
            const quantity =
              decoded.documentType === "STOCK_RECEIVING"
                ? line.quantityDelta
                : Math.abs(line.quantityDelta);
            const lineTotalKgs = line.hasLineTotal ? line.lineTotalKgs : null;
            return {
              lineId: null as string | null,
              customerOrderLineId: null as string | null,
              productId: line.productId,
              variantId: line.variantId,
              productName: line.productName,
              variantName: line.variantName,
              quantity,
              unitPriceKgs: null as number | null,
              unitCostKgs:
                lineTotalKgs !== null && quantity > 0
                  ? Math.round((lineTotalKgs / quantity) * 100) / 100
                  : line.unitCostKgs,
            };
          })
          .filter((line) => line.quantity > 0),
      };
    }),

  editProductMovementDocument: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "inventory-product-movement-edit" }))
    .input(
      z.object({
        documentKey: z.string().min(1).max(300),
        lines: z.array(productMovementEditLineSchema).min(1).max(500),
        customerName: z.string().max(160).optional().nullable(),
        customerEmail: z.string().max(254).optional().nullable(),
        customerPhone: z.string().max(64).optional().nullable(),
        customerAddress: z.string().max(512).optional().nullable(),
        notes: z.string().max(2_000).optional().nullable(),
        reason: z.string().max(500).optional().nullable(),
        destinationStoreId: z.string().optional().nullable(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const decoded = decodeProductMovementDocumentKey(input.documentKey);
        if (!decoded) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "productMovementDocumentInvalid" });
        }

        if (decoded.documentType === "SALE" && decoded.documentReferenceType === "CustomerOrder") {
          return await editCompletedPosSale({
            organizationId: ctx.user.organizationId,
            saleId: decoded.documentReferenceId,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone,
            customerAddress: input.customerAddress,
            notes: input.notes,
            reason: input.reason,
            lines: input.lines.map((line) => ({
              lineId: line.lineId,
              productId: line.productId,
              variantId: line.variantId,
              qty: line.quantity,
              unitPriceKgs: line.unitPriceKgs ?? 0,
            })),
            actorId: ctx.user.id,
            user: ctx.user,
            requestId: ctx.requestId,
            idempotencyKey: input.idempotencyKey,
          });
        }

        if (decoded.documentType === "RETURN" && decoded.documentReferenceType === "SaleReturn") {
          return await editCompletedSaleReturn({
            organizationId: ctx.user.organizationId,
            saleReturnId: decoded.documentReferenceId,
            notes: input.notes,
            reason: input.reason,
            lines: input.lines.map((line) => ({
              lineId: line.lineId,
              customerOrderLineId: line.customerOrderLineId,
              productId: line.productId,
              variantId: line.variantId,
              qty: line.quantity,
              unitPriceKgs: line.unitPriceKgs ?? 0,
            })),
            actorId: ctx.user.id,
            user: ctx.user,
            requestId: ctx.requestId,
            idempotencyKey: input.idempotencyKey,
          });
        }

        if (
          decoded.documentType === "STOCK_RECEIVING" ||
          decoded.documentType === "TRANSFER" ||
          decoded.documentType === "WRITE_OFF"
        ) {
          return await editStockMovementDocument({
            documentType: decoded.documentType,
            referenceType: decoded.documentReferenceType,
            referenceId: decoded.documentReferenceId,
            destinationStoreId: input.destinationStoreId,
            reason: input.reason,
            lines: input.lines.map((line) => ({
              productId: line.productId,
              variantId: line.variantId,
              quantity: line.quantity,
              unitCostKgs: line.unitCostKgs,
            })),
            actorId: ctx.user.id,
            organizationId: ctx.user.organizationId,
            user: ctx.user,
            requestId: ctx.requestId,
            idempotencyKey: input.idempotencyKey,
          });
        }

        throw new TRPCError({ code: "BAD_REQUEST", message: "productMovementDocumentUnsupported" });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  adjust: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 30, prefix: "inventory-adjust" }))
    .input(
      z.object({
        storeId: z.string(),
        productId: z.string(),
        variantId: z.string().optional(),
        qtyDelta: z
          .number()
          .int()
          .refine((value) => value !== 0, "nonZeroAdjustment"),
        unitId: z.string().optional(),
        packId: z.string().optional(),
        reason: z.string().min(3),
        expiryDate: z.string().optional(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await adjustStock({
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId,
          qtyDelta: input.qtyDelta,
          unitId: input.unitId,
          packId: input.packId,
          reason: input.reason,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkSetOnHand: adminProcedure
    .use(rateLimit({ windowMs: 600_000, max: 250, prefix: "inventory-bulk-on-hand" }))
    .input(
      z.object({
        storeId: z.string(),
        snapshotIds: z.array(z.string()).min(1).max(5_000, "inventoryBulkSelectionLimit"),
        targetOnHand: z.number().int().min(0),
        reason: z.string().min(3),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await bulkSetOnHand({
          storeId: input.storeId,
          snapshotIds: input.snapshotIds,
          targetOnHand: input.targetOnHand,
          reason: input.reason,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  receive: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 30, prefix: "inventory-receive" }))
    .input(
      z.object({
        storeId: z.string(),
        productId: z.string(),
        variantId: z.string().optional(),
        qtyReceived: z.number().int().positive(),
        unitId: z.string().optional(),
        packId: z.string().optional(),
        unitCost: z.number().min(0).optional().nullable(),
        expiryDate: z.string().optional(),
        note: z.string().optional(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await receiveStock({
          storeId: input.storeId,
          productId: input.productId,
          variantId: input.variantId,
          qtyReceived: input.qtyReceived,
          unitId: input.unitId,
          packId: input.packId,
          unitCost: input.unitCost ?? undefined,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
          note: input.note,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  postStockReceiving: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "inventory-stock-receiving" }))
    .input(
      z.object({
        storeId: z.string().min(1),
        date: z.string().datetime().optional(),
        supplierName: z.string().trim().max(160).optional(),
        note: z.string().trim().max(1_000).optional(),
        referenceNumber: z.string().trim().max(80).optional(),
        lines: z
          .array(
            z.object({
              productId: z.string().min(1),
              variantId: z.string().optional().nullable(),
              quantity: z.number().int().positive("invalidReceivingQuantity"),
              unitCost: z.number().min(0, "unitCostInvalid"),
            }),
          )
          .min(1, "receivingLinesRequired")
          .max(500),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await postStockReceiving({
          storeId: input.storeId,
          date: input.date ? new Date(input.date) : undefined,
          supplierName: input.supplierName,
          note: input.note,
          referenceNumber: input.referenceNumber,
          lines: input.lines,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  postStockWriteOff: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "inventory-stock-write-off" }))
    .input(
      z.object({
        storeId: z.string().min(1),
        date: z.string().datetime().optional(),
        reason: writeOffReasonSchema,
        comment: z.string().trim().max(1_000).optional(),
        lines: z
          .array(
            z.object({
              productId: z.string().min(1),
              variantId: z.string().optional().nullable(),
              qty: z.number().int().positive("invalidWriteOffQty"),
              unitId: z.string().optional().nullable(),
              packId: z.string().optional().nullable(),
            }),
          )
          .min(1, "writeOffLinesRequired")
          .max(500),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await postStockWriteOff({
          storeId: input.storeId,
          date: input.date ? new Date(input.date) : undefined,
          reason: input.reason,
          comment: input.comment,
          lines: input.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            qty: line.qty,
            unitId: line.unitId,
            packId: line.packId,
          })),
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  transfer: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "inventory-transfer" }))
    .input(
      z.object({
        fromStoreId: z.string(),
        toStoreId: z.string(),
        lines: z
          .array(
            z.object({
              productId: z.string().min(1),
              variantId: z.string().optional().nullable(),
              qty: z.number().int().positive(),
              unitId: z.string().optional().nullable(),
              packId: z.string().optional().nullable(),
              expiryDate: z.string().optional().nullable(),
            }),
          )
          .min(1)
          .max(500)
          .optional(),
        productId: z.string().optional(),
        variantId: z.string().optional().nullable(),
        qty: z.number().int().positive().optional(),
        unitId: z.string().optional(),
        packId: z.string().optional(),
        note: z.string().optional(),
        expiryDate: z.string().optional(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await Promise.all([
          assertUserCanAccessStore(ctx.prisma, ctx.user, input.fromStoreId),
          assertUserCanAccessStore(ctx.prisma, ctx.user, input.toStoreId),
        ]);
        return await transferStock({
          fromStoreId: input.fromStoreId,
          toStoreId: input.toStoreId,
          lines: input.lines?.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            qty: line.qty,
            unitId: line.unitId,
            packId: line.packId,
            expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
          })),
          productId: input.productId,
          variantId: input.variantId,
          qty: input.qty,
          unitId: input.unitId,
          packId: input.packId,
          note: input.note,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  recompute: adminProcedure
    .input(z.object({ storeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await recomputeInventorySnapshots({
          storeId: input.storeId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setMinStock: managerProcedure
    .input(
      z.object({
        storeId: z.string(),
        productId: z.string(),
        minStock: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await setMinStock({
          storeId: input.storeId,
          productId: input.productId,
          minStock: input.minStock,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setDefaultMinStock: managerProcedure
    .input(
      z.object({
        storeId: z.string(),
        minStock: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        return await setDefaultMinStock({
          storeId: input.storeId,
          minStock: input.minStock,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
