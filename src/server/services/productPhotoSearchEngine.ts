import { Buffer } from "node:buffer";
import { productPhotoSearchDimension, productPhotoSearchMaxImages, productPhotoSearchStreamMaxImages,
  productPhotoSearchGalleryProtocol, productPhotoSearchModel, productPhotoSearchMinScore, validProductPhotoRegion,
  type ProductPhotoAnalysis, type ProductPhotoRegion } from "@/lib/productPhotoSearch";
import { AppError } from "./errors";

export const photoSearchConfigured = () => Boolean(process.env.PRODUCT_PHOTO_SEARCH_URL?.trim() && (process.env.PRODUCT_PHOTO_SEARCH_TOKEN?.length ?? 0) >= 32);
export const photoSearchStreamingEnabled = () => process.env.PRODUCT_PHOTO_SEARCH_STREAMING === "1";
export const photoSearchIndexEnabled = () => photoSearchStreamingEnabled() && process.env.PRODUCT_PHOTO_SEARCH_PACKED === "1";
export const validPhotoEmbedding = (value: unknown): value is number[] => {
  if (!Array.isArray(value) || value.length !== productPhotoSearchDimension || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return false;
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
  return Math.abs(norm - 1) < 0.01;
};

type PackedGallery = { stream: ReadableStream<Uint8Array>; length: number };
async function requestEngine(path: string, body?: unknown, signal?: AbortSignal, gallery?: PackedGallery) {
  if (!photoSearchConfigured()) throw new AppError("photoSearchNotConfigured", "INTERNAL_SERVER_ERROR", 503);
  const url = new URL(process.env.PRODUCT_PHOTO_SEARCH_URL!.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw new AppError("photoSearchNotConfigured", "INTERNAL_SERVER_ERROR", 503);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path}`;
  const deadline = AbortSignal.timeout(path === "health" || path === "snapshot-status" ? 2500 : gallery ? 46_000 : 20_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const options: RequestInit & { duplex?: "half" } = {
      method: body !== undefined || gallery ? "POST" : "GET", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${process.env.PRODUCT_PHOTO_SEARCH_TOKEN}`,
        ...(gallery ? { "Content-Type": "application/octet-stream", "Content-Length": String(gallery.length) }
          : { "Content-Type": "application/json" }) },
      body: gallery ? gallery.stream : body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
      ...(gallery ? { duplex: "half" } : {}),
    };
    const response = await fetch(url, options);
    if (response.status === 429) { await response.body?.cancel(); throw new AppError("photoSearchBusy", "TOO_MANY_REQUESTS", 429); }
    if ((path === "snapshot-status" || path === "snapshot-search") && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
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
    if (error instanceof Error && error.cause instanceof AppError) throw error.cause;
    if (combined.aborted) throw new AppError("photoSearchTimeout", "INTERNAL_SERVER_ERROR", 504);
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  }
}

export async function checkPhotoSearchEngine(signal?: AbortSignal) {
  const result = await requestEngine("health", undefined, signal);
  if (result.ready !== true || result.dimension !== productPhotoSearchDimension ||
    (photoSearchStreamingEnabled() && (result.galleryProtocol !== productPhotoSearchGalleryProtocol ||
      result.maxImages !== productPhotoSearchStreamMaxImages || result.vision !== true)))
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
}

export async function embedProductPhoto(jpeg: Buffer, signal?: AbortSignal) {
  const result = await requestEngine("embed", { imageBase64: jpeg.toString("base64") }, signal);
  if (!validPhotoEmbedding(result.embedding)) throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return result.embedding;
}

const noAnalysis = (): ProductPhotoAnalysis => ({ regionSource: "full", region: null, ocrStatus: "unavailable", lines: [] });
function readAnalysis(value: unknown): ProductPhotoAnalysis {
  if (value === undefined) return noAnalysis(); // Older private runtime: visual search remains usable.
  const data = value as ProductPhotoAnalysis;
  if (!data || !["auto", "manual", "full"].includes(data.regionSource) || !["ready", "unavailable"].includes(data.ocrStatus) ||
    (data.region !== null && !validProductPhotoRegion(data.region)) || (data.regionSource !== "full" && !data.region) || (data.regionSource === "full" && data.region !== null) ||
    !Array.isArray(data.lines) || data.lines.length > 24 || data.lines.some((line) => !line || typeof line.text !== "string" || line.text.length > 120 ||
      typeof line.confidence !== "number" || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1 || !validProductPhotoRegion(line.box)))
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return { regionSource: data.regionSource, region: data.region, ocrStatus: data.ocrStatus,
    lines: data.lines.map((line) => ({ text: line.text.replace(/[\u0000-\u001f\u007f]/g, " "), confidence: line.confidence, box: line.box })) };
}

type QueryOptions = { region?: ProductPhotoRegion; autoRegion?: boolean };
type FeatureVector = { productId: string; embedding: number[] };
type PhotoHit = { index: number; score: number };
type EngineSearchReply = { matches?: unknown; analysis?: unknown };

type PhotoIndexScope = { organizationId: string; storeId: string };
export type PreparedPhotoIndex = { revision: string; count: number; withoutPhoto: number };
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function readPreparedIndex(value: unknown): PreparedPhotoIndex {
  const index = value as PreparedPhotoIndex | null;
  if (!index || !isDigest(index.revision) || !Number.isInteger(index.count) || index.count < 1 || index.count > productPhotoSearchStreamMaxImages ||
    !Number.isInteger(index.withoutPhoto) || index.withoutPhoto < 0 || index.withoutPhoto > productPhotoSearchStreamMaxImages)
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return index;
}

export async function checkPreparedPhotoIndex(scope: PhotoIndexScope, signal?: AbortSignal) {
  const result = await requestEngine("snapshot-status", scope, signal);
  return result === null ? null : readPreparedIndex(result.snapshot);
}

function queryBody(jpeg: Buffer, { region, autoRegion }: QueryOptions) {
  if (region && !validProductPhotoRegion(region)) throw new AppError("invalidInput", "BAD_REQUEST", 400);
  return { imageBase64: jpeg.toString("base64"), minScore: productPhotoSearchMinScore,
    ...(region ? { region } : {}), ...(autoRegion === false ? { autoRegion: false } : {}) };
}

function readQueryResult(result: EngineSearchReply, count: number, { region, autoRegion }: QueryOptions) {
  if (!Array.isArray(result.matches) || result.matches.length > 8 || result.matches.some((match: { index?: unknown; score?: unknown }) =>
    !match || !Number.isInteger(match.index) || Number(match.index) < 0 || Number(match.index) >= count ||
    typeof match.score !== "number" || !Number.isFinite(match.score) || Math.abs(match.score) > 1.001))
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  const analysis = readAnalysis(result.analysis);
  if (region && analysis.regionSource !== "manual") throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  if (!region && analysis.regionSource === "manual") throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  if (region && !(Object.keys(region) as (keyof ProductPhotoRegion)[]).every((key) => analysis.region?.[key] === region[key]))
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  if (!region && autoRegion === false && analysis.regionSource === "auto") throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return { matches: result.matches as PhotoHit[], analysis };
}

export async function queryPreparedProductPhoto(jpeg: Buffer, scope: PhotoIndexScope, signal?: AbortSignal, options: QueryOptions = {}) {
  const result = await requestEngine("snapshot-search", { ...scope, ...queryBody(jpeg, options) }, signal);
  if (result === null) return null;
  const index = readPreparedIndex(result.snapshot);
  if (result.analysis === undefined)
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  const { matches, analysis } = readQueryResult(result, index.count, options);
  const sourceKeys = result.matches.map((hit: { sourceKey?: unknown }) => hit.sourceKey) as unknown[];
  if (!sourceKeys.every(isDigest)) throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return { index, sourceKeys: sourceKeys.filter((_, i) => matches[i].score >= productPhotoSearchMinScore), analysis };
}

export async function queryProductPhoto(jpeg: Buffer, features: FeatureVector[], signal?: AbortSignal, options: QueryOptions = {}) {
  const body = queryBody(jpeg, options);
  if (!features.length) return { matches: [] as PhotoHit[], analysis: noAnalysis() };
  if (features.length > productPhotoSearchMaxImages || features.some((feature) => !validPhotoEmbedding(feature.embedding)))
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  const buffer = Buffer.allocUnsafe(features.length * productPhotoSearchDimension * 4);
  const productGroups = new Map<string, number>();
  const groups = features.map((feature, index) => {
    feature.embedding.forEach((number, column) => buffer.writeFloatLE(number, (index * productPhotoSearchDimension + column) * 4));
    if (!productGroups.has(feature.productId)) productGroups.set(feature.productId, productGroups.size);
    return productGroups.get(feature.productId)!;
  });
  const result = await requestEngine("search", { ...body, vectorsBase64: buffer.toString("base64"), groups }, signal);
  return readQueryResult(result, features.length, options);
}

const recordBytes = 4 + 4 * productPhotoSearchDimension;
export const photoSearchVectorPage = 1024;

// PostgreSQL's binary real[] has a 20-byte header and a length prefix before
// each big-endian float. Preserve the stored float32 bits on the Faiss wire.
export function packPostgresVector(embedding: Uint8Array, packed: Buffer, offset: number) {
  const data = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  if (data.length !== 20 + 8 * productPhotoSearchDimension ||
      data.readUInt32BE(0) !== 1 || data.readUInt32BE(4) !== 0 || data.readUInt32BE(8) !== 700 ||
      data.readUInt32BE(12) !== productPhotoSearchDimension)
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  let sum = 0;
  for (let column = 0; column < productPhotoSearchDimension; column += 1) {
    const index = 20 + 8 * column;
    if (data.readUInt32BE(index) !== 4) throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
    const value = data.readFloatBE(index + 4);
    sum += value * value;
    packed.writeUInt32LE(data.readUInt32BE(index + 4), offset + 4 * column);
  }
  if (!Number.isFinite(sum) || Math.abs(Math.sqrt(sum) - 1) >= 0.01)
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
}

export async function queryProductPhotoStream(jpeg: Buffer, count: number,
  pages: AsyncGenerator<{ productId: string; embedding: Uint8Array }[]>, signal?: AbortSignal, options: QueryOptions = {}) {
  const body = queryBody(jpeg, options);
  if (!count) return { matches: [] as PhotoHit[], analysis: noAnalysis() };
  if (!Number.isInteger(count) || count < 0 || count > productPhotoSearchStreamMaxImages)
    throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  const metadata = Buffer.from(JSON.stringify({ ...body, count }));
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(metadata.length);
  const groups = new Map<string, number>();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(Buffer.concat([prefix, metadata])); },
    async pull(controller) {
      signal?.throwIfAborted();
      if (sent === count) {
        await pages.return(undefined);
        controller.close();
        return;
      }
      const page = await pages.next();
      if (page.done || !page.value.length || page.value.length > photoSearchVectorPage || sent + page.value.length > count)
        throw new AppError("photoSearchPreparing", "CONFLICT", 409);
      const packed = Buffer.allocUnsafe(page.value.length * recordBytes);
      page.value.forEach(({ productId, embedding }, row) => {
        if (!groups.has(productId)) groups.set(productId, groups.size);
        const offset = row * recordBytes;
        packed.writeUInt32LE(groups.get(productId)!, offset);
        packPostgresVector(embedding, packed, offset + 4);
      });
      sent += page.value.length;
      controller.enqueue(packed);
    },
    async cancel() { await pages.return(undefined); },
  });
  const result = await requestEngine("search-stream", undefined, signal,
    { stream, length: 4 + metadata.length + count * recordBytes });
  if (sent !== count || result.analysis === undefined) throw new AppError("photoSearchUnavailable", "INTERNAL_SERVER_ERROR", 503);
  return readQueryResult(result, count, options);
}

export async function matchProductPhoto(jpeg: Buffer, features: { productId: string; embedding: number[] }[], signal?: AbortSignal) {
  return (await queryProductPhoto(jpeg, features, signal)).matches;
}
