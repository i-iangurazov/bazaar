import { CustomerOrderStatus } from "@prisma/client";
import { z } from "zod";

import { managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  addCustomerOrderLine,
  cancelCustomerOrder,
  completeCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrderDraft,
  getSalesOrderMetrics,
  getCustomerOrder,
  listCustomerOrders,
  markCustomerOrderReady,
  removeCustomerOrderLine,
  setCustomerOrderCustomer,
  updateCustomerOrderLine,
} from "@/server/services/salesOrders";

const salesOrdersProtectedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "customerOrders" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const salesOrdersManagerProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "customerOrders" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

export const salesOrdersRouter = router({
  metrics: salesOrdersManagerProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        dateFrom: z.coerce.date(),
        dateTo: z.coerce.date(),
        groupBy: z.enum(["day", "week"]).default("day"),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getSalesOrderMetrics({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          groupBy: input.groupBy,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  list: salesOrdersProtectedProcedure
    .input(
      z
        .object({
          storeId: z.string().optional(),
          status: z.nativeEnum(CustomerOrderStatus).optional(),
          search: z.string().optional(),
          dateFrom: z.coerce.date().optional(),
          dateTo: z.coerce.date().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listCustomerOrders({
          organizationId: ctx.user.organizationId,
          storeId: input?.storeId,
          status: input?.status,
          search: input?.search?.trim() || undefined,
          dateFrom: input?.dateFrom,
          dateTo: input?.dateTo,
          page: input?.page ?? 1,
          pageSize: input?.pageSize ?? 25,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  getById: salesOrdersProtectedProcedure
    .input(z.object({ customerOrderId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getCustomerOrder({
          organizationId: ctx.user.organizationId,
          customerOrderId: input.customerOrderId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  createDraft: salesOrdersProtectedProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        customerName: z.string().max(160).optional().nullable(),
        customerPhone: z.string().max(64).optional().nullable(),
        notes: z.string().max(2_000).optional().nullable(),
        lines: z
          .array(
            z.object({
              productId: z.string().min(1),
              variantId: z.string().optional().nullable(),
              qty: z.number().int().positive(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createCustomerOrderDraft({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          notes: input.notes,
          lines: input.lines,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setCustomer: salesOrdersProtectedProcedure
    .input(
      z.object({
        customerOrderId: z.string(),
        customerName: z.string().max(160).optional().nullable(),
        customerPhone: z.string().max(64).optional().nullable(),
        notes: z.string().max(2_000).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await setCustomerOrderCustomer({
          organizationId: ctx.user.organizationId,
          customerOrderId: input.customerOrderId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          notes: input.notes,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  addLine: salesOrdersProtectedProcedure
    .input(
      z.object({
        customerOrderId: z.string(),
        productId: z.string(),
        variantId: z.string().optional().nullable(),
        qty: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await addCustomerOrderLine({
          organizationId: ctx.user.organizationId,
          customerOrderId: input.customerOrderId,
          productId: input.productId,
          variantId: input.variantId,
          qty: input.qty,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateLine: salesOrdersProtectedProcedure
    .input(
      z.object({
        lineId: z.string(),
        qty: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateCustomerOrderLine({
          organizationId: ctx.user.organizationId,
          lineId: input.lineId,
          qty: input.qty,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  removeLine: salesOrdersProtectedProcedure
    .input(z.object({ lineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await removeCustomerOrderLine({
          organizationId: ctx.user.organizationId,
          lineId: input.lineId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  confirm: salesOrdersProtectedProcedure
    .input(z.object({ customerOrderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmCustomerOrder({
          customerOrderId: input.customerOrderId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  markReady: salesOrdersProtectedProcedure
    .input(z.object({ customerOrderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await markCustomerOrderReady({
          customerOrderId: input.customerOrderId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  complete: salesOrdersManagerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "sales-orders-complete" }))
    .input(
      z.object({
        customerOrderId: z.string(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await completeCustomerOrder({
          customerOrderId: input.customerOrderId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  cancel: salesOrdersManagerProcedure
    .input(z.object({ customerOrderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await cancelCustomerOrder({
          customerOrderId: input.customerOrderId,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
