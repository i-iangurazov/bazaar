import { createContext, type AuthUser } from "@/server/trpc/trpc";
import { getRedisPublisher } from "@/server/redis";
import { AppError } from "./errors";

export const photoJson = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", ...headers },
});
export const photoFailure = (error: unknown) => {
  const failure = error instanceof AppError ? error : new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return photoJson({ message: failure.message }, failure.status, failure.status === 429 ? {
    "Retry-After": failure.message === "photoSearchBusy" ? "2" : "60",
  } : {});
};

export async function photoSearchUser(request: Request) {
  // Same revalidated claims and impersonation scope as the existing product list.
  let user: AuthUser | null;
  try { user = (await createContext({ req: request, resHeaders: new Headers() })).user; }
  catch (error) { if (error instanceof URIError) throw new AppError("unauthorized", "UNAUTHORIZED", 401); throw error; }
  if (!user?.id || !user.organizationId) throw new AppError("unauthorized", "UNAUTHORIZED", 401);
  return user;
}

export function assertPhotoOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("forbidden", "FORBIDDEN", 403);
}

const rateScript = `
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[i]) then return 0 end
end
for _, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('PEXPIRE', key, 60000) end
end
return 1`;
export async function consumePhotoRate(user: AuthUser, kind: "status" | "prepare" | "query") {
  const limits = kind === "query" ? [12, 36] : kind === "prepare" ? [90, 180] : [120, 240];
  try {
    const redis = getRedisPublisher();
    if (!redis) throw new Error("unavailable");
    const result = await redis.eval(rateScript, 2, `product-photo:${kind}:${user.organizationId}:${user.id}`,
      `product-photo:${kind}:${user.organizationId}`, ...limits);
    if (result === 0) throw new AppError("photoSearchRateLimited", "TOO_MANY_REQUESTS", 429);
    if (result !== 1) throw new Error("unavailable");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  }
}

export async function readPhotoBody(request: Request, maxBytes: number) {
  const length = Number(request.headers.get("content-length"));
  if (length > maxBytes) throw new AppError("imageTooLarge", "BAD_REQUEST", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  const timeout = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 10_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new AppError("imageTooLarge", "BAD_REQUEST", 413);
      chunks.push(value);
    }
    if (expired) throw new AppError("photoSearchTimeout", "BAD_REQUEST", 408);
    return Buffer.concat(chunks);
  } finally { clearTimeout(timeout); await reader.cancel().catch(() => undefined); }
}
