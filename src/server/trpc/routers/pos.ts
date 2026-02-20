import {
  CashDrawerMovementType,
  CustomerOrderStatus,
  FiscalReceiptStatus,
  PosPaymentMethod,
} from "@prisma/client";
import { z } from "zod";

import {
  adminProcedure as baseAdminProcedure,
  cashierProcedure as baseCashierProcedure,
  managerProcedure as baseManagerProcedure,
  protectedProcedure as baseProtectedProcedure,
  rateLimit,
  router,
} from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { assertFeatureEnabled } from "@/server/services/planLimits";
import {
  addPosSaleLine,
  addSaleReturnLine,
  cancelPosSaleDraft,
  closeRegisterShift,
  completePosSale,
  completeSaleReturn,
  createPosRegister,
  createPosSaleDraft,
  createSaleReturnDraft,
  getActivePosSaleDraft,
  getCurrentRegisterShift,
  getPosEntry,
  getPosSale,
  getSaleReturn,
  getShiftXReport,
  listPosRegisters,
  listPosReceipts,
  listPosSales,
  listRegisterShifts,
  listSaleReturns,
  openRegisterShift,
  recordCashDrawerMovement,
  retryPosSaleKkm,
  removePosSaleLine,
  removeSaleReturnLine,
  upsertSaleLineMarkingCodes,
  updatePosRegister,
  updatePosSaleLine,
  updateSaleReturnLine,
} from "@/server/services/pos";
import {
  createConnectorPairingCode,
  listFiscalReceipts,
  retryFiscalReceipt,
} from "@/server/services/kkmConnector";

const paymentSchema = z.object({
  method: z.nativeEnum(PosPaymentMethod),
  amountKgs: z.number().positive(),
  providerRef: z.string().max(120).optional().nullable(),
});

const protectedProcedure = baseProtectedProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "pos" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const managerProcedure = baseManagerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "pos" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const adminProcedure = baseAdminProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "pos" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const cashierProcedure = baseCashierProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "pos" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const kkmManagerProcedure = managerProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "kkm" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

const kkmAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  try {
    await assertFeatureEnabled({ organizationId: ctx.user.organizationId, feature: "kkm" });
  } catch (error) {
    throw toTRPCError(error);
  }
  return next();
});

export const posRouter = router({
  entry: protectedProcedure
    .input(z.object({ registerId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await getPosEntry({
          organizationId: ctx.user.organizationId,
          registerId: input?.registerId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  registers: router({
    list: protectedProcedure
      .input(z.object({ storeId: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        try {
          return await listPosRegisters({
            organizationId: ctx.user.organizationId,
            storeId: input?.storeId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    create: adminProcedure
      .input(
        z.object({
          storeId: z.string().min(1),
          name: z.string().min(2).max(120),
          code: z.string().min(1).max(32),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createPosRegister({
            organizationId: ctx.user.organizationId,
            storeId: input.storeId,
            name: input.name.trim(),
            code: input.code.trim().toUpperCase(),
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    update: adminProcedure
      .input(
        z.object({
          registerId: z.string().min(1),
          name: z.string().min(2).max(120).optional(),
          code: z.string().min(1).max(32).optional(),
          isActive: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await updatePosRegister({
            organizationId: ctx.user.organizationId,
            registerId: input.registerId,
            name: input.name?.trim(),
            code: input.code?.trim().toUpperCase(),
            isActive: input.isActive,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
  }),

  shifts: router({
    current: protectedProcedure
      .input(z.object({ registerId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          return await getCurrentRegisterShift({
            organizationId: ctx.user.organizationId,
            registerId: input.registerId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    list: protectedProcedure
      .input(
        z
          .object({
            registerId: z.string().optional(),
            storeId: z.string().optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await listRegisterShifts({
            organizationId: ctx.user.organizationId,
            registerId: input?.registerId,
            storeId: input?.storeId,
            page: input?.page ?? 1,
            pageSize: input?.pageSize ?? 20,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    open: cashierProcedure
      .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "pos-shifts-open" }))
      .input(
        z.object({
          registerId: z.string().min(1),
          openingCashKgs: z.number().min(0),
          notes: z.string().max(500).optional().nullable(),
          idempotencyKey: z.string().min(8),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await openRegisterShift({
            organizationId: ctx.user.organizationId,
            registerId: input.registerId,
            openingCashKgs: input.openingCashKgs,
            notes: input.notes,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
            idempotencyKey: input.idempotencyKey,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    xReport: protectedProcedure
      .input(z.object({ shiftId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          return await getShiftXReport({
            organizationId: ctx.user.organizationId,
            shiftId: input.shiftId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    close: managerProcedure
      .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "pos-shifts-close" }))
      .input(
        z.object({
          shiftId: z.string().min(1),
          closingCashCountedKgs: z.number().min(0),
          notes: z.string().max(500).optional().nullable(),
          idempotencyKey: z.string().min(8),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await closeRegisterShift({
            organizationId: ctx.user.organizationId,
            shiftId: input.shiftId,
            closingCashCountedKgs: input.closingCashCountedKgs,
            notes: input.notes,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
            idempotencyKey: input.idempotencyKey,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
  }),

  sales: router({
    list: protectedProcedure
      .input(
        z
          .object({
            storeId: z.string().optional(),
            registerId: z.string().optional(),
            search: z.string().optional(),
            statuses: z.array(z.nativeEnum(CustomerOrderStatus)).optional(),
            dateFrom: z.coerce.date().optional(),
            dateTo: z.coerce.date().optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await listPosSales({
            organizationId: ctx.user.organizationId,
            storeId: input?.storeId,
            registerId: input?.registerId,
            search: input?.search?.trim() || undefined,
            statuses: input?.statuses,
            dateFrom: input?.dateFrom,
            dateTo: input?.dateTo,
            page: input?.page ?? 1,
            pageSize: input?.pageSize ?? 25,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    get: protectedProcedure
      .input(z.object({ saleId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          return await getPosSale({
            organizationId: ctx.user.organizationId,
            saleId: input.saleId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    activeDraft: cashierProcedure
      .input(z.object({ registerId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          return await getActivePosSaleDraft({
            organizationId: ctx.user.organizationId,
            registerId: input.registerId,
            actorId: ctx.user.id,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    createDraft: cashierProcedure
      .input(
        z.object({
          registerId: z.string().min(1),
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
          return await createPosSaleDraft({
            organizationId: ctx.user.organizationId,
            registerId: input.registerId,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            notes: input.notes,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
            lines: input.lines,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    addLine: cashierProcedure
      .input(
        z.object({
          saleId: z.string().min(1),
          productId: z.string().min(1),
          variantId: z.string().optional().nullable(),
          qty: z.number().int().positive(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await addPosSaleLine({
            organizationId: ctx.user.organizationId,
            saleId: input.saleId,
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

    updateLine: cashierProcedure
      .input(
        z.object({
          lineId: z.string().min(1),
          qty: z.number().int().positive(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await updatePosSaleLine({
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

    removeLine: cashierProcedure
      .input(z.object({ lineId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await removePosSaleLine({
            organizationId: ctx.user.organizationId,
            lineId: input.lineId,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    upsertMarkingCodes: cashierProcedure
      .input(
        z.object({
          saleId: z.string().min(1),
          lineId: z.string().min(1),
          codes: z.array(z.string().max(256)).max(250),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await upsertSaleLineMarkingCodes({
            organizationId: ctx.user.organizationId,
            saleId: input.saleId,
            lineId: input.lineId,
            codes: input.codes,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    cancelDraft: cashierProcedure
      .input(z.object({ saleId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await cancelPosSaleDraft({
            organizationId: ctx.user.organizationId,
            saleId: input.saleId,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    complete: cashierProcedure
      .use(rateLimit({ windowMs: 10_000, max: 30, prefix: "pos-sales-complete" }))
      .input(
        z.object({
          saleId: z.string().min(1),
          idempotencyKey: z.string().min(8),
          payments: z.array(paymentSchema).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await completePosSale({
            organizationId: ctx.user.organizationId,
            saleId: input.saleId,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
            idempotencyKey: input.idempotencyKey,
            payments: input.payments,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    retryKkm: managerProcedure
      .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "pos-sales-retry-kkm" }))
      .input(
        z.object({
          saleId: z.string().min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await retryPosSaleKkm({
            organizationId: ctx.user.organizationId,
            saleId: input.saleId,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
  }),

  returns: router({
    list: protectedProcedure
      .input(
        z
          .object({
            shiftId: z.string().optional(),
            registerId: z.string().optional(),
            originalSaleId: z.string().optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await listSaleReturns({
            organizationId: ctx.user.organizationId,
            shiftId: input?.shiftId,
            registerId: input?.registerId,
            originalSaleId: input?.originalSaleId,
            page: input?.page ?? 1,
            pageSize: input?.pageSize ?? 25,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    get: protectedProcedure
      .input(z.object({ saleReturnId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        try {
          return await getSaleReturn({
            organizationId: ctx.user.organizationId,
            saleReturnId: input.saleReturnId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    createDraft: cashierProcedure
      .input(
        z.object({
          shiftId: z.string().min(1),
          originalSaleId: z.string().min(1),
          notes: z.string().max(2_000).optional().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createSaleReturnDraft({
            organizationId: ctx.user.organizationId,
            shiftId: input.shiftId,
            originalSaleId: input.originalSaleId,
            notes: input.notes,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    addLine: cashierProcedure
      .input(
        z.object({
          saleReturnId: z.string().min(1),
          customerOrderLineId: z.string().min(1),
          qty: z.number().int().positive(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await addSaleReturnLine({
            organizationId: ctx.user.organizationId,
            saleReturnId: input.saleReturnId,
            customerOrderLineId: input.customerOrderLineId,
            qty: input.qty,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    updateLine: cashierProcedure
      .input(
        z.object({
          returnLineId: z.string().min(1),
          qty: z.number().int().positive(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await updateSaleReturnLine({
            organizationId: ctx.user.organizationId,
            returnLineId: input.returnLineId,
            qty: input.qty,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    removeLine: cashierProcedure
      .input(z.object({ returnLineId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await removeSaleReturnLine({
            organizationId: ctx.user.organizationId,
            returnLineId: input.returnLineId,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    complete: managerProcedure
      .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "pos-returns-complete" }))
      .input(
        z.object({
          saleReturnId: z.string().min(1),
          idempotencyKey: z.string().min(8),
          payments: z.array(paymentSchema).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await completeSaleReturn({
            organizationId: ctx.user.organizationId,
            saleReturnId: input.saleReturnId,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
            idempotencyKey: input.idempotencyKey,
            payments: input.payments,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
  }),

  receipts: managerProcedure
    .input(
      z
        .object({
          storeId: z.string().optional(),
          shiftId: z.string().optional(),
          registerId: z.string().optional(),
          cashierId: z.string().optional(),
          statuses: z.array(z.nativeEnum(CustomerOrderStatus)).optional(),
          dateFrom: z.coerce.date().optional(),
          dateTo: z.coerce.date().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listPosReceipts({
          organizationId: ctx.user.organizationId,
          storeId: input?.storeId,
          shiftId: input?.shiftId,
          registerId: input?.registerId,
          cashierId: input?.cashierId,
          statuses: input?.statuses,
          dateFrom: input?.dateFrom,
          dateTo: input?.dateTo,
          page: input?.page ?? 1,
          pageSize: input?.pageSize ?? 25,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  cash: router({
    record: cashierProcedure
      .use(rateLimit({ windowMs: 10_000, max: 40, prefix: "pos-cash-record" }))
      .input(
        z.object({
          shiftId: z.string().min(1),
          type: z.nativeEnum(CashDrawerMovementType),
          amountKgs: z.number().positive(),
          reason: z.string().min(2).max(300),
          idempotencyKey: z.string().min(8),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await recordCashDrawerMovement({
            organizationId: ctx.user.organizationId,
            shiftId: input.shiftId,
            type: input.type,
            amountKgs: input.amountKgs,
            reason: input.reason,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
            idempotencyKey: input.idempotencyKey,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
  }),

  kkm: router({
    receipts: kkmManagerProcedure
      .input(
        z
          .object({
            storeId: z.string().optional(),
            status: z.nativeEnum(FiscalReceiptStatus).optional(),
            page: z.number().int().min(1).optional(),
            pageSize: z.number().int().min(1).max(100).optional(),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        try {
          return await listFiscalReceipts({
            organizationId: ctx.user.organizationId,
            storeId: input?.storeId,
            status: input?.status,
            page: input?.page ?? 1,
            pageSize: input?.pageSize ?? 25,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    createPairingCode: kkmAdminProcedure
      .use(rateLimit({ windowMs: 10_000, max: 10, prefix: "pos-kkm-pair-code" }))
      .input(z.object({ storeId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await createConnectorPairingCode({
            organizationId: ctx.user.organizationId,
            storeId: input.storeId,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),

    retryReceipt: kkmManagerProcedure
      .use(rateLimit({ windowMs: 10_000, max: 20, prefix: "pos-kkm-retry-receipt" }))
      .input(z.object({ receiptId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await retryFiscalReceipt({
            organizationId: ctx.user.organizationId,
            receiptId: input.receiptId,
            actorId: ctx.user.id,
            requestId: ctx.requestId,
          });
        } catch (error) {
          throw toTRPCError(error);
        }
      }),
  }),
});
