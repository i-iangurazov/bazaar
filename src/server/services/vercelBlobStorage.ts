import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import { getVercelOidcToken } from "@vercel/oidc";

import { assertVercelBlobStorageAllowed } from "@/server/config/runtime";

export type BlobStoragePurpose = "images" | "exports";

export const getBlobStoreId = (purpose: BlobStoragePurpose) => {
  const key = purpose === "images" ? "BLOB_IMAGE_STORE_ID" : "BLOB_EXPORT_STORE_ID";
  const value = process.env[key]?.trim() ?? "";
  if (!/^store_[A-Za-z0-9]+$/.test(value)) throw new Error("blobStorageNotConfigured");
  return value;
};

export const getBlobStoreBaseUrl = (purpose: BlobStoragePurpose) => {
  const id = getBlobStoreId(purpose).slice("store_".length).toLowerCase();
  return `https://${id}.${purpose === "images" ? "public" : "private"}.blob.vercel-storage.com`;
};

const safePath = (value: string) =>
  value.length <= 1024 && /^[A-Za-z0-9_.\/-]+$/.test(value) &&
  !value.startsWith("/") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");

// Never let a DB URL, request parameter or default SDK environment choose a
// different store. Exports use the separate private store even when images are public.
export const getBlobStoragePath = (purpose: BlobStoragePurpose, value: string) => {
  if (safePath(value)) return value;
  const rawPath = /^https:\/\/[^/]+\/(.*)$/.exec(value)?.[1];
  if (!rawPath || !safePath(rawPath)) throw new Error("blobStorageLocationInvalid");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("blobStorageLocationInvalid"); }
  if (parsed.origin !== getBlobStoreBaseUrl(purpose) || parsed.username || parsed.password ||
      parsed.search || parsed.hash || !safePath(parsed.pathname.slice(1))) {
    throw new Error("blobStorageLocationInvalid");
  }
  return parsed.pathname.slice(1);
};

const credentials = async (purpose: BlobStoragePurpose) => {
  const storeId = getBlobStoreId(purpose);
  assertVercelBlobStorageAllowed(purpose, storeId);
  // Functions receive OIDC through the request context, whereas builds use an
  // environment variable. Resolve afresh for every operation, including retries.
  // Explicit tokens are not refreshed by Blob; these commands remain bounded to
  // 45 seconds (15 for metadata/deletion), with no static/default token fallback.
  let oidcToken: string;
  try {
    oidcToken = (await getVercelOidcToken()).trim();
  } catch {
    throw new Error("blobStorageAuthenticationUnavailable");
  }
  if (!oidcToken) throw new Error("blobStorageAuthenticationUnavailable");
  return { storeId, oidcToken };
};

export const putManagedBlob = async (input: {
  purpose: BlobStoragePurpose;
  pathname: string;
  body: Buffer | ReadableStream<Uint8Array>;
  contentType: string;
}) => {
  const pathname = getBlobStoragePath(input.purpose, input.pathname);
  const result = await put(pathname, input.body, {
    ...(await credentials(input.purpose)),
    access: input.purpose === "images" ? "public" : "private",
    contentType: input.contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    // Blob's minimum internal cache lifetime is 60 seconds. Private reads
    // bypass that cache; the authorized download response is private/no-store.
    cacheControlMaxAge: input.purpose === "images" ? 365 * 24 * 60 * 60 : 60,
    abortSignal: AbortSignal.timeout(45_000),
  });
  if (getBlobStoragePath(input.purpose, result.url) !== pathname) {
    throw new Error("blobStorageLocationInvalid");
  }
  return new URL(result.url).href;
};

export const readManagedBlob = async (purpose: BlobStoragePurpose, location: string) => {
  const pathname = getBlobStoragePath(purpose, location);
  const result = await get(pathname, {
    ...(await credentials(purpose)), access: purpose === "images" ? "public" : "private",
    useCache: false, abortSignal: AbortSignal.timeout(45_000),
  });
  if (!result || result.statusCode !== 200 || !result.stream || typeof result.blob.size !== "number") return null;
  return { stream: result.stream, size: result.blob.size };
};

export const statManagedBlob = async (purpose: BlobStoragePurpose, location: string) => {
  const pathname = getBlobStoragePath(purpose, location);
  try {
    const result = await head(pathname, { ...(await credentials(purpose)), abortSignal: AbortSignal.timeout(15_000) });
    return { size: result.size };
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
};

export const deleteManagedBlob = async (purpose: BlobStoragePurpose, location: string) => {
  const pathname = getBlobStoragePath(purpose, location);
  await del(pathname, { ...(await credentials(purpose)), abortSignal: AbortSignal.timeout(15_000) });
};
