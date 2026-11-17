import { getOrderPaymentInfo, recordOrderPayment } from "@/server/services/salesOrderPayments";
import {
  correctCompletedCustomerOrder,
  quoteSalesOrderCorrection,
  resolveCorrectionRefundRequest,
} from "@/server/services/salesOrderCorrections";
import { CustomerOrderEmailType, CustomerOrderStatus, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import { cashierProcedure, managerProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { AppError } from "@/server/services/errors";
import { salesOrderLifecycleViews } from "@/lib/salesOrderLifecycle";
import { zonedDayEnd, zonedDayStart } from "@/lib/timezone";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  assertUserCanAccessStore,
  resolveAccessibleStoreIds,
  userHasAllStoreAccess,
  type StoreAccessUser,
} from "@/server/services/storeAccess";
import {
  addCustomerOrderLine,
  cancelCustomerOrder,
  completeCustomerOrder,
  confirmCustomerOrder,
  createCustomerOrderDraftOperation,
  createCustomerSaleOperation,
  getSalesOrderMetrics,
  getCustomerOrder,
  getCustomerOrderLinePrice,
  listCustomerOrders,
  listCustomerOrderCustomerOptions,
  listSalesOrderEmployeeOptions,
  setCustomerOrderArchived,
  markCustomerOrderReady,
  removeCustomerOrderLine,
  removeDeclinedCustomerOrderLine,
  postCustomerSale,
  quoteCustomerOrderPriceMode,
  sendCustomerOrderEmail,
  setCustomerOrderCustomer,
  updateCustomerOrder,
  updateCustomerOrderTracking,
  updateCustomerOrderLine,
} from "@/server/services/salesOrders";

const optionalEmailSchema = z.string().trim().email().max(254).optional().nullable();
const optionalTrackingTextSchema = z.string().trim().max(512).optional().nullable();
const optionalUnitPriceSchema = z.number().finite().min(0).max(9_999_999_999.99).optional();
const orderPriceModeSchema = z.enum(["RETAIL", "WHOLESALE"]);
const createOrderInputSchema = z.object({
  storeId: z.string().min(1),
  idempotencyKey: z.string().min(8),
  priceMode: orderPriceModeSchema.optional(),
  customerId: z.string().min(1).optional().nullable(),
  customerName: z.string().max(180).optional().nullable(),
  customerEmail: optionalEmailSchema,
  // Saved contacts can be legacy values; the service validates their identity.
  customerPhone: z.string().max(64).optional().nullable(),
  customerAddress: z.string().max(512).optional().nullable(),
  notes: z.string().max(2_000).optional().nullable(),
  lines: z.array(z.object({
    productId: z.string().min(1),
    variantId: z.string().optional().nullable(),
    qty: z.number().multipleOf(0.001).positive(),
    unitPriceKgs: optionalUnitPriceSchema,
  })).optional(),
});

const updateOrderInputSchema = z.object({
  customerOrderId: z.string().min(1),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  storeId: z.string().min(1),
  idempotencyKey: z.string().min(8),
  priceMode: orderPriceModeSchema.optional(),
  customerId: z.string().min(1).optional().nullable(),
  customerName: z.string().max(180).optional().nullable(),
  customerEmail: optionalEmailSchema,
  customerPhone: z.string().max(64).optional().nullable(),
  customerAddress: z.string().max(512).optional().nullable(),
  notes: z.string().max(2_000).optional().nullable(),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1).optional().nullable(),
        productId: z.string().min(1),
        variantId: z.string().optional().nullable(),
        qty: z.number().multipleOf(0.001).positive(),
        unitPriceKgs: optionalUnitPriceSchema,
        priceSource: z.enum(["RETAIL", "WHOLESALE", "MANUAL"]).optional(),
      }),
    )
    .max(500),
});

const salesOrdersProtectedProcedure = protectedProcedure.use(async ({ ctx, next }) => {  try {
    await assertFeatureEnabled({
      organizationId: ctx.user.organizationId,
      feature: "customerOrders",
    });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const salesOrdersManagerProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({
      organizationId: ctx.user.organizationId,
      feature: "customerOrders",
    });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

type SalesOrdersContext = {
  prisma: PrismaClient;
  user: StoreAccessUser;
};

const resolveSalesOrderStoreScope = async (ctx: SalesOrdersContext, requestedStoreId?: string) => {
  if (requestedStoreId) {
    await assertUserCanAccessStore(ctx.prisma, ctx.user, requestedStoreId);
    return { storeId: requestedStoreId };
  }

  if (userHasAllStoreAccess(ctx.user)) {
    return {};
  }

  return { storeIds: await resolveAccessibleStoreIds(ctx.prisma, ctx.user) };
};

const assertCustomerOrderStoreAccess = async (ctx: SalesOrdersContext, customerOrderId: string) => {
  const order = await ctx.prisma.customerOrder.findFirst({
    where: {
      id: customerOrderId,
      organizationId: ctx.user.organizationId,
      isPosSale: false,
    },
    select: { storeId: true },
  });
  if (!order) {
    throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(ctx.prisma, ctx.user, order.storeId);
};

const assertCustomerOrderLineStoreAccess = async (ctx: SalesOrdersContext, lineId: string) => {
  const line = await ctx.prisma.customerOrderLine.findFirst({
    where: {
      id: lineId,
      customerOrder: {
        organizationId: ctx.user.organizationId,
        isPosSale: false,
      },
    },
    select: { customerOrder: { select: { storeId: true } } },
  });
  if (!line) {
    throw new AppError("salesOrderNotFound", "NOT_FOUND", 404);
  }
  await assertUserCanAccessStore(ctx.prisma, ctx.user, line.customerOrder.storeId);
};

export const salesOrdersRouter = router({
  linePrice: salesOrdersProtectedProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        productId: z.string().min(1),
        variantId: z.string().min(1).optional().nullable(),
        priceMode: orderPriceModeSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getCustomerOrderLinePrice({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  customerOptions: salesOrdersProtectedProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(30).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listCustomerOrderCustomerOptions({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  employeeOptions: salesOrdersProtectedProcedure
    .input(z.object({ storeId: z.string().min(1).nullable().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const storeScope = await resolveSalesOrderStoreScope(ctx, input?.storeId ?? undefined);
        return await listSalesOrderEmployeeOptions({
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          ...storeScope,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  setArchived: salesOrdersManagerProcedure
    .input(z.object({ customerOrderId: z.string().min(1), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
        return await setCustomerOrderArchived({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),


  paymentInfo: salesOrdersProtectedProcedure.input(z.object({ customerOrderId: z.string() })).query(async ({ ctx, input }) => {
    try { return await getOrderPaymentInfo(ctx.user, input.customerOrderId); } catch (error) { throw toTRPCError(error); }
  }),
  recordPayment: cashierProcedure.input(z.object({ customerOrderId: z.string(), shiftId: z.string(), amountKgs: z.number().positive(), method: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]), idempotencyKey: z.string().min(8) })).mutation(async ({ctx,input}) => {
    try { await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "customerOrders" }); return await recordOrderPayment({ ...input, user: ctx.user, requestId: ctx.requestId }); } catch (error) { throw toTRPCError(error); }
  }),
  correctionQuote: salesOrdersManagerProcedure
    .input(
      z.object({
        originalOrderId: z.string().min(1),
        priceMode: orderPriceModeSchema.optional(),
        returns: z
          .array(
            z.object({
              lineId: z.string().min(1),
              qty: z.number().multipleOf(0.001).positive(),
              restock: z.boolean().default(true),
            }),
          )
          .max(500)
          .default([]),
        additions: z
          .array(
            z.object({
              productId: z.string().min(1),
              variantId: z.string().optional().nullable(),
              qty: z.number().multipleOf(0.001).positive(),
              unitPriceKgs: optionalUnitPriceSchema,
            }),
          )
          .max(500)
          .default([]),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await quoteSalesOrderCorrection({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  correct: salesOrdersManagerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 10, prefix: "sales-orders-correct" }))
    .input(
      z.object({
        originalOrderId: z.string().min(1),
        expectedFingerprint: z.string().length(64),
        reason: z.string().trim().min(1).max(500),
        notes: z.string().max(2_000).optional().nullable(),
        priceMode: orderPriceModeSchema.optional(),
        returns: z
          .array(
            z.object({
              lineId: z.string().min(1),
              qty: z.number().multipleOf(0.001).positive(),
              restock: z.boolean().default(true),
            }),
          )
          .max(500)
          .default([]),
        additions: z
          .array(
            z.object({
              productId: z.string().min(1),
              variantId: z.string().optional().nullable(),
              qty: z.number().multipleOf(0.001).positive(),
              unitPriceKgs: optionalUnitPriceSchema,
            }),
          )
          .max(500)
          .default([]),
        shiftId: z.string().min(1),
        paymentMethod: z.enum(["CASH", "CARD", "TRANSFER", "OTHER"]),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await correctCompletedCustomerOrder({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  resolveCorrectionRefund: salesOrdersManagerProcedure
    .use(rateLimit({ windowMs: 10_000, max: 10, prefix: "sales-orders-correction-refund" }))
    .input(
      z.object({
        refundRequestId: z.string().min(1),
        action: z.enum(["RESOLVED", "CANCELED"]),
        shiftId: z.string().min(1).optional().nullable(),
        idempotencyKey: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await resolveCorrectionRefundRequest({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  metrics: salesOrdersManagerProcedure
    .input(
      z.object({
        storeId: z.string().optional(),
        employeeId: z.string().optional(),
        dateFrom: z.coerce.date().optional(),
        dateTo: z.coerce.date().optional(),
        fromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        toDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        groupBy: z.enum(["day", "week"]).default("day"),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const storeScope = await resolveSalesOrderStoreScope(ctx, input.storeId);
        const from = input.fromDay ? zonedDayStart(input.fromDay) : input.dateFrom;
        const to = input.toDay ? zonedDayEnd(input.toDay) : input.dateTo;
        if (!from || !to) throw new AppError("invalidInput", "BAD_REQUEST", 400);
        return await getSalesOrderMetrics({
          organizationId: ctx.user.organizationId,
          ...storeScope,
          employeeId: input.employeeId,
          dateFrom: from,
          dateTo: to,
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
          employeeId: z.string().optional(),
          dateFrom: z.coerce.date().optional(),
          dateTo: z.coerce.date().optional(),
          createdFromDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          createdToDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(200).optional(),
          sortBy: z.enum(["createdAt", "number", "totalKgs", "customerName"]).optional(),
          sortDirection: z.enum(["asc", "desc"]).optional(),
          lifecycleView: z.enum(salesOrderLifecycleViews).optional(),
          archiveFilter: z.enum(["VISIBLE", "ARCHIVED", "ALL"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const storeScope = await resolveSalesOrderStoreScope(ctx, input?.storeId);
        const createdFrom = input?.createdFromDay
          ? zonedDayStart(input.createdFromDay)
          : undefined;
        const createdTo = input?.createdToDay ? zonedDayEnd(input.createdToDay) : undefined;
        if (
          (input?.createdFromDay && !createdFrom) ||
          (input?.createdToDay && !createdTo)
        ) {
          throw new AppError("invalidInput", "BAD_REQUEST", 400);
        }
        return await listCustomerOrders({
          organizationId: ctx.user.organizationId,
          ...storeScope,
          status: input?.status,
          search: input?.search?.trim() || undefined,
          employeeId: input?.employeeId || undefined,
          dateFrom: input?.dateFrom ?? createdFrom ?? undefined,
          dateTo: input?.dateTo ?? createdTo ?? undefined,
          page: input?.page ?? 1,
          pageSize: input?.pageSize ?? 25,
          sortBy: input?.sortBy,
          sortDirection: input?.sortDirection,
          lifecycleView: input?.lifecycleView,
          archiveFilter: input?.archiveFilter,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  getById: salesOrdersProtectedProcedure
    .input(z.object({ customerOrderId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
        return await getCustomerOrder({
          organizationId: ctx.user.organizationId,
          customerOrderId: input.customerOrderId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  createSale: salesOrdersManagerProcedure
    .input(createOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const operation = await createCustomerSaleOperation({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
        return operation.response.order;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  postSale: salesOrdersManagerProcedure
    .input(z.object({ customerOrderId: z.string().min(1), idempotencyKey: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await postCustomerSale({
          ...input, organizationId: ctx.user.organizationId, actorId: ctx.user.id, requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  removeDeclinedLine: salesOrdersManagerProcedure
    .input(z.object({
      customerOrderId: z.string().min(1),
      lineId: z.string().min(1),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      idempotencyKey: z.string().min(8),
      reason: z.string().trim().min(1).max(500),
      confirmCancelLastLine: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await removeDeclinedCustomerOrderLine({
          ...input, organizationId: ctx.user.organizationId, actorId: ctx.user.id, requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  createDraft: salesOrdersProtectedProcedure
    .input(createOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await assertUserCanAccessStore(ctx.prisma, ctx.user, input.storeId);
        const operation = await createCustomerOrderDraftOperation({
          organizationId: ctx.user.organizationId,
          storeId: input.storeId,
          priceMode: input.priceMode,
          idempotencyKey: input.idempotencyKey,
          customerId: input.customerId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress,
          notes: input.notes,
          lines: input.lines,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
        return operation.response.order;
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  update: salesOrdersProtectedProcedure
    .input(updateOrderInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
        return await updateCustomerOrder({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  quotePriceMode: salesOrdersProtectedProcedure
    .input(
      z.object({
        storeId: z.string().min(1),
        priceMode: orderPriceModeSchema,
        lines: z
          .array(
            z.object({
              productId: z.string().min(1),
              variantId: z.string().optional().nullable(),
            }),
          )
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await quoteCustomerOrderPriceMode({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  setCustomer: salesOrdersProtectedProcedure    .input(
      z.object({
        customerOrderId: z.string(),
        customerId: z.string().min(1).optional().nullable(),
        customerName: z.string().max(180).optional().nullable(),
        customerEmail: optionalEmailSchema,
        customerPhone: z.string().max(64).optional().nullable(),
        customerAddress: z.string().max(512).optional().nullable(),
        notes: z.string().max(2_000).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
        return await setCustomerOrderCustomer({
          organizationId: ctx.user.organizationId,
          customerOrderId: input.customerOrderId,
          customerId: input.customerId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress,
          notes: input.notes,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateTracking: salesOrdersManagerProcedure
    .input(
      z.object({
        customerOrderId: z.string(),
        trackingNumber: optionalTrackingTextSchema,
        trackingCarrier: optionalTrackingTextSchema,
        trackingUrl: optionalTrackingTextSchema,
        trackingStatus: optionalTrackingTextSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
        return await updateCustomerOrderTracking({
          organizationId: ctx.user.organizationId,
          customerOrderId: input.customerOrderId,
          trackingNumber: input.trackingNumber,
          trackingCarrier: input.trackingCarrier,
          trackingUrl: input.trackingUrl,
          trackingStatus: input.trackingStatus,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  sendEmail: salesOrdersManagerProcedure
    .input(
      z.object({
        customerOrderId: z.string(),
        type: z.enum([CustomerOrderEmailType.CONFIRMATION, CustomerOrderEmailType.TRACKING]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
        return await sendCustomerOrderEmail({
          organizationId: ctx.user.organizationId,
          customerOrderId: input.customerOrderId,
          type: input.type,
          actorId: ctx.user.id,
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
        qty: z.number().multipleOf(0.001).positive(),
        unitPriceKgs: optionalUnitPriceSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
        return await addCustomerOrderLine({
          organizationId: ctx.user.organizationId,
          customerOrderId: input.customerOrderId,
          productId: input.productId,
          variantId: input.variantId,
          qty: input.qty,
          unitPriceKgs: input.unitPriceKgs,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  updateLine: salesOrdersProtectedProcedure
    .input(
      z
        .object({
          lineId: z.string(),
          qty: z.number().multipleOf(0.001).positive().optional(),
          unitPriceKgs: optionalUnitPriceSchema,
        })
        .refine((input) => input.qty !== undefined || input.unitPriceKgs !== undefined, {
          message: "invalidInput",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await assertCustomerOrderLineStoreAccess(ctx, input.lineId);
        return await updateCustomerOrderLine({
          organizationId: ctx.user.organizationId,
          lineId: input.lineId,
          qty: input.qty,
          unitPriceKgs: input.unitPriceKgs,
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
        await assertCustomerOrderLineStoreAccess(ctx, input.lineId);
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
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
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
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
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
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
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
        await assertCustomerOrderStoreAccess(ctx, input.customerOrderId);
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
