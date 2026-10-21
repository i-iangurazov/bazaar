import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { PLAN_CODES } from "@/lib/billing/plans";
import { adminProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import {
  checkSubscriptionInvoice,
  createSubscriptionCheckout,
  getSubscriptionPaymentState,
  listSubscriptionInvoices,
} from "@/server/billing/subscriptionPayments";

const paymentProcedure = adminProcedure.use(({ ctx, next }) => {
  if (ctx.impersonator) throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  return next();
});

export const subscriptionPaymentsRouter = router({
  get: paymentProcedure.query(async ({ ctx }) => {
    try {
      return await getSubscriptionPaymentState(ctx.user.organizationId);
    } catch (error) {
      throw toTRPCError(error);
    }
  }),
  invoices: paymentProcedure
    .input(z.object({ cursor: z.string().max(50).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        return await listSubscriptionInvoices(ctx.user.organizationId, input.cursor);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  checkout: paymentProcedure
    .use(rateLimit({ max: 6, windowMs: 60_000, prefix: "billing-checkout" }))
    .input(
      z.object({
        plan: z.enum(PLAN_CODES),
        idempotencyKey: z.string().uuid(),
        termsVersion: z.string().min(1).max(100),
        expectedAmountMinor: z.number().int().positive().max(2147483647),
        acceptedTerms: z.literal(true),
        locale: z.enum(["ru", "kg", "en"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createSubscriptionCheckout({
          ...input,
          organizationId: ctx.user.organizationId,
          actorId: ctx.user.id,
          requestId: ctx.requestId,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
  check: paymentProcedure
    .use(rateLimit({ max: 12, windowMs: 60_000, prefix: "billing-check" }))
    .input(z.object({ invoiceId: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await checkSubscriptionInvoice(ctx.user.organizationId, input.invoiceId);
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
