import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, rateLimit, router } from "@/server/trpc/trpc";
import { toTRPCError } from "@/server/trpc/errors";
import { appleIntentInputSchema, cancelApplePurchaseIntent, confirmApplePurchase, createApplePurchaseIntent,
  getAppleBillingState, getApplePurchasePreview, restoreApplePurchases } from "@/server/billing/applePayments";
import { getAppleTemporaryUpgradeCatalog, previewAppleTemporaryUpgrade, temporaryUpgradePreviewInputSchema } from "@/server/billing/appleTemporaryUpgrades";
import { appleConsumptionConsentInputSchema, getPersonalAppleConsumptionConsents, revokePersonalAppleConsumptionConsent, setAppleConsumptionConsent } from "@/server/billing/appleConsumption";
const appleProcedure = adminProcedure.use(({ ctx, next }) => {
  if (ctx.impersonator) throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  return next();
});
const signedInfo = z.string().min(30).max(100_000);
const personalAppleProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.impersonator) throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
  return next();
});
export const appleBillingRouter = router({
  consumptionConsent: personalAppleProcedure.use(rateLimit({ max: 20, windowMs: 60_000, prefix: "apple-consumption-consent" }))
    .input(appleConsumptionConsentInputSchema).mutation(async ({ ctx, input }) => {
      try { return await setAppleConsumptionConsent(ctx.user, input); } catch (e) { throw toTRPCError(e); }
    }),
  personalConsumptionConsents: personalAppleProcedure.query(async ({ ctx }) => {
    try { return await getPersonalAppleConsumptionConsents(ctx.user); } catch (e) { throw toTRPCError(e); }
  }),
  revokePersonalConsumptionConsent: personalAppleProcedure.use(rateLimit({ max: 20, windowMs: 60_000, prefix: "apple-consumption-withdraw" }))
    .input(z.object({ consentId: z.string().min(1).max(80) })).mutation(async ({ ctx, input }) => {
      try { return await revokePersonalAppleConsumptionConsent(ctx.user, input.consentId); } catch (e) { throw toTRPCError(e); }
    }),
  temporaryUpgradeCatalog: appleProcedure.query(async ({ ctx }) => {
    try { return await getAppleTemporaryUpgradeCatalog(ctx.user); } catch (e) { throw toTRPCError(e); }
  }),
  previewTemporaryUpgrade: appleProcedure.use(rateLimit({ max: 30, windowMs: 60_000, prefix: "apple-temporary-preview" }))
    .input(temporaryUpgradePreviewInputSchema).query(async ({ ctx, input }) => {
      try { return await previewAppleTemporaryUpgrade(ctx.user, input); } catch (e) { throw toTRPCError(e); }
    }),
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
