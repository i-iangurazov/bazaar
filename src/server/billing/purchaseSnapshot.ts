import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PLAN_CODES } from "@/lib/billing/plans";
import { subscriptionExtrasSchema } from "@/lib/billing/subscriptionPricing";
import { AppError } from "@/server/services/errors";
import { planDefinitionSchema } from "./contractTerms";

export const purchaseSnapshotSchema = z.object({
  version: z.literal(1),
  catalogVersion: z.enum(["2026-10", "2026-11"]),
  kind: z.enum(["RENEWAL", "UPGRADE"]),
  plan: z.enum(PLAN_CODES),
  months: z.union([z.literal(1), z.literal(6), z.literal(12)]),
  extras: subscriptionExtrasSchema,
  monthlyMinor: z.number().int().positive(),
  discountBps: z.number().int().min(0).max(2000),
  fullAmountMinor: z.number().int().positive(),
  amountMinor: z.number().int().positive().max(2147483647),
  serviceValueMinor: z.number().int().positive(),
  creditMinor: z.number().int().nonnegative(),
  organizationId: z.string(),
  expectedPlan: z.enum(PLAN_CODES),
  expectedPeriodEnd: z.string().datetime().nullable(),
  sourcePeriodId: z.string().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  cycleStartsAt: z.string().datetime(),
  cycleEndsAt: z.string().datetime(),
  anchorDay: z.number().int().min(1).max(31),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  entitlements: planDefinitionSchema.optional(),
});
export type PurchaseSnapshot = z.infer<typeof purchaseSnapshotSchema>;
export const readPurchaseSnapshot = (value: unknown): PurchaseSnapshot | null => {
  if (value == null) return null;
  const result = purchaseSnapshotSchema.safeParse(value);
  if (!result.success) throw new AppError("billingPaymentNeedsReview", "CONFLICT", 409);
  return result.data;
};

const quoteSecret = () => {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new AppError("billingPaymentsUnavailable", "CONFLICT", 409);
  return secret;
};
export const signPurchaseQuote = (snapshot: PurchaseSnapshot) => {
  const body = Buffer.from(JSON.stringify(snapshot)).toString("base64url");
  return `${body}.${createHmac("sha256", quoteSecret()).update(`subscription-quote-v1:${body}`).digest("base64url")}`;
};
export const verifyPurchaseQuote = (token: string, organizationId: string, now = new Date()) => {
  try {
    if (token.length > 12000) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error();
    const expected = createHmac("sha256", quoteSecret()).update(`subscription-quote-v1:${parts[0]}`).digest();
    const received = Buffer.from(parts[1], "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error();
    const snapshot = purchaseSnapshotSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    if (snapshot.organizationId !== organizationId || new Date(snapshot.expiresAt) <= now ||
      new Date(snapshot.issuedAt).getTime() > now.getTime() + 1000) throw new Error();
    return snapshot;
  } catch {
    throw new AppError("billingQuoteChanged", "CONFLICT", 409);
  }
};
