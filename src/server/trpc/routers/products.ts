import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { adminProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  archiveProduct,
  bulkUpdateProductCategory,
  createProduct,
  restoreProduct,
  updateProduct,
} from "@/server/services/products";
import { runProductImport } from "@/server/services/imports";

export const productsRouter = router({
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
          barcodes: { select: { value: true } },
        },
        orderBy: { name: "asc" },
        take: 10,
      });

      return products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        barcodes: product.barcodes.map((barcode) => barcode.value),
      }));
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          category: z.string().optional(),
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

      return ctx.prisma.product.findMany({
        where: {
          ...(input?.includeArchived ? {} : { isDeleted: false }),
          ...(input?.search
            ? {
                OR: [
                  { name: { contains: input.search, mode: "insensitive" } },
                  { sku: { contains: input.search, mode: "insensitive" } },
                ],
              }
            : {}),
          ...(input?.category ? { category: input.category } : {}),
          organizationId: ctx.user.organizationId,
        },
        include: {
          barcodes: { select: { value: true } },
          inventorySnapshots: { select: { storeId: true } },
        },
        orderBy: { name: "asc" },
      }).then(async (products) => {
        if (!input?.storeId || !products.length) {
          return products.map((product) => ({
            ...product,
            basePriceKgs: product.basePriceKgs ? Number(product.basePriceKgs) : null,
            effectivePriceKgs: product.basePriceKgs ? Number(product.basePriceKgs) : null,
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
          const basePrice = product.basePriceKgs ? Number(product.basePriceKgs) : null;
          const override = priceMap.get(product.id);
          const effectivePrice = override ? Number(override.priceKgs) : basePrice;
          return {
            ...product,
            basePriceKgs: basePrice,
            effectivePriceKgs: effectivePrice,
            priceOverridden: Boolean(override),
          };
        });
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
      return {
        ...product,
        barcodes: product.barcodes.map((barcode) => barcode.value),
        variants: product.variants.map((variant) => ({
          ...variant,
          canDelete: !blockedVariantIds.has(variant.id),
        })),
        basePriceKgs: product.basePriceKgs ? Number(product.basePriceKgs) : null,
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

      const basePrice = product.basePriceKgs ? Number(product.basePriceKgs) : null;
      const effectivePrice = storePrice ? Number(storePrice.priceKgs) : basePrice;

      return {
        basePriceKgs: basePrice,
        effectivePriceKgs: effectivePrice,
        priceOverridden: Boolean(storePrice),
        avgCostKgs: cost?.avgCostKgs ? Number(cost.avgCostKgs) : null,
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
        description: z.string().optional(),
        photoUrl: z.string().url().optional(),
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
          description: input.description,
          photoUrl: input.photoUrl,
          images: input.images,
          supplierId: input.supplierId,
          barcodes: input.barcodes,
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
        description: z.string().optional(),
        photoUrl: z.string().url().optional(),
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
          description: input.description,
          photoUrl: input.photoUrl,
          images: input.images,
          supplierId: input.supplierId ?? undefined,
          barcodes: input.barcodes,
          packs: input.packs,
          variants: input.variants,
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
              name: z.string().min(2),
              category: z.string().optional(),
              unit: z.string().min(1),
              description: z.string().optional(),
              photoUrl: z.string().optional(),
              barcodes: z.array(z.string()).optional(),
            }),
          )
          .min(1),
        source: z.enum(["cloudshop", "onec", "csv"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.rows.length > 1000) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "importTooLarge" });
        }
        const result = await runProductImport({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          rows: input.rows,
          source: input.source,
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
