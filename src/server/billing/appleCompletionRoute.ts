import { NextResponse } from "next/server";
import { APPLE_BUNDLE_ID } from "./appleConfig";
import { appleNativeOriginAllowed } from "./appleNativeOrigin";
import { appleCompletionChallengeInputSchema, appleCompletionSubmitInputSchema } from "./appleCompletionCrypto";
import { completeAppleNativeOutcome, createAppleCompletionChallenge } from "./appleNativeCompletion";
import { AppError } from "@/server/services/errors";
import { z } from "zod";
import { createRateLimiter, type RateLimiter } from "@/server/middleware/rateLimiter";

let limiter: RateLimiter | undefined;
export async function appleCompletionRoute(request: Request, action: "challenge" | "complete") {
  try {
    const rawOrigin = request.headers.get("origin");
    if (!appleNativeOriginAllowed(rawOrigin) || request.headers.get("x-bazaar-native-app") !== APPLE_BUNDLE_ID)
      throw new AppError("forbidden", "FORBIDDEN", 403);
    if (Number(request.headers.get("content-length") ?? 0) > (action === "complete" ? 220_000 : 5000))
      throw new AppError("appleCompletionUnavailable", "BAD_REQUEST", 400);
    limiter ??= createRateLimiter({ prefix: "apple-completion", max: 60, windowMs: 60_000 });
    await limiter.consume(request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown");
    const origin = new URL(rawOrigin!).origin, body = await request.json();
    const response = action === "challenge" ? await createAppleCompletionChallenge(appleCompletionChallengeInputSchema.parse(body), origin)
      : await completeAppleNativeOutcome(appleCompletionSubmitInputSchema.parse(body), origin);
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const limited = error instanceof Error && error.message === "rateLimited";
    const status = error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : limited ? 429 : 503;
    return NextResponse.json({ error: error instanceof AppError ? error.message : limited ? "rateLimited" : "appleCompletionUnavailable" },
      { status, headers: { "Cache-Control": "no-store" } });
  }
}
