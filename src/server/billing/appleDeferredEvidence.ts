import { z } from "zod";

export const appleDeferredOutcomeInputSchema = z.object({ intentId: z.string().min(1).max(80), attemptId: z.string().uuid(),
  signedTransactionInfo: z.string().min(30).max(100_000), signedRenewalInfo: z.string().min(30).max(100_000) }).strict();

/** Frozen at native auto-renewable CHANGE creation, before its one-use attempt. */
export const appleDeferredSourceSchema = z.object({
  version: z.literal(1), chainId: z.string().min(1), transactionRowId: z.string().min(1),
  transactionId: z.string().regex(/^[0-9]{1,40}$/), originalTransactionId: z.string().regex(/^[0-9]{1,40}$/),
  productId: z.string().min(1).max(100), environment: z.enum(["Production", "Sandbox"]),
  subscriptionGroupId: z.string().min(1).max(100), expiresAt: z.string().datetime(),
}).strict();
export type AppleDeferredSource = z.infer<typeof appleDeferredSourceSchema>;

export function readAppleDeferredSource(offerSnapshot: unknown): AppleDeferredSource | null {
  const result = z.object({ appleChangeSource: appleDeferredSourceSchema }).safeParse(offerSnapshot);
  return result.success ? result.data.appleChangeSource : null;
}
