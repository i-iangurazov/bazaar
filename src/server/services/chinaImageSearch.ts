import sharp from "sharp";
import { imageSearchMaxBytes, type ImageSearchMode } from "@/lib/chinaImageSearch";
import { getAuthTokenFromCookieHeader } from "@/server/auth/token";
import { getRedisPublisher } from "@/server/redis";
import { createRateLimiter, type RateLimiter } from "@/server/middleware/rateLimiter";
import { assertMarketplaceFeature } from "./marketplaceSubscription";
import { prepareProductStudioSource } from "./productImageSourceUpload";
import { demoImageSearchResult, searchHiobuyByImage } from "./hiobuyImageSearch";
import { AppError } from "./errors";

export function imageSearchMode(organizationId: string): ImageSearchMode {
  const allowed = (process.env.HIOBUY_IMAGE_SEARCH_ORGANIZATION_IDS ?? "")
    .split(",")
    .map((id) => id.trim());
  if (!allowed.includes(organizationId)) return "disabled";
  if (process.env.HIOBUY_IMAGE_SEARCH_MODE === "demo") return "demo";
  if (
    process.env.HIOBUY_IMAGE_SEARCH_MODE === "live" &&
    process.env.HIOBUY_API_KEY?.trim() &&
    process.env.HIOBUY_CATALOG_USE_CONFIRMED === "1" &&
    process.env.HARDENING_EXTERNAL_PROVIDER_MODE !== "disabled"
  )
    return "live";
  return "disabled";
}

export async function authorizeImageSearch(request: Request) {
  const token = await getAuthTokenFromCookieHeader(request.headers.get("cookie"));
  if (!token) throw new AppError("unauthorized", "UNAUTHORIZED", 401);
  if (
    !token.organizationId ||
    !token.sub ||
    !["ADMIN", "MANAGER"].includes(String(token.role)) ||
    /(?:^|;\s*)impersonation_session=/.test(request.headers.get("cookie") ?? "")
  )
    throw new AppError("forbidden", "FORBIDDEN", 403);
  return { organizationId: String(token.organizationId), userId: token.sub };
}

// One atomic check shared by every server instance. Daily bucket uses UTC,
// matching HioBuy. Reserve attempts, including timeouts, conservatively.
const consumeScript = `
  for i, key in ipairs(KEYS) do
    if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[i * 2 - 1]) then return 0 end
  end
  for i, key in ipairs(KEYS) do
    local count = redis.call('INCR', key)
    if count == 1 then redis.call('PEXPIRE', key, ARGV[i * 2]) end
  end
  return 1`;
let demoLimiter: RateLimiter | undefined;
export async function consumeImageSearchLimit(
  identity: { organizationId: string; userId: string },
  mode: "demo" | "live",
) {
  try {
    if (mode === "demo") {
      demoLimiter ??= createRateLimiter({ prefix: "china-image-demo", max: 6, windowMs: 60_000 });
      await demoLimiter.consume(`${identity.organizationId}:${identity.userId}`);
      return;
    }
    const redis = getRedisPublisher();
    if (!redis) throw new Error("redisUnavailable");
    const utcDay = new Date().toISOString().slice(0, 10);
    const result = await redis.eval(
      consumeScript,
      4,
      `china-image:user:${identity.organizationId}:${identity.userId}`,
      `china-image:org:${identity.organizationId}`,
      "china-image:global:minute",
      `china-image:global:${utcDay}`,
      3,
      60_000,
      6,
      60_000,
      12,
      60_000,
      45,
      86_400_000,
    );
    if (result === 0) throw new Error("rateLimited");
    if (result !== 1) throw new Error("redisUnavailable");
  } catch (error) {
    if (error instanceof Error && error.message === "rateLimited")
      throw new AppError("imageSearchRateLimited", "TOO_MANY_REQUESTS", 429);
    throw new AppError("imageSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  }
}

export async function assertImageSearchPlan(organizationId: string) {
  // Reuse the existing marketplace entitlement; no new paid Bazaar promise.
  await assertMarketplaceFeature(organizationId);
}

export async function runChinaImageSearch(input: {
  file: File;
  locale: string;
  consent: boolean;
  mode: "demo" | "live";
  signal?: AbortSignal;
}) {
  if (!input.file.size || input.file.size > imageSearchMaxBytes)
    throw new AppError(
      input.file.size ? "imageTooLarge" : "imageInvalidType",
      "BAD_REQUEST",
      input.file.size ? 413 : 400,
    );
  if (input.mode === "live" && !input.consent)
    throw new AppError("imageSearchConsentRequired", "BAD_REQUEST", 400);
  let jpeg: Buffer;
  try {
    // Reuse Bazaar's upload codecs, including HEIC; re-encode to strip EXIF/GPS.
    const source = await prepareProductStudioSource(input.file);
    jpeg = await sharp(source.buffer, { limitInputPixels: 40_000_000, pages: 1 })
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "white" })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    throw new AppError("imageInvalidType", "BAD_REQUEST", 400);
  }
  if (input.mode === "demo") return demoImageSearchResult();
  return searchHiobuyByImage({
    jpeg,
    apiKey: process.env.HIOBUY_API_KEY!.trim(),
    locale: input.locale,
    signal: input.signal,
  });
}
