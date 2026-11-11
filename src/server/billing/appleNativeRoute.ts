import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerAuthToken } from "@/server/auth/token";
import { AppError } from "@/server/services/errors";
import { acknowledgeApplePurchase, authorizeApplePurchase, cancelApplePurchaseIntent, type AppleBillingActor } from "./applePayments";
import { APPLE_BUNDLE_ID } from "./appleConfig";
const authorizeSchema = z.object({ intentId: z.string().min(1).max(80), prepareOnly: z.boolean().optional(), attemptId: z.string().uuid().optional() }).strict()
  .refine((input) => input.prepareOnly ? !input.attemptId : Boolean(input.attemptId));
const cancelSchema = z.object({ intentId: z.string().min(1).max(80), attemptId: z.string().uuid().optional() }).strict();
const acknowledgeSchema = z.object({ transactionId: z.string().regex(/^[0-9]{1,40}$/), signedTransactionInfo: z.string().min(30).max(100_000) }).strict();
export function appleNativeOriginAllowed(raw: string | null, env: Record<string, string | undefined> = process.env) {
  try {
    if (!raw) return false;
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    const origin = parsed.origin;
    if (origin === "https://www.bazaar.kg") return true;
    if (env.VERCEL_ENV !== "preview" || env.APPLE_BILLING_MODE !== "sandbox" || !env.APPLE_BILLING_PREVIEW_ORIGIN) return false;
    const configured = new URL(env.APPLE_BILLING_PREVIEW_ORIGIN);
    return configured.protocol === "https:" && !configured.username && !configured.password && configured.pathname === "/" &&
      !configured.search && !configured.hash && origin === configured.origin;
  } catch { return false; }
}
async function actorFor(request: Request): Promise<AppleBillingActor> {
  const origin = request.headers.get("origin");
  if (!appleNativeOriginAllowed(origin) || request.headers.get("x-bazaar-native-app") !== APPLE_BUNDLE_ID)
    throw new AppError("forbidden", "FORBIDDEN", 403);
  const token = await getServerAuthToken();
  if (!token?.sub || !token.organizationId || token.role !== "ADMIN" || (await cookies()).has("impersonation_session"))
    throw new AppError("forbidden", "FORBIDDEN", 403);
  return { id: token.sub, organizationId: String(token.organizationId) };
}
export async function appleNativeRoute(request: Request, action: "authorize" | "acknowledge" | "cancel") {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 120_000) throw new AppError("appleInvalidTransaction", "BAD_REQUEST", 400);
    const actor = await actorFor(request);
    const raw = await request.json();
    if (action === "authorize") {
      const input = authorizeSchema.parse(raw);
      return NextResponse.json(await authorizeApplePurchase(actor, input.intentId, { prepareOnly: input.prepareOnly, attemptId: input.attemptId }),
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
