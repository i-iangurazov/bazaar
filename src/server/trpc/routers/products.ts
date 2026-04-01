import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { adminProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { lookupScanProducts } from "@/server/services/scanLookup";
import { normalizeScanValue } from "@/lib/scanning/normalize";
import {
  archiveProduct,
  bulkUpdateProductCategory,
  bulkGenerateProductDescriptions,
  bulkGenerateProductBarcodes,
  createProduct,
  duplicateProduct,
  generateProductBarcode,
  restoreProduct,
  suggestNextProductSku,
  type ImportUpdateField,
  updateProduct,
} from "@/server/services/products";
import { generateProductDescriptionFromImages } from "@/server/services/productDescriptions";
import { runProductImport } from "@/server/services/imports";
import { sanitizeSpreadsheetValue } from "@/server/services/csv";

const maxListImageUrlLength = 2_048;
const maxDetailImageUrlLength = 8_192;

const sanitizeListImageUrl = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  if (value.startsWith("data:image/")) {
    return null;
  }
  if (value.length > maxListImageUrlLength) {
    return null;
  }
  return value;
};

const sanitizeDetailImageUrl = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  if (value.startsWith("data:image/")) {
    return null;
  }
  if (value.length > maxDetailImageUrlLength) {
    return null;
  }
  return value;
};

const decimalToNumber = (value: Prisma.Decimal | null | undefined) =>
  value === null || value === undefined ? null : Number(value);

const buildProductCategoryWhere = (category?: string) =>
  category
    ? {
        OR: [{ category }, { categories: { has: category } }],
      }
    : {};

const importUpdateFieldEnum = z.enum([
  "name",
  "unit",
  "category",
  "description",
  "photoUrl",
  "barcodes",
  "basePriceKgs",
  "purchasePriceKgs",
  "avgCostKgs",
  "minStock",
]);

const barcodeGenerationModeEnum = z.enum(["EAN13", "CODE128"]);
const productSortKeyEnum = z.enum([
  "sku",
  "name",
  "category",
  "unit",
  "onHandQty",
  "salePrice",
  "avgCost",
  "barcodes",
  "stores",
]);
const productSortDirectionEnum = z.enum(["asc", "desc"]);

const inlineUpdatePatchSchema = z
  .object({
    name: z.string().min(2).optional(),
    baseUnitId: z.string().min(1).optional(),
    basePriceKgs: z.number().min(0).nullable().optional(),
    avgCostKgs: z.number().min(0).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalidInput",
      });
    }
  });

export const productsRouter = router({
  suggestSku: adminProcedure.query(async ({ ctx }) => {
    try {
      return await suggestNextProductSku(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  lookupScan: protectedProcedure
    .input(z.object({ q: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        return await lookupScanProducts(ctx.prisma, ctx.user.organizationId, input.q);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  findByBarcode: protectedProcedure
    .input(z.object({ value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const normalized = normalizeScanValue(input.value);
      if (!normalized) {
        return null;
      }

      const match = await ctx.prisma.productBarcode.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          value: normalized,
          product: { isDeleted: false },
        },
        select: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              isBundle: true,
              images: {
                select: { url: true },
                where: { url: { not: { startsWith: "data:image/" } } },
                orderBy: { position: "asc" },
                take: 1,
              },
            },
          },
        },
      });

      if (match?.product) {
        return {
          id: match.product.id,
          sku: match.product.sku,
          name: match.product.name,
          type: match.product.isBundle ? ("bundle" as const) : ("product" as const),
          primaryImage: match.product.images[0]?.url ?? null,
        };
      }

      const packMatch = await ctx.prisma.productPack.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          packBarcode: normalized,
          product: { isDeleted: false },
        },
        select: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              isBundle: true,
              images: {
                select: { url: true },
                where: { url: { not: { startsWith: "data:image/" } } },
                orderBy: { position: "asc" },
                take: 1,
              },
            },
          },
        },
      });

      if (packMatch?.product) {
        return {
          id: packMatch.product.id,
          sku: packMatch.product.sku,
          name: packMatch.product.name,
          type: packMatch.product.isBundle ? ("bundle" as const) : ("product" as const),
          primaryImage: packMatch.product.images[0]?.url ?? null,
        };
      }

      const skuMatch = await ctx.prisma.product.findFirst({
        where: {
          organizationId: ctx.user.organizationId,
          isDeleted: false,
          sku: { equals: normalized, mode: "insensitive" },
        },
        select: {
          id: true,
          sku: true,
          name: true,
          isBundle: true,
          images: {
            select: { url: true },
            where: { url: { not: { startsWith: "data:image/" } } },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
      });

      if (!skuMatch) {
        return null;
      }

      return {
        id: skuMatch.id,
        sku: skuMatch.sku,
        name: skuMatch.name,
        type: skuMatch.isBundle ? ("bundle" as const) : ("product" as const),
        primaryImage: skuMatch.images[0]?.url ?? null,
      };
    }),

  searchQuick: protectedProcedure
    .input(z.object({ q: z.string() }))
    .query(async ({ ctx, input }) => {
      const query = input.q.trim();
      const normalized = normalizeScanValue(input.q);
      const exactNeedle = normalized || query;
      if (!exactNeedle) {
        return [];
      }

      const fuzzyNeedle = query || exactNeedle;
      const barcodeNeedle = normalized || fuzzyNeedle;
      const fuzzyNeedleLower = fuzzyNeedle.toLowerCase();
      const barcodeNeedleLower = barcodeNeedle.toLowerCase();

      const [exactBarcodeMatches, exactSkuMatches, fuzzyMatches] = await Promise.all([
        ctx.prisma.productBarcode.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            value: exactNeedle,
            product: { isDeleted: false },
          },
          select: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                isBundle: true,
                images: {
                  select: { url: true },
                  where: { url: { not: { startsWith: "data:image/" } } },
                  orderBy: { position: "asc" },
                  take: 1,
                },
              },
            },
          },
          take: 10,
        }),
        ctx.prisma.product.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            isDeleted: false,
            sku: { equals: exactNeedle, mode: "insensitive" },
          },
          select: {
            id: true,
            sku: true,
            name: true,
            isBundle: true,
            images: {
              select: { url: true },
              where: { url: { not: { startsWith: "data:image/" } } },
              orderBy: { position: "asc" },
              take: 1,
            },
          },
          take: 10,
        }),
        ctx.prisma.product.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            isDeleted: false,
            OR: [
              { name: { contains: fuzzyNeedle, mode: "insensitive" } },
              { sku: { contains: fuzzyNeedle, mode: "insensitive" } },
              {
                barcodes: {
                  some: { value: { contains: barcodeNeedle, mode: "insensitive" } },
                },
              },
              {
                packs: {
                  some: { packBarcode: { contains: barcodeNeedle, mode: "insensitive" } },
                },
              },
            ],
          },
          select: {
            id: true,
            sku: true,
            name: true,
            isBundle: true,
            barcodes: {
              where: { value: { contains: barcodeNeedle, mode: "insensitive" } },
              select: { value: true },
              take: 1,
            },
            images: {
              select: { url: true },
              where: { url: { not: { startsWith: "data:image/" } } },
              orderBy: { position: "asc" },
              take: 1,
            },
          },
          orderBy: { name: "asc" },
          take: 10,
        }),
      ]);

      const items = new Map<
        string,
        {
          id: string;
          sku: string;
          name: string;
          isBundle: boolean;
          matchType: "barcode" | "sku" | "name";
          primaryImage: string | null;
        }
      >();

      exactBarcodeMatches.forEach((match) => {
        if (!match.product || items.has(match.product.id)) {
          return;
        }
        items.set(match.product.id, {
          id: match.product.id,
          sku: match.product.sku,
          name: match.product.name,
          isBundle: match.product.isBundle,
          matchType: "barcode",
          primaryImage: match.product.images[0]?.url ?? null,
        });
      });

      exactSkuMatches.forEach((product) => {
        if (items.has(product.id)) {
          return;
        }
        items.set(product.id, {
          id: product.id,
          sku: product.sku,
          name: product.name,
          isBundle: product.isBundle,
          matchType: "sku",
          primaryImage: product.images[0]?.url ?? null,
        });
      });

      fuzzyMatches.forEach((product) => {
        if (items.has(product.id)) {
          return;
        }
        const barcodeMatched = product.barcodes.some((barcode) =>
          barcode.value.toLowerCase().includes(barcodeNeedleLower),
        );
        const skuMatched = product.sku.toLowerCase().includes(fuzzyNeedleLower);
        items.set(product.id, {
          id: product.id,
          sku: product.sku,
          name: product.name,
          isBundle: product.isBundle,
          matchType: barcodeMatched ? "barcode" : skuMatched ? "sku" : "name",
          primaryImage: product.images[0]?.url ?? null,
        });
      });

      return Array.from(items.values())
        .slice(0, 10)
        .map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          type: product.isBundle ? ("bundle" as const) : ("product" as const),
          isBundle: product.isBundle,
          matchType: product.matchType,
          primaryImage: product.primaryImage,
        }));
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          category: z.string().optional(),
          type: z.enum(["all", "product", "bundle"]).optional(),
          includeArchived: z.boolean().optional(),
          storeId: z.string().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(200).optional(),
          sortKey: productSortKeyEnum.optional(),
          sortDirection: productSortDirectionEnum.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.storeId) {
        const store = await ctx.prisma.store.findUnique({ where: { id: input.storeId } });
        if (!store || store.organizationId !== ctx.user.organizationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
        }
      }

      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const sortKey = input?.sortKey ?? "name";
      const sortDirection = input?.sortDirection ?? "asc";
      const filters: Prisma.ProductWhereInput[] = [];
      if (input?.search) {
        filters.push({
          OR: [
            { name: { contains: input.search, mode: "insensitive" as const } },
            { sku: { contains: input.search, mode: "insensitive" as const } },
          ],
        });
      }
      if (input?.category) {
        filters.push(buildProductCategoryWhere(input.category));
      }
      if (input?.type === "product") {
        filters.push({ isBundle: false });
      } else if (input?.type === "bundle") {
        filters.push({ isBundle: true });
      }
      const where: Prisma.ProductWhereInput = {
        ...(input?.includeArchived ? {} : { isDeleted: false }),
        organizationId: ctx.user.organizationId,
        ...(filters.length ? { AND: filters } : {}),
      };

      const products = await ctx.prisma.product.findMany({
        where,
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          categories: true,
          unit: true,
          baseUnitId: true,
          isBundle: true,
          isDeleted: true,
          photoUrl: true,
          basePriceKgs: true,
          barcodes: { select: { value: true } },
          inventorySnapshots: { select: { storeId: true, onHand: true } },
          images: {
            where: {
              url: {
                not: { startsWith: "data:image/" },
              },
            },
            select: { id: true, url: true, position: true },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
        orderBy: [{ name: "asc" }, { sku: "asc" }],
      });
      const total = products.length;

      const items = await (async () => {
        const productIds = products.map((product) => product.id);
        const [baseCosts, latestPurchaseLines, stores] = productIds.length
          ? await Promise.all([
              ctx.prisma.productCost.findMany({
                where: {
                  organizationId: ctx.user.organizationId,
                  productId: { in: productIds },
                  variantKey: "BASE",
                },
                select: {
                  productId: true,
                  avgCostKgs: true,
                },
              }),
              ctx.prisma.purchaseOrderLine.findMany({
                where: {
                  productId: { in: productIds },
                  variantId: null,
                  unitCost: { not: null },
                  purchaseOrder: {
                    organizationId: ctx.user.organizationId,
                    status: {
                      in: ["PARTIALLY_RECEIVED", "RECEIVED"],
                    },
                  },
                },
                select: {
                  productId: true,
                  unitCost: true,
                },
                orderBy: [{ productId: "asc" }, { purchaseOrder: { receivedAt: "desc" } }],
                distinct: ["productId"],
              }),
              sortKey === "stores"
                ? ctx.prisma.store.findMany({
                    where: { organizationId: ctx.user.organizationId },
                    select: { id: true, name: true },
                  })
                : Promise.resolve([] as Array<{ id: string; name: string }>),
            ])
          : [[], [], []];

        const avgCostByProductId = new Map(
          baseCosts.map((cost) => [cost.productId, Number(cost.avgCostKgs)]),
        );
        const purchasePriceByProductId = new Map(
          latestPurchaseLines.map((line) => [line.productId, Number(line.unitCost)]),
        );
        const storeNameById = new Map(stores.map((store) => [store.id, store.name]));
        const resolveOnHandQty = (
          snapshots: Array<{ storeId: string; onHand: number }>,
          selectedStoreId?: string,
        ) =>
          snapshots.reduce((sum, snapshot) => {
            if (selectedStoreId && snapshot.storeId !== selectedStoreId) {
              return sum;
            }
            return sum + snapshot.onHand;
          }, 0);

        const baseItems =
          !input?.storeId || !products.length
            ? products.map((product) => ({
                ...product,
                images: product.images.flatMap((image) => {
                  const sanitized = sanitizeListImageUrl(image.url);
                  return sanitized ? [{ ...image, url: sanitized }] : [];
                }),
                photoUrl: sanitizeListImageUrl(product.photoUrl),
                basePriceKgs: decimalToNumber(product.basePriceKgs),
                effectivePriceKgs: decimalToNumber(product.basePriceKgs),
                purchasePriceKgs:
                  purchasePriceByProductId.get(product.id) ??
                  avgCostByProductId.get(product.id) ??
                  null,
                avgCostKgs: avgCostByProductId.get(product.id) ?? null,
                onHandQty: resolveOnHandQty(product.inventorySnapshots, input?.storeId),
                priceOverridden: false,
              }))
            : await (async () => {
                const storePrices = await ctx.prisma.storePrice.findMany({
                  where: {
                    organizationId: ctx.user.organizationId,
                    storeId: input.storeId,
                    productId: { in: products.map((product) => product.id) },
                    variantKey: "BASE",
                  },
                });
                const priceMap = new Map(storePrices.map((price) => [price.productId, price]));

                return products.map((product) => {
                  const basePrice = decimalToNumber(product.basePriceKgs);
                  const override = priceMap.get(product.id);
                  const effectivePrice = override ? decimalToNumber(override.priceKgs) : basePrice;
                  return {
                    ...product,
                    images: product.images.flatMap((image) => {
                      const sanitized = sanitizeListImageUrl(image.url);
                      return sanitized ? [{ ...image, url: sanitized }] : [];
                    }),
                    photoUrl: sanitizeListImageUrl(product.photoUrl),
                    basePriceKgs: basePrice,
                    effectivePriceKgs: effectivePrice,
                    purchasePriceKgs:
                      purchasePriceByProductId.get(product.id) ??
                      avgCostByProductId.get(product.id) ??
                      null,
                    avgCostKgs: avgCostByProductId.get(product.id) ?? null,
                    onHandQty: resolveOnHandQty(product.inventorySnapshots, input?.storeId),
                    priceOverridden: Boolean(override),
                  };
                });
              })();

        const sortCollator = new Intl.Collator(undefined, {
          numeric: true,
          sensitivity: "base",
        });
        const directionMultiplier = sortDirection === "asc" ? 1 : -1;
        const resolveSalePriceForSort = (product: (typeof baseItems)[number]) => {
          const value = input?.storeId ? product.effectivePriceKgs : product.basePriceKgs;
          return value ?? Number.NEGATIVE_INFINITY;
        };
        const resolveBarcodeSortValue = (product: (typeof baseItems)[number]) =>
          product.barcodes
            .map((entry) => entry.value.trim())
            .filter(Boolean)
            .sort((left, right) => sortCollator.compare(left, right))
            .join(", ");
        const resolveStoreSortValue = (product: (typeof baseItems)[number]) =>
          Array.from(
            new Set(
              product.inventorySnapshots
                .map((snapshot) => storeNameById.get(snapshot.storeId))
                .filter((name): name is string => Boolean(name)),
            ),
          )
            .sort((left, right) => sortCollator.compare(left, right))
            .join(", ");

        baseItems.sort((left, right) => {
          let result = 0;
          switch (sortKey) {
            case "sku":
              result = sortCollator.compare(left.sku, right.sku);
              break;
            case "name":
              result = sortCollator.compare(left.name, right.name);
              break;
            case "category":
              result = sortCollator.compare(left.category ?? "", right.category ?? "");
              break;
            case "unit":
              result = sortCollator.compare(left.unit ?? "", right.unit ?? "");
              break;
            case "onHandQty":
              result = left.onHandQty - right.onHandQty;
              break;
            case "salePrice":
              result = resolveSalePriceForSort(left) - resolveSalePriceForSort(right);
              break;
            case "avgCost":
              result =
                (left.avgCostKgs ?? Number.NEGATIVE_INFINITY) -
                (right.avgCostKgs ?? Number.NEGATIVE_INFINITY);
              break;
            case "barcodes":
              result = sortCollator.compare(
                resolveBarcodeSortValue(left),
                resolveBarcodeSortValue(right),
              );
              break;
            case "stores":
              result = sortCollator.compare(
                resolveStoreSortValue(left),
                resolveStoreSortValue(right),
              );
              break;
            default:
              result = 0;
          }

          if (result === 0) {
            result = sortCollator.compare(left.name, right.name);
          }
          if (result === 0) {
            result = sortCollator.compare(left.sku, right.sku);
          }
          if (result === 0) {
            result = left.id.localeCompare(right.id);
          }

          return result * directionMultiplier;
        });

        return baseItems.slice((page - 1) * pageSize, page * pageSize);
      })();

      return {
        items,
        total,
        page,
        pageSize,
      };
    }),

  listIds: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          category: z.string().optional(),
          type: z.enum(["all", "product", "bundle"]).optional(),
          includeArchived: z.boolean().optional(),
          storeId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.storeId) {
        const store = await ctx.prisma.store.findUnique({ where: { id: input.storeId } });
        if (!store || store.organizationId !== ctx.user.organizationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
        }
      }

      const filters: Prisma.ProductWhereInput[] = [];
      if (input?.search) {
        filters.push({
          OR: [
            { name: { contains: input.search, mode: "insensitive" as const } },
            { sku: { contains: input.search, mode: "insensitive" as const } },
          ],
        });
      }
      if (input?.category) {
        filters.push(buildProductCategoryWhere(input.category));
      }
      if (input?.type === "product") {
        filters.push({ isBundle: false });
      } else if (input?.type === "bundle") {
        filters.push({ isBundle: true });
      }
      const where: Prisma.ProductWhereInput = {
        ...(input?.includeArchived ? {} : { isDeleted: false }),
        organizationId: ctx.user.organizationId,
        ...(filters.length ? { AND: filters } : {}),
      };

      const rows = await ctx.prisma.product.findMany({
        where,
        select: { id: true },
        orderBy: { name: "asc" },
      });
      return rows.map((row) => row.id);
    }),

  byIds: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).max(10000) }))
    .query(async ({ ctx, input }) => {
      const ids = Array.from(new Set(input.ids.filter(Boolean)));
      if (!ids.length) {
        return [];
      }

      const products = await ctx.prisma.product.findMany({
        where: { id: { in: ids }, organizationId: ctx.user.organizationId },
        select: {
          id: true,
          sku: true,
          name: true,
          isDeleted: true,
          barcodes: { select: { value: true } },
        },
      });

      const productMap = new Map(products.map((product) => [product.id, product]));
      return ids.flatMap((id) => {
        const product = productMap.get(id);
        return product ? [product] : [];
      });
    }),

  getById: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      const product = await ctx.prisma.product.findFirst({
        where: { id: input.productId, organizationId: ctx.user.organizationId, isDeleted: false },
        include: {
          barcodes: true,
          variants: { where: { isActive: true } },
          packs: true,
          baseUnit: true,
          images: { orderBy: { position: "asc" } },
        },
      });
      if (!product) {
        return null;
      }
      const variantIds = product.variants.map((variant) => variant.id);
      const blockedVariantIds = new Set<string>();
      const [baseCost, latestPurchaseLine] = await Promise.all([
        ctx.prisma.productCost.findUnique({
          where: {
            organizationId_productId_variantKey: {
              organizationId: ctx.user.organizationId,
              productId: input.productId,
              variantKey: "BASE",
            },
          },
          select: { avgCostKgs: true },
        }),
        ctx.prisma.purchaseOrderLine.findFirst({
          where: {
            productId: input.productId,
            variantId: null,
            unitCost: { not: null },
            purchaseOrder: {
              organizationId: ctx.user.organizationId,
              status: { in: ["PARTIALLY_RECEIVED", "RECEIVED"] },
            },
          },
          select: { unitCost: true },
          orderBy: { purchaseOrder: { receivedAt: "desc" } },
        }),
      ]);
      if (variantIds.length) {
        const [movementVariants, snapshotVariants, lineVariants] = await Promise.all([
          ctx.prisma.stockMovement.findMany({
            where: { variantId: { in: variantIds } },
            select: { variantId: true },
            distinct: ["variantId"],
          }),
          ctx.prisma.inventorySnapshot.findMany({
            where: {
              variantId: { in: variantIds },
              OR: [{ onHand: { not: 0 } }, { onOrder: { not: 0 } }],
            },
            select: { variantId: true },
            distinct: ["variantId"],
          }),
          ctx.prisma.purchaseOrderLine.findMany({
            where: { variantId: { in: variantIds } },
            select: { variantId: true },
            distinct: ["variantId"],
          }),
        ]);
        [...movementVariants, ...snapshotVariants, ...lineVariants].forEach((entry) => {
          if (entry.variantId) {
            blockedVariantIds.add(entry.variantId);
          }
        });
      }
      const avgCostKgs = decimalToNumber(baseCost?.avgCostKgs);
      const images = product.images.flatMap((image) => {
        const sanitized = sanitizeDetailImageUrl(image.url);
        return sanitized ? [{ ...image, url: sanitized }] : [];
      });
      const photoUrl = sanitizeDetailImageUrl(product.photoUrl) ?? images[0]?.url ?? null;
      return {
        ...product,
        images,
        photoUrl,
        barcodes: product.barcodes.map((barcode) => barcode.value),
        variants: product.variants.map((variant) => ({
          ...variant,
          canDelete: !blockedVariantIds.has(variant.id),
        })),
        basePriceKgs: decimalToNumber(product.basePriceKgs),
        purchasePriceKgs:
          latestPurchaseLine?.unitCost !== null && latestPurchaseLine?.unitCost !== undefined
            ? Number(latestPurchaseLine.unitCost)
            : avgCostKgs,
        avgCostKgs,
      };
    }),

  pricing: protectedProcedure
    .input(z.object({ productId: z.string(), storeId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const product = await ctx.prisma.product.findUnique({ where: { id: input.productId } });
      if (!product || product.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
      }

      let storePrice = null as null | { priceKgs: Prisma.Decimal };
      if (input.storeId) {
        const store = await ctx.prisma.store.findUnique({ where: { id: input.storeId } });
        if (!store || store.organizationId !== ctx.user.organizationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
        }
        storePrice = await ctx.prisma.storePrice.findUnique({
          where: {
            organizationId_storeId_productId_variantKey: {
              organizationId: ctx.user.organizationId,
              storeId: input.storeId,
              productId: input.productId,
              variantKey: "BASE",
            },
          },
          select: { priceKgs: true },
        });
      }

      const cost = await ctx.prisma.productCost.findUnique({
        where: {
          organizationId_productId_variantKey: {
            organizationId: ctx.user.organizationId,
            productId: input.productId,
            variantKey: "BASE",
          },
        },
        select: { avgCostKgs: true },
      });

      const basePrice = decimalToNumber(product.basePriceKgs);
      const effectivePrice = storePrice ? decimalToNumber(storePrice.priceKgs) : basePrice;

      return {
        basePriceKgs: basePrice,
        effectivePriceKgs: effectivePrice,
        priceOverridden: Boolean(storePrice),
        avgCostKgs: decimalToNumber(cost?.avgCostKgs),
      };
    }),

  storePricing: protectedProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ ctx, input }) => {
      const product = await ctx.prisma.product.findUnique({
        where: { id: input.productId },
        select: {
          id: true,
          organizationId: true,
          basePriceKgs: true,
        },
      });
      if (!product || product.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
      }

      const [stores, overrides, cost, snapshots] = await Promise.all([
        ctx.prisma.store.findMany({
          where: { organizationId: ctx.user.organizationId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        ctx.prisma.storePrice.findMany({
          where: {
            organizationId: ctx.user.organizationId,
            productId: input.productId,
            variantKey: "BASE",
          },
          select: {
            storeId: true,
            priceKgs: true,
          },
        }),
        ctx.prisma.productCost.findUnique({
          where: {
            organizationId_productId_variantKey: {
              organizationId: ctx.user.organizationId,
              productId: input.productId,
              variantKey: "BASE",
            },
          },
          select: { avgCostKgs: true },
        }),
        ctx.prisma.inventorySnapshot.findMany({
          where: {
            productId: input.productId,
            variantId: null,
            store: {
              organizationId: ctx.user.organizationId,
            },
          },
          select: {
            storeId: true,
            onHand: true,
          },
        }),
      ]);

      const basePrice = decimalToNumber(product.basePriceKgs);
      const overrideByStore = new Map(
        overrides.map((override) => [override.storeId, Number(override.priceKgs)]),
      );
      const onHandByStore = new Map(
        snapshots.map((snapshot) => [snapshot.storeId, snapshot.onHand]),
      );

      return {
        basePriceKgs: basePrice,
        avgCostKgs: decimalToNumber(cost?.avgCostKgs),
        stores: stores.map((store) => {
          const override = overrideByStore.get(store.id);
          const effective = override ?? basePrice;
          return {
            storeId: store.id,
            storeName: store.name,
            effectivePriceKgs: effective,
            overridePriceKgs: override ?? null,
            priceOverridden: override !== undefined,
            onHand: onHandByStore.get(store.id) ?? 0,
          };
        }),
      };
    }),

  create: adminProcedure
    .input(
      z.object({
        sku: z.preprocess(
          (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
          z.string().min(2).optional(),
        ),
        name: z.string().min(2),
        category: z.string().optional(),
        categories: z.array(z.string()).optional(),
        baseUnitId: z.string().min(1),
        basePriceKgs: z.number().min(0).optional(),
        purchasePriceKgs: z.number().min(0).optional(),
        avgCostKgs: z.number().min(0).optional(),
        description: z.string().optional(),
        photoUrl: z.string().min(1).optional(),
        images: z
          .array(
            z.object({
              id: z.string().optional(),
              url: z.string().min(1),
              position: z.number().int().optional(),
            }),
          )
          .optional(),
        supplierId: z.string().optional(),
        barcodes: z.array(z.string()).optional(),
        isBundle: z.boolean().optional(),
        bundleComponents: z
          .array(
            z.object({
              componentProductId: z.string().min(1),
              componentVariantId: z.string().optional().nullable(),
              qty: z.number().int().positive(),
            }),
          )
          .optional(),
        packs: z
          .array(
            z.object({
              id: z.string().optional(),
              packName: z.string().min(1),
              packBarcode: z.string().optional().nullable(),
              multiplierToBase: z.number().int().positive(),
              allowInPurchasing: z.boolean().optional(),
              allowInReceiving: z.boolean().optional(),
            }),
          )
          .optional(),
        variants: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().optional(),
              sku: z.string().optional(),
              attributes: z.record(z.unknown()).optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createProduct({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          sku: input.sku,
          name: input.name,
          category: input.category,
          categories: input.categories,
          baseUnitId: input.baseUnitId,
          basePriceKgs: input.basePriceKgs,
          purchasePriceKgs: input.purchasePriceKgs,
          avgCostKgs: input.avgCostKgs,
          description: input.description,
          photoUrl: input.photoUrl,
          images: input.images,
          supplierId: input.supplierId,
          barcodes: input.barcodes,
          isBundle: input.isBundle,
          bundleComponents: input.bundleComponents,
          packs: input.packs,
          variants: input.variants,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  update: adminProcedure
    .input(
      z.object({
        productId: z.string(),
        sku: z.string().min(2),
        name: z.string().min(2),
        category: z.string().optional(),
        categories: z.array(z.string()).optional(),
        baseUnitId: z.string().min(1),
        basePriceKgs: z.number().min(0).optional(),
        purchasePriceKgs: z.number().min(0).optional(),
        avgCostKgs: z.number().min(0).optional(),
        description: z.string().optional(),
        photoUrl: z.string().min(1).optional(),
        images: z
          .array(
            z.object({
              id: z.string().optional(),
              url: z.string().min(1),
              position: z.number().int().optional(),
            }),
          )
          .optional(),
        supplierId: z.string().nullable().optional(),
        barcodes: z.array(z.string()).optional(),
        isBundle: z.boolean().optional(),
        bundleComponents: z
          .array(
            z.object({
              componentProductId: z.string().min(1),
              componentVariantId: z.string().optional().nullable(),
              qty: z.number().int().positive(),
            }),
          )
          .optional(),
        packs: z
          .array(
            z.object({
              id: z.string().optional(),
              packName: z.string().min(1),
              packBarcode: z.string().optional().nullable(),
              multiplierToBase: z.number().int().positive(),
              allowInPurchasing: z.boolean().optional(),
              allowInReceiving: z.boolean().optional(),
            }),
          )
          .optional(),
        variants: z
          .array(
            z.object({
              id: z.string().optional(),
              name: z.string().optional(),
              sku: z.string().optional(),
              attributes: z.record(z.unknown()).optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateProduct({
          productId: input.productId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          sku: input.sku,
          name: input.name,
          category: input.category,
          categories: input.categories,
          baseUnitId: input.baseUnitId,
          basePriceKgs: input.basePriceKgs,
          purchasePriceKgs: input.purchasePriceKgs,
          avgCostKgs: input.avgCostKgs,
          description: input.description,
          photoUrl: input.photoUrl,
          images: input.images,
          supplierId: input.supplierId ?? undefined,
          barcodes: input.barcodes,
          isBundle: input.isBundle,
          bundleComponents: input.bundleComponents,
          packs: input.packs,
          variants: input.variants,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  inlineUpdate: adminProcedure
    .input(
      z.object({
        productId: z.string().min(1),
        patch: inlineUpdatePatchSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const existing = await ctx.prisma.product.findUnique({
          where: { id: input.productId },
          select: {
            id: true,
            organizationId: true,
            sku: true,
            name: true,
            category: true,
            categories: true,
            baseUnitId: true,
            basePriceKgs: true,
            description: true,
            photoUrl: true,
            supplierId: true,
            barcodes: { select: { value: true } },
          },
        });
        if (!existing || existing.organizationId !== ctx.user.organizationId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "productNotFound" });
        }
        const existingCost = await ctx.prisma.productCost.findUnique({
          where: {
            organizationId_productId_variantKey: {
              organizationId: ctx.user.organizationId,
              productId: existing.id,
              variantKey: "BASE",
            },
          },
          select: { avgCostKgs: true },
        });

        return await updateProduct({
          productId: existing.id,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          sku: existing.sku,
          name: input.patch.name ?? existing.name,
          category: existing.category,
          categories: existing.categories,
          baseUnitId: input.patch.baseUnitId ?? existing.baseUnitId,
          basePriceKgs:
            input.patch.basePriceKgs !== undefined
              ? input.patch.basePriceKgs
              : decimalToNumber(existing.basePriceKgs),
          avgCostKgs:
            input.patch.avgCostKgs !== undefined
              ? input.patch.avgCostKgs
              : decimalToNumber(existingCost?.avgCostKgs),
          description: existing.description,
          photoUrl: existing.photoUrl,
          supplierId: existing.supplierId,
          barcodes: existing.barcodes.map((barcode) => barcode.value),
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  duplicate: adminProcedure
    .input(
      z.object({
        productId: z.string(),
        sku: z.string().min(2).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await duplicateProduct({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productId: input.productId,
          sku: input.sku,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  generateBarcode: adminProcedure
    .input(
      z.object({
        productId: z.string().min(1),
        mode: barcodeGenerationModeEnum,
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateProductBarcode({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productId: input.productId,
          mode: input.mode,
          force: input.force,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  generateDescription: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 6, prefix: "products-description-generate" }))
    .input(
      z.object({
        name: z.string().max(300).optional(),
        category: z.string().max(200).optional(),
        isBundle: z.boolean().optional(),
        locale: z.enum(["ru", "kg"]).optional(),
        imageUrls: z.array(z.string().min(1)).min(1).max(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateProductDescriptionFromImages({
          name: input.name,
          category: input.category,
          isBundle: input.isBundle,
          locale: input.locale,
          imageUrls: input.imageUrls,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkGenerateBarcodes: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 3, prefix: "products-barcodes-bulk" }))
    .input(
      z.object({
        mode: barcodeGenerationModeEnum,
        filter: z
          .object({
            productIds: z.array(z.string().min(1)).max(5000).optional(),
            search: z.string().optional(),
            category: z.string().optional(),
            type: z.enum(["all", "product", "bundle"]).optional(),
            includeArchived: z.boolean().optional(),
            storeId: z.string().optional(),
            limit: z.number().int().min(1).max(5000).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await bulkGenerateProductBarcodes({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          mode: input.mode,
          filter: input.filter,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkGenerateDescriptions: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 1, prefix: "products-descriptions-bulk" }))
    .input(
      z.object({
        productIds: z.array(z.string().min(1)).min(1).max(25),
        locale: z.enum(["ru", "kg"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await bulkGenerateProductDescriptions({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productIds: input.productIds,
          locale: input.locale,
          logger: ctx.logger,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkUpdateCategory: adminProcedure
    .input(
      z.object({
        productIds: z.array(z.string()).min(1),
        category: z.string().optional().nullable(),
        mode: z.enum(["add", "setPrimary", "replace"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await bulkUpdateProductCategory({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          productIds: input.productIds,
          category: input.category ?? null,
          mode: input.mode ?? "add",
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  importCsv: adminProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "products-import" }))
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              sku: z.string().min(2),
              name: z.string().min(2).optional(),
              category: z.string().optional(),
              unit: z.string().min(1).optional(),
              description: z.string().optional(),
              photoUrl: z.string().optional(),
              barcodes: z.array(z.string()).optional(),
              basePriceKgs: z.number().min(0).optional(),
              purchasePriceKgs: z.number().min(0).optional(),
              avgCostKgs: z.number().min(0).optional(),
              minStock: z.number().int().min(0).optional(),
            }),
          )
          .min(1),
        source: z.enum(["cloudshop", "onec", "csv"]).optional(),
        storeId: z.string().optional(),
        mode: z.enum(["full", "update_selected"]).optional(),
        updateMask: z.array(importUpdateFieldEnum).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.rows.length > 1000) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "importTooLarge" });
        }
        const mode = input.mode ?? "full";
        if (mode === "update_selected" && (!input.updateMask || input.updateMask.length === 0)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "invalidInput" });
        }
        if (mode === "full") {
          const invalidFullRows = input.rows.some((row) => !row.name || !row.unit);
          if (invalidFullRows) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "invalidInput" });
          }
        }
        if (
          input.rows.some((row) => row.minStock !== undefined) &&
          (mode === "full" || input.updateMask?.includes("minStock")) &&
          !input.storeId
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "storeRequired" });
        }
        const result = await runProductImport({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          rows: input.rows,
          source: input.source,
          storeId: input.storeId,
          mode,
          updateMask: input.updateMask as ImportUpdateField[] | undefined,
        });
        return {
          batchId: result.batch.id,
          results: result.results,
          summary: result.summary,
        };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  exportCsv: protectedProcedure.query(async ({ ctx }) => {
    const products = await ctx.prisma.product.findMany({
      where: { organizationId: ctx.user.organizationId, isDeleted: false },
      include: { barcodes: true },
      orderBy: { name: "asc" },
    });

    const header = ["sku", "name", "category", "unit", "description", "photoUrl", "barcodes"];
    const lines = products.map((product) => {
      const barcodes = product.barcodes.map((barcode) => barcode.value).join("|");
      const exportedCategory =
        product.categories.length > 0 ? product.categories.join("|") : (product.category ?? "");
      const values = [
        product.sku,
        product.name,
        exportedCategory,
        product.unit,
        product.description ?? "",
        product.photoUrl ?? "",
        barcodes,
      ];
      return values
        .map((value) => `"${sanitizeSpreadsheetValue(value).replace(/\"/g, '\"\"')}"`)
        .join(",");
    });

    return [header.join(","), ...lines].join("\n");
  }),

  archive: adminProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await archiveProduct({
          productId: input.productId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  restore: adminProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await restoreProduct({
          productId: input.productId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
