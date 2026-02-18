import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { adminProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { lookupScanProducts } from "@/server/services/scanLookup";
import {
  archiveProduct,
  bulkUpdateProductCategory,
  bulkGenerateProductBarcodes,
  createProduct,
  duplicateProduct,
  generateProductBarcode,
  restoreProduct,
  type ImportUpdateField,
  updateProduct,
} from "@/server/services/products";
import { runProductImport } from "@/server/services/imports";

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

export const productsRouter = router({
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
      const normalized = input.value.trim();
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
              barcodes: { select: { value: true } },
            },
          },
        },
      });

      if (match?.product) {
        return {
          id: match.product.id,
          sku: match.product.sku,
          name: match.product.name,
          barcodes: match.product.barcodes.map((barcode) => barcode.value),
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
              barcodes: { select: { value: true } },
            },
          },
        },
      });

      if (!packMatch?.product) {
        return null;
      }

      return {
        id: packMatch.product.id,
        sku: packMatch.product.sku,
        name: packMatch.product.name,
        barcodes: packMatch.product.barcodes.map((barcode) => barcode.value),
      };
    }),

  searchQuick: protectedProcedure
    .input(z.object({ q: z.string() }))
    .query(async ({ ctx, input }) => {
      const query = input.q.trim();
      if (!query) {
        return [];
      }

      const products = await ctx.prisma.product.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          isDeleted: false,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { sku: { contains: query, mode: "insensitive" } },
            {
              barcodes: {
                some: { value: { contains: query, mode: "insensitive" } },
              },
            },
            {
              packs: {
                some: { packBarcode: { contains: query, mode: "insensitive" } },
              },
            },
          ],
        },
        select: {
          id: true,
          sku: true,
          name: true,
          isBundle: true,
          barcodes: { select: { value: true } },
        },
        orderBy: { name: "asc" },
        take: 10,
      });

      return products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        isBundle: product.isBundle,
        barcodes: product.barcodes.map((barcode) => barcode.value),
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
      const where = {
        ...(input?.includeArchived ? {} : { isDeleted: false }),
        ...(input?.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" as const } },
                { sku: { contains: input.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(input?.category ? { category: input.category } : {}),
        ...(input?.type === "product"
          ? { isBundle: false }
          : input?.type === "bundle"
            ? { isBundle: true }
            : {}),
        organizationId: ctx.user.organizationId,
      };

      const [total, products] = await Promise.all([
        ctx.prisma.product.count({ where }),
        ctx.prisma.product.findMany({
          where,
          select: {
            id: true,
            sku: true,
            name: true,
            category: true,
            unit: true,
            isBundle: true,
            isDeleted: true,
            photoUrl: true,
            basePriceKgs: true,
            barcodes: { select: { value: true } },
            inventorySnapshots: { select: { storeId: true } },
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
          orderBy: { name: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      const items = await (async () => {
        const productIds = products.map((product) => product.id);
        const [baseCosts, latestPurchaseLines] = productIds.length
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
            ])
          : [[], []];

        const avgCostByProductId = new Map(
          baseCosts.map((cost) => [cost.productId, Number(cost.avgCostKgs)]),
        );
        const purchasePriceByProductId = new Map(
          latestPurchaseLines.map((line) => [line.productId, Number(line.unitCost)]),
        );

        if (!input?.storeId || !products.length) {
          return products.map((product) => ({
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
            priceOverridden: false,
          }));
        }

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
            priceOverridden: Boolean(override),
          };
        });
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

      const where = {
        ...(input?.includeArchived ? {} : { isDeleted: false }),
        ...(input?.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" as const } },
                { sku: { contains: input.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(input?.category ? { category: input.category } : {}),
        ...(input?.type === "product"
          ? { isBundle: false }
          : input?.type === "bundle"
            ? { isBundle: true }
            : {}),
        organizationId: ctx.user.organizationId,
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
      const photoUrl =
        sanitizeDetailImageUrl(product.photoUrl) ??
        images[0]?.url ??
        null;
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

      const [stores, overrides, cost] = await Promise.all([
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
      ]);

      const basePrice = decimalToNumber(product.basePriceKgs);
      const overrideByStore = new Map(
        overrides.map((override) => [override.storeId, Number(override.priceKgs)]),
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
          };
        }),
      };
    }),

  create: adminProcedure
    .input(
      z.object({
        sku: z.string().min(2),
        name: z.string().min(2),
        category: z.string().optional(),
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

  bulkUpdateCategory: adminProcedure
    .input(
      z.object({
        productIds: z.array(z.string()).min(1),
        category: z.string().optional().nullable(),
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

    const header = [
      "sku",
      "name",
      "category",
      "unit",
      "description",
      "photoUrl",
      "barcodes",
    ];
    const lines = products.map((product) => {
      const barcodes = product.barcodes.map((barcode) => barcode.value).join("|");
      const values = [
        product.sku,
        product.name,
        product.category ?? "",
        product.unit,
        product.description ?? "",
        product.photoUrl ?? "",
        barcodes,
      ];
      return values.map((value) => `"${String(value).replace(/\"/g, '\"\"')}"`).join(",");
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
