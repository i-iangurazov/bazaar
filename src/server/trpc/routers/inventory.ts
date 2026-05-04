import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { adminProcedure, managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { logProfileSection } from "@/server/profiling/perf";
import { toTRPCError } from "@/server/trpc/errors";
import {
  adjustStock,
  receiveStock,
  recomputeInventorySnapshots,
  transferStock,
} from "@/server/services/inventory";
import { buildReorderSuggestion } from "@/server/services/reorderSuggestions";
import { setDefaultMinStock, setMinStock } from "@/server/services/reorderPolicies";

const inventoryListInputSchema = z.object({
  storeId: z.string(),
  search: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(10).max(200).optional(),
});

const inventoryListIdsInputSchema = z.object({
  storeId: z.string(),
  search: z.string().optional(),
});

type PrismaClientLike = Pick<Prisma.TransactionClient, "store">;

const assertStoreAccess = async ({
  prisma,
  storeId,
  organizationId,
}: {
  prisma: PrismaClientLike;
  storeId: string;
  organizationId: string;
}) => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, organizationId: true },
  });
  if (!store || store.organizationId !== organizationId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
  }
};

const buildInventorySnapshotWhere = (input: z.infer<typeof inventoryListIdsInputSchema>) => ({
  storeId: input.storeId,
  product: {
    isDeleted: false,
    ...(input.search
      ? {
          OR: [
            { name: { contains: input.search, mode: "insensitive" as const } },
            { sku: { contains: input.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  },
});

export const inventoryRouter = router({
  list: protectedProcedure
    .input(inventoryListInputSchema)
    .query(async ({ ctx, input }) => {
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 25;
      const storeAccessStartedAt = Date.now();
      await assertStoreAccess({
        prisma: ctx.prisma,
        storeId: input.storeId,
        organizationId: ctx.user.organizationId,
      });
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
      const [total, snapshots] = await Promise.all([
        ctx.prisma.inventorySnapshot.count({ where }),
        ctx.prisma.inventorySnapshot.findMany({
          where,
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
            product: {
              select: {
                id: true,
                supplierId: true,
                sku: true,
                name: true,
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
                  orderBy: { position: "asc" },
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
          },
          orderBy: { product: { name: "asc" } },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
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
      const forecastMap = new Map(
        forecasts.map((forecast) => [forecast.productId, forecast]),
      );

      const items = snapshots.map((snapshot) => {
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

      return { items, total, page, pageSize };
    }),

  listIds: protectedProcedure
    .input(inventoryListIdsInputSchema)
    .query(async ({ ctx, input }) => {
      await assertStoreAccess({
        prisma: ctx.prisma,
        storeId: input.storeId,
        organizationId: ctx.user.organizationId,
      });

      const where = buildInventorySnapshotWhere(input);

      const rows = await ctx.prisma.inventorySnapshot.findMany({
        where,
        select: { id: true },
        orderBy: { product: { name: "asc" } },
      });
      return rows.map((row) => row.id);
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
      const store = await ctx.prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store || store.organizationId !== ctx.user.organizationId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "storeAccessDenied" });
      }

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

  adjust: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 30, prefix: "inventory-adjust" }))
    .input(
      z.object({
        storeId: z.string(),
        productId: z.string(),
        variantId: z.string().optional(),
        qtyDelta: z.number().int(),
        unitId: z.string().optional(),
        packId: z.string().optional(),
        reason: z.string().min(3),
        expiryDate: z.string().optional(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
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

  transfer: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "inventory-transfer" }))
    .input(
      z.object({
        fromStoreId: z.string(),
        toStoreId: z.string(),
        productId: z.string(),
        variantId: z.string().optional(),
        qty: z.number().int().positive(),
        unitId: z.string().optional(),
        packId: z.string().optional(),
        note: z.string().optional(),
        expiryDate: z.string().optional(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await transferStock({
          fromStoreId: input.fromStoreId,
          toStoreId: input.toStoreId,
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
