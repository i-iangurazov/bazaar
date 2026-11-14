import { z } from "zod";
import type { ImageSearchItem, ImageSearchResult } from "@/lib/chinaImageSearch";
import { AppError } from "./errors";

const nullableAmount = z.number().finite().nonnegative().nullable().optional();
const itemSchema = z.object({
  id: z.string().min(1).max(100),
  channel: z.literal("1688"),
  source_url: z.string().max(4000).optional(),
  title: z.object({
    original: z.string().max(2000),
    translated: z.string().max(2000).nullable().optional(),
  }),
  image: z.string().max(4000).nullable().optional(),
  price: z
    .object({
      display_amount: nullableAmount,
      promotion_amount: nullableAmount,
      display_currency: z.literal("CNY").optional(),
      original_currency: z.literal("CNY").optional(),
    })
    .nullable()
    .optional(),
  seller: z
    .object({ name: z.string().max(500) })
    .nullable()
    .optional(),
});
const listSchema = z.object({
  channel: z.literal("1688"),
  total: z.number().int().nonnegative(),
  items: z.array(z.unknown()).max(100),
});

function allowedUrl(value: string | null | undefined, hosts: string[]): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol === "http:") url.protocol = "https:";
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeHiobuyImageSearch(payload: unknown): ImageSearchResult {
  const parsed = listSchema.safeParse(payload);
  if (!parsed.success)
    throw new AppError("imageSearchInvalidResponse", "INTERNAL_SERVER_ERROR", 502);
  const items: ImageSearchItem[] = [];
  const ids = new Set<string>();
  for (const raw of parsed.data.items) {
    const result = itemSchema.safeParse(raw);
    if (!result.success) continue;
    const item = result.data;
    const title = item.title.translated?.trim() || item.title.original.trim();
    if (!title || ids.has(item.id)) continue;
    ids.add(item.id);
    items.push({
      id: item.id,
      title,
      originalTitle: item.title.original,
      imageUrl: allowedUrl(item.image, ["alicdn.com", "1688.com"]),
      sourceUrl: allowedUrl(item.source_url, ["1688.com"]),
      price: item.price?.promotion_amount ?? item.price?.display_amount ?? null,
      currency: "CNY",
      seller: item.seller?.name ?? null,
    });
    if (items.length === 20) break;
  }
  // A broken contract must not masquerade as a successful empty search.
  if (parsed.data.items.length && !items.length)
    throw new AppError("imageSearchInvalidResponse", "INTERNAL_SERVER_ERROR", 502);
  return { mode: "live", channel: "1688", items, total: parsed.data.total };
}

export const demoImageSearchResult = (): ImageSearchResult => ({
  mode: "demo",
  channel: "1688",
  total: 3,
  items: [
    ["mug", "陶瓷杯", 12.5],
    ["bowl", "陶瓷碗", 8.8],
    ["carafe", "玻璃水壶", 24],
  ].map(([id, title, price]) => ({
    id: `demo-${id}`,
    title: String(title),
    originalTitle: String(title),
    imageUrl: `/retails/gallery-teply-dom-20261113/${id}.webp`,
    sourceUrl: null,
    price: Number(price),
    currency: "CNY",
    seller: null,
  })),
});

async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) throw new Error("oversized body");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function searchHiobuyByImage(
  input: {
    jpeg: Buffer;
    apiKey: string;
    locale: string;
    signal?: AbortSignal;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ImageSearchResult> {
  // Fixed HTTPS endpoint, no redirects: credentials cannot follow an upstream redirect.
  // No automatic retry: an uncertain timeout may already have consumed quota.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) controller.abort();
  try {
    const response = await fetchImpl("https://api.hiobuy.com/v1/products/search-by-image", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        channel: "1688",
        image_base64: input.jpeg.toString("base64"),
        language: input.locale === "ru" ? "ru" : "en",
        page: 1,
        page_size: 20,
        response_format: "standard",
      }),
    });
    const body = await boundedJson(response).catch(() => {
      if (response.ok)
        throw new AppError("imageSearchInvalidResponse", "INTERNAL_SERVER_ERROR", 502);
      return null;
    });
    const code = z.object({ error: z.object({ code: z.string() }) }).safeParse(body);
    if (!response.ok || code.success) {
      const upstream = code.success ? code.data.error.code : "";
      if (upstream === "QUOTA_EXCEEDED")
        throw new AppError("imageSearchQuotaExceeded", "TOO_MANY_REQUESTS", 429);
      if (response.status === 429)
        throw new AppError("imageSearchRateLimited", "TOO_MANY_REQUESTS", 429);
      if ([401, 403].includes(response.status))
        throw new AppError("imageSearchProviderAccess", "FORBIDDEN", 503);
      if (response.status === 400 || response.status === 422)
        throw new AppError("imageSearchImageRejected", "BAD_REQUEST", 422);
      throw new AppError("imageSearchProviderFailed", "INTERNAL_SERVER_ERROR", 502);
    }
    return normalizeHiobuyImageSearch(body);
  } catch (error) {
    if (controller.signal.aborted)
      throw new AppError("imageSearchTimeout", "INTERNAL_SERVER_ERROR", 504);
    if (error instanceof AppError) throw error;
    // Never return or log provider bodies, transport errors, keys or image bytes.
    throw new AppError("imageSearchProviderFailed", "INTERNAL_SERVER_ERROR", 502);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
  }
}
