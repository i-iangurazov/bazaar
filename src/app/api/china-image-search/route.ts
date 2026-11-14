import { imageSearchMaxBytes } from "@/lib/chinaImageSearch";
import { AppError } from "@/server/services/errors";
import {
  assertImageSearchPlan,
  authorizeImageSearch,
  consumeImageSearchLimit,
  imageSearchMode,
  runChinaImageSearch,
} from "@/server/services/chinaImageSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
const failure = (error: unknown) =>
  error instanceof AppError
    ? response({ message: error.message }, error.status)
    : response({ message: "imageSearchUnavailable" }, 503);

export async function GET(request: Request) {
  try {
    const identity = await authorizeImageSearch(request);
    await assertImageSearchPlan(identity.organizationId);
    return response({ mode: imageSearchMode(identity.organizationId) });
  } catch (error) {
    return failure(error);
  }
}

async function readForm(request: Request) {
  const limit = imageSearchMaxBytes + 64 * 1024;
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  if (Number(request.headers.get("content-length")) > limit)
    throw new AppError("imageTooLarge", "BAD_REQUEST", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const timer = setTimeout(() => void reader.cancel().catch(() => undefined), 10_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new AppError("imageTooLarge", "BAD_REQUEST", 413);
      chunks.push(value);
    }
    return await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type")! },
    }).formData();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("invalidInput", "BAD_REQUEST", 400);
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await authorizeImageSearch(request);
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new AppError("forbidden", "FORBIDDEN", 403);
    await assertImageSearchPlan(identity.organizationId);
    const mode = imageSearchMode(identity.organizationId);
    if (mode === "disabled") throw new AppError("imageSearchNotConfigured", "FORBIDDEN", 503);
    await consumeImageSearchLimit(identity, mode);
    const form = await readForm(request);
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("invalidInput", "BAD_REQUEST", 400);
    return response(
      await runChinaImageSearch({
        file,
        mode,
        consent: form.get("consent") === "1",
        locale: String(form.get("locale") ?? "en"),
        signal: request.signal,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
