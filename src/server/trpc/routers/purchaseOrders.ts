import { z } from "zod";

import { managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  addPurchaseOrderLine,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  createDraftsFromReorder,
  receivePurchaseOrder,
  removePurchaseOrderLine,
  submitPurchaseOrder,
  updatePurchaseOrderLine,
} from "@/server/services/purchaseOrders";

export const purchaseOrdersRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          status: z
            .enum([
              "DRAFT",
              "SUBMITTED",
              "APPROVED",
              "PARTIALLY_RECEIVED",
              "RECEIVED",
              "CANCELLED",
            ])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const orders = await ctx.prisma.purchaseOrder.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          ...(input?.status ? { status: input.status } : {}),
        },
        include: {
          supplier: true,
          store: true,
          lines: { select: { qtyOrdered: true, unitCost: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return orders.map(({ lines, ...order }) => {
        const total = lines.reduce(
          (sum, line) => sum + (line.unitCost ? Number(line.unitCost) : 0) * line.qtyOrdered,
          0,
        );
        const hasCost = lines.some((line) => line.unitCost !== null);
        return { ...order, total, hasCost };
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const po = await ctx.prisma.purchaseOrder.findFirst({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          supplier: true,
          store: true,
          lines: {
            include: { product: { include: { baseUnit: true, packs: true } }, variant: true },
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
        supplierId: z.string().optional().nullable(),
        lines: z
          .array(
            z.object({
              productId: z.string(),
              variantId: z.string().optional(),
              qtyOrdered: z.number().int().positive(),
              unitCost: z.number().optional(),
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
        const po = await createPurchaseOrder({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          supplierId: input.supplierId ?? undefined,
          lines: input.lines,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          submit: input.submit,
        });
        return { id: po.id, status: po.status };
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
              qtyOrdered: z.number().int().positive(),
              supplierId: z.string().optional().nullable(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
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
              qtyReceived: z.number().int().positive(),
              unitId: z.string().optional().nullable(),
              packId: z.string().optional().nullable(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
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

  addLine: managerProcedure
    .input(
      z.object({
        purchaseOrderId: z.string(),
        productId: z.string(),
        variantId: z.string().optional().nullable(),
        qtyOrdered: z.number().int().positive(),
        unitCost: z.number().min(0).optional().nullable(),
        unitId: z.string().optional().nullable(),
        packId: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
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
        qtyOrdered: z.number().int().positive(),
        unitCost: z.number().min(0).optional().nullable(),
        unitId: z.string().optional().nullable(),
        packId: z.string().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
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
