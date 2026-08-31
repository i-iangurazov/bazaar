import { Prisma, PurchaseOrderStatus } from "@prisma/client";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

import {
  PURCHASE_ORDER_MAX_QUANTITY,
  PURCHASE_ORDER_MAX_UNIT_COST,
} from "@/lib/purchaseOrderMoney";
import { managerProcedure, rateLimit, router } from "@/server/trpc/trpc";
import {
  assertCommerceStoreAccess,
  resolveCommerceAccessibleStoreIds,
} from "@/server/services/commerceAccess";
import { AppError } from "@/server/services/errors";
import type { StoreAccessUser } from "@/server/services/storeAccess";
import { toTRPCError } from "@/server/trpc/errors";
import {
  addPurchaseOrderLine,
  approvePurchaseOrder,
  bulkCancelPurchaseOrders,
  cancelPurchaseOrder,
  createPurchaseOrderOperation,
  createDraftsFromReorder,
  receivePurchaseOrder,
  removePurchaseOrderLine,
  submitPurchaseOrder,
  updatePurchaseOrderLine,
} from "@/server/services/purchaseOrders";

type PurchaseOrderAccessContext = {
  prisma: PrismaClient;
  user: StoreAccessUser;
};

const assertPurchaseOrderAccess = async (
  ctx: PurchaseOrderAccessContext,
  purchaseOrderId: string,
) => {
  const purchaseOrder = await ctx.prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, organizationId: ctx.user.organizationId },
    select: { storeId: true },
  });
  if (!purchaseOrder) {
    throw new AppError("poNotFound", "NOT_FOUND", 404);
  }
  await assertCommerceStoreAccess(ctx.prisma, ctx.user, purchaseOrder.storeId);
};

const assertPurchaseOrderLineAccess = async (ctx: PurchaseOrderAccessContext, lineId: string) => {
  const line = await ctx.prisma.purchaseOrderLine.findFirst({
    where: {
      id: lineId,
      purchaseOrder: { organizationId: ctx.user.organizationId },
    },
    select: { purchaseOrder: { select: { storeId: true } } },
  });
  if (!line) {
    throw new AppError("poLineNotFound", "NOT_FOUND", 404);
  }
  await assertCommerceStoreAccess(ctx.prisma, ctx.user, line.purchaseOrder.storeId);
};

const purchaseOrderListFiltersSchema = z.object({
  storeId: z.string().min(1).optional(),
  status: z.nativeEnum(PurchaseOrderStatus).optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(["createdAt", "status", "supplier", "store"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
});

const buildPurchaseOrderListWhere = (input: {
  organizationId: string;
  accessibleStoreIds: string[] | null;
  storeId?: string;
  status?: PurchaseOrderStatus;
  search?: string;
}): Prisma.PurchaseOrderWhereInput => ({
  organizationId: input.organizationId,
  ...(input.storeId
    ? { storeId: input.storeId }
    : input.accessibleStoreIds
      ? { storeId: { in: input.accessibleStoreIds } }
      : {}),
  ...(input.status ? { status: input.status } : {}),
  ...(input.search
    ? {
        OR: [
          { id: { contains: input.search, mode: "insensitive" } },
          { supplier: { is: { name: { contains: input.search, mode: "insensitive" } } } },
          { store: { name: { contains: input.search, mode: "insensitive" } } },
        ],
      }
    : {}),
});

const buildPurchaseOrderListOrderBy = (
  sortBy: "createdAt" | "status" | "supplier" | "store" = "createdAt",
  sortDirection: "asc" | "desc" = "desc",
): Prisma.PurchaseOrderOrderByWithRelationInput[] => [
  sortBy === "status"
    ? { status: sortDirection }
    : sortBy === "supplier"
      ? { supplier: { name: sortDirection } }
      : sortBy === "store"
        ? { store: { name: sortDirection } }
        : { createdAt: sortDirection },
  { id: sortDirection },
];

export const purchaseOrdersRouter = router({
  list: managerProcedure
    .input(
      purchaseOrderListFiltersSchema
        .extend({
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      if (input?.storeId) {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
      }
      const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
      const where = buildPurchaseOrderListWhere({
        organizationId: ctx.user.organizationId,
        accessibleStoreIds,
        storeId: input?.storeId,
        status: input?.status,
        search: input?.search,
      });

      const [total, orders] = await Promise.all([
        ctx.prisma.purchaseOrder.count({ where }),
        ctx.prisma.purchaseOrder.findMany({
          where,
          include: {
            supplier: true,
            store: true,
          },
          orderBy: buildPurchaseOrderListOrderBy(input?.sortBy, input?.sortDirection),
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      const orderIds = orders.map((order) => order.id);
      const totalsByOrderId =
        orderIds.length > 0
          ? await ctx.prisma.$queryRaw<
              Array<{ purchaseOrderId: string; total: Prisma.Decimal | null; hasCost: boolean }>
            >(
              Prisma.sql`
                SELECT
                  "purchaseOrderId",
                  COALESCE(SUM(COALESCE("unitCost", 0) * "qtyOrdered"), 0)::numeric AS total,
                  BOOL_OR("unitCost" IS NOT NULL) AS "hasCost"
                FROM "PurchaseOrderLine"
                WHERE "purchaseOrderId" IN (${Prisma.join(orderIds)})
                GROUP BY "purchaseOrderId"
              `,
            )
          : [];

      const totalsMap = new Map(
        totalsByOrderId.map((entry) => [
          entry.purchaseOrderId,
          { total: entry.total ? Number(entry.total) : 0, hasCost: Boolean(entry.hasCost) },
        ]),
      );

      const items = orders.map((order) => {
        const summary = totalsMap.get(order.id) ?? { total: 0, hasCost: false };
        return { ...order, total: summary.total, hasCost: summary.hasCost };
      });
      return {
        items,
        total,
        page,
        pageSize,
      };
    }),

  listIds: managerProcedure
    .input(purchaseOrderListFiltersSchema.optional())
    .query(async ({ ctx, input }) => {
      if (input?.storeId) {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
      }
      const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
      const where = buildPurchaseOrderListWhere({
        organizationId: ctx.user.organizationId,
        accessibleStoreIds,
        storeId: input?.storeId,
        status: input?.status,
        search: input?.search,
      });
      const rows = await ctx.prisma.purchaseOrder.findMany({
        where,
        select: { id: true },
        orderBy: buildPurchaseOrderListOrderBy(input?.sortBy, input?.sortDirection),
      });
      return rows.map((row) => row.id);
    }),

  getById: managerProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const accessibleStoreIds = await resolveCommerceAccessibleStoreIds(ctx.prisma, ctx.user);
    const po = await ctx.prisma.purchaseOrder.findFirst({
      where: {
        id: input.id,
        organizationId: ctx.user.organizationId,
        ...(accessibleStoreIds ? { storeId: { in: accessibleStoreIds } } : {}),
      },
      include: {
        supplier: true,
        store: true,
        lines: {
          include: { product: { include: { baseUnit: true, packs: true } }, variant: true },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!po) {
      return null;
    }

    return {
      ...po,
      lines: po.lines.map((line) => ({
        ...line,
        unitCost: line.unitCost ? Number(line.unitCost) : null,
      })),
    };
  }),

  create: managerProcedure
    .input(
      z.object({
        storeId: z.string(),
        idempotencyKey: z.string().min(8),
        supplierId: z.string().optional().nullable(),
        lines: z
          .array(
            z.object({
              productId: z.string(),
              variantId: z.string().optional(),
              qtyOrdered: z.number().int().positive().max(PURCHASE_ORDER_MAX_QUANTITY),
              unitCost: z.number().min(0).max(PURCHASE_ORDER_MAX_UNIT_COST).optional(),
              unitId: z.string().optional().nullable(),
              packId: z.string().optional().nullable(),
            }),
          )
          .min(1),
        submit: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        const operation = await createPurchaseOrderOperation({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          idempotencyKey: input.idempotencyKey,
          supplierId: input.supplierId ?? undefined,
          lines: input.lines,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          submit: input.submit,
        });
        return operation.response.purchaseOrder;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  createFromReorder: managerProcedure
    .use(rateLimit({ windowMs: 60_000, max: 5, prefix: "po-from-reorder" }))
    .input(
      z.object({
        storeId: z.string(),
        idempotencyKey: z.string().min(8),
        items: z
          .array(
            z.object({
              productId: z.string(),
              variantId: z.string().optional().nullable(),
              qtyOrdered: z.number().int().positive().max(PURCHASE_ORDER_MAX_QUANTITY),
              supplierId: z.string().optional().nullable(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCommerceStoreAccess(ctx.prisma, ctx.user, input.storeId);
        return await createDraftsFromReorder({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
          items: input.items,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  submit: managerProcedure
    .input(z.object({ purchaseOrderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertPurchaseOrderAccess(ctx, input.purchaseOrderId);
        return await submitPurchaseOrder({
          purchaseOrderId: input.purchaseOrderId,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  approve: managerProcedure
    .input(z.object({ purchaseOrderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertPurchaseOrderAccess(ctx, input.purchaseOrderId);
        return await approvePurchaseOrder({
          purchaseOrderId: input.purchaseOrderId,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  receive: managerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "po-receive" }))
    .input(
      z.object({
        purchaseOrderId: z.string(),
        idempotencyKey: z.string().min(8),
        allowOverReceive: z.boolean().optional(),
        lines: z
          .array(
            z.object({
              lineId: z.string(),
              qtyReceived: z.number().int().positive().max(PURCHASE_ORDER_MAX_QUANTITY),
              unitId: z.string().optional().nullable(),
              packId: z.string().optional().nullable(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertPurchaseOrderAccess(ctx, input.purchaseOrderId);
        return await receivePurchaseOrder({
          purchaseOrderId: input.purchaseOrderId,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
          lines: input.lines,
          allowOverReceive: input.allowOverReceive,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  cancel: managerProcedure
    .input(z.object({ purchaseOrderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertPurchaseOrderAccess(ctx, input.purchaseOrderId);
        return await cancelPurchaseOrder({
          purchaseOrderId: input.purchaseOrderId,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  bulkCancel: managerProcedure
    .input(
      z.object({
        purchaseOrderIds: z.array(z.string().min(1)).min(1).max(5_000),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const operation = await bulkCancelPurchaseOrders({
          purchaseOrderIds: input.purchaseOrderIds,
          idempotencyKey: input.idempotencyKey,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
        return operation.response;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  addLine: managerProcedure
    .input(
      z.object({
        purchaseOrderId: z.string(),
        productId: z.string(),
        variantId: z.string().optional().nullable(),
        qtyOrdered: z.number().int().positive().max(PURCHASE_ORDER_MAX_QUANTITY),
        unitCost: z.number().min(0).max(PURCHASE_ORDER_MAX_UNIT_COST).optional().nullable(),
        unitId: z.string().optional().nullable(),
        packId: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertPurchaseOrderAccess(ctx, input.purchaseOrderId);
        return await addPurchaseOrderLine({
          purchaseOrderId: input.purchaseOrderId,
          productId: input.productId,
          variantId: input.variantId,
          qtyOrdered: input.qtyOrdered,
          unitCost: input.unitCost ?? undefined,
          unitId: input.unitId ?? undefined,
          packId: input.packId ?? undefined,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateLine: managerProcedure
    .input(
      z.object({
        lineId: z.string(),
        qtyOrdered: z.number().int().positive().max(PURCHASE_ORDER_MAX_QUANTITY),
        unitCost: z.number().min(0).max(PURCHASE_ORDER_MAX_UNIT_COST).optional().nullable(),
        unitId: z.string().optional().nullable(),
        packId: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertPurchaseOrderLineAccess(ctx, input.lineId);
        return await updatePurchaseOrderLine({
          lineId: input.lineId,
          qtyOrdered: input.qtyOrdered,
          unitCost: input.unitCost ?? undefined,
          unitId: input.unitId ?? undefined,
          packId: input.packId ?? undefined,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  removeLine: managerProcedure
    .input(z.object({ lineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertPurchaseOrderLineAccess(ctx, input.lineId);
        return await removePurchaseOrderLine({
          lineId: input.lineId,
          actorId: ctx.user.id,
          organizationId: ctx.user.organizationId,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
