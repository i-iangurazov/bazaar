import { productPhotoSearchDimension, productPhotoSearchMaxImages, productPhotoSearchModel } from "@/lib/productPhotoSearch";
import { AppError } from "./errors";

export const photoSearchConfigured = () => Boolean(process.env.PRODUCT_PHOTO_SEARCH_URL?.trim() && (process.env.PRODUCT_PHOTO_SEARCH_TOKEN?.length ?? 0) >= 32);
export const validPhotoEmbedding = (value: unknown): value is number[] => {
  if (!Array.isArray(value) || value.length !== productPhotoSearchDimension || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return false;
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
  return Math.abs(norm - 1) < 0.01;
};

async function requestEngine(path: string, body?: unknown, signal?: AbortSignal) {
  if (!photoSearchConfigured()) throw new AppError("photoSearchNotConfigured", "INTERNAL_SERVER_ERROR", 503);
  const url = new URL(process.env.PRODUCT_PHOTO_SEARCH_URL!.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw new AppError("photoSearchNotConfigured", "INTERNAL_SERVER_ERROR", 503);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path}`;
  const deadline = AbortSignal.timeout(path === "health" ? 2500 : 20_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.PRODUCT_PHOTO_SEARCH_TOKEN}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: combined,
    });
    if (response.status === 429) { await response.body?.cancel(); throw new AppError("photoSearchBusy", "TOO_MANY_REQUESTS", 429); }
    if (!response.ok) { await response.body?.cancel(); throw new Error("unavailable"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("invalidResponse");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) throw new Error("invalidResponse");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (result.modelVersion !== productPhotoSearchModel) throw new Error("wrongModel");
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (combined.aborted) throw new AppError("photoSearchTimeout", "INTERNAL_SERVER_ERROR", 504);
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  }
}

export async function checkPhotoSearchEngine(signal?: AbortSignal) {
  const result = await requestEngine("health", undefined, signal);
  if (result.ready !== true || result.dimension !== productPhotoSearchDimension)
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
}

export async function embedProductPhoto(jpeg: Buffer, signal?: AbortSignal) {
  const result = await requestEngine("embed", { imageBase64: jpeg.toString("base64") }, signal);
  if (!validPhotoEmbedding(result.embedding)) throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return result.embedding;
}

export async function matchProductPhoto(jpeg: Buffer, features: { productId: string; embedding: number[] }[], signal?: AbortSignal): Promise<{ index: number; score: number }[]> {
  if (!features.length) return [];
  if (features.length > productPhotoSearchMaxImages || features.some((feature) => !validPhotoEmbedding(feature.embedding)))
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  const buffer = Buffer.allocUnsafe(features.length * productPhotoSearchDimension * 4);
  const productGroups = new Map<string, number>();
  const groups = features.map((feature, index) => {
    feature.embedding.forEach((number, column) => buffer.writeFloatLE(number, (index * productPhotoSearchDimension + column) * 4));
    if (!productGroups.has(feature.productId)) productGroups.set(feature.productId, productGroups.size);
    return productGroups.get(feature.productId)!;
  });
  const result = await requestEngine("search", { imageBase64: jpeg.toString("base64"), vectorsBase64: buffer.toString("base64"), groups }, signal);
  if (!Array.isArray(result.matches) || result.matches.length > 8 || result.matches.some((match: { index?: unknown; score?: unknown }) =>
    !Number.isInteger(match.index) || Number(match.index) < 0 || Number(match.index) >= features.length ||
    typeof match.score !== "number" || !Number.isFinite(match.score) || Math.abs(match.score) > 1.001))
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return result.matches;
}
