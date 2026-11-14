import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthToken } from "@/server/auth/token";
import { AppError } from "@/server/services/errors";
import { acknowledgeApplePurchase, authorizeApplePurchase, cancelApplePurchaseIntent, type AppleBillingActor } from "./applePayments";
import { APPLE_BUNDLE_ID } from "./appleConfig";
import { appleDeferredOutcomeInputSchema } from "./appleDeferredEvidence";
import { recordAppleDeferredOutcome } from "./appleDeferredOutcome";
import { appleNativeOriginAllowed } from "./appleNativeOrigin";
export { appleNativeOriginAllowed } from "./appleNativeOrigin";
const authorizeSchema = z.object({ intentId: z.string().min(1).max(80), prepareOnly: z.boolean().optional(), attemptId: z.string().uuid().optional(),
  completionPublicKey: z.string().min(80).max(200).optional() }).strict()
  .refine((input) => input.prepareOnly ? !input.attemptId && !input.completionPublicKey : Boolean(input.attemptId));
const cancelSchema = z.object({ intentId: z.string().min(1).max(80), attemptId: z.string().uuid().optional() }).strict();
const acknowledgeSchema = z.object({ transactionId: z.string().regex(/^[0-9]{1,40}$/), signedTransactionInfo: z.string().min(30).max(100_000) }).strict();
async function actorFor(request: Request): Promise<AppleBillingActor> {
  const origin = request.headers.get("origin");
  if (!appleNativeOriginAllowed(origin) || request.headers.get("x-bazaar-native-app") !== APPLE_BUNDLE_ID)
    throw new AppError("forbidden", "FORBIDDEN", 403);
  const token = await getServerAuthToken();
  if (!token?.sub || !token.organizationId || token.role !== "ADMIN" || (await cookies()).has("impersonation_session"))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  return { id: token.sub, organizationId: String(token.organizationId) };
}
export async function appleNativeRoute(request: Request, action: "authorize" | "acknowledge" | "cancel" | "deferred") {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > (action === "deferred" ? 220_000 : 120_000)) throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
    const actor = await actorFor(request);
    const raw = await request.json();
    if (action === "deferred") return NextResponse.json(await recordAppleDeferredOutcome(actor, appleDeferredOutcomeInputSchema.parse(raw)),
      { headers: { "Cache-Control": "no-store" } });
    if (action === "authorize") {
      const input = authorizeSchema.parse(raw);
      return NextResponse.json(await authorizeApplePurchase(actor, input.intentId, { prepareOnly: input.prepareOnly, attemptId: input.attemptId,
        ...(input.completionPublicKey ? { completionPublicKey: input.completionPublicKey, completionOrigin: new URL(request.headers.get("origin")!).origin } : {}) }),
        { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "cancel") {
      const input = cancelSchema.parse(raw);
      return NextResponse.json(await cancelApplePurchaseIntent(actor, input.intentId, input.attemptId), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await acknowledgeApplePurchase(actor, acknowledgeSchema.parse(raw)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return NextResponse.json({ error: error instanceof AppError ? error.message : "appleUnavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
