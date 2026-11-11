import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { appleIntentInputSchema, cancelApplePurchaseIntent, confirmApplePurchase, createApplePurchaseIntent,
  getAppleBillingState, getApplePurchasePreview, restoreApplePurchases } from "@/server/billing/applePayments";
const appleProcedure = adminProcedure.use(({ ctx, next }) => {
  if (ctx.impersonator) throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  return next();
});
const signedInfo = z.string().min(30).max(100_000);
export const appleBillingRouter = router({
  catalog: appleProcedure.query(async ({ ctx }) => {
    try { return await getAppleBillingState(ctx.user); } catch (e) { throw toTRPCError(e); }
  }),
  status: appleProcedure.query(async ({ ctx }) => {
    try { return await getAppleBillingState(ctx.user); } catch (e) { throw toTRPCError(e); }
  }),
  preview: appleProcedure.use(rateLimit({ max: 30, windowMs: 60_000, prefix: "apple-preview" }))
    .input(z.object({ expectedOrganizationId: z.string().min(1).max(80), offerKey: z.string().min(1).max(400), action: z.enum(["RENEW", "CHANGE"]).default("RENEW") }))
    .query(async ({ ctx, input }) => { try { return await getApplePurchasePreview(ctx.user, input); } catch (e) { throw toTRPCError(e); } }),
  intent: appleProcedure.use(rateLimit({ max: 8, windowMs: 60_000, prefix: "apple-intent" }))
    .input(appleIntentInputSchema).mutation(async ({ ctx, input }) => {
      try { return await createApplePurchaseIntent(ctx.user, input); } catch (e) { throw toTRPCError(e); }
    }),
  cancelIntent: appleProcedure.input(z.object({ intentId: z.string().min(1).max(80) })).mutation(async ({ ctx, input }) => {
    try { return await cancelApplePurchaseIntent(ctx.user, input.intentId); } catch (e) { throw toTRPCError(e); }
  }),
  confirm: appleProcedure.use(rateLimit({ max: 120, windowMs: 60_000, prefix: "apple-confirm" }))
    .input(z.object({ signedTransactionInfo: signedInfo, intentId: z.string().min(1).max(80).optional() }))
    .mutation(async ({ ctx, input }) => { try { return await confirmApplePurchase(ctx.user, input); } catch (e) { throw toTRPCError(e); } }),
  restore: appleProcedure.use(rateLimit({ max: 6, windowMs: 60_000, prefix: "apple-restore" }))
    .input(z.object({ signedTransactions: z.array(signedInfo).max(50) }))
    .mutation(async ({ ctx, input }) => { try { return await restoreApplePurchases(ctx.user, input.signedTransactions); } catch (e) { throw toTRPCError(e); } }),
});
