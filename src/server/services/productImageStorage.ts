import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, join } from "node:path";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { isProductionRuntime } from "@/server/config/runtime";

const localImageRootDir = join(process.cwd(), "public", "uploads", "imported-products");

const extractHyperlinkTarget = (value: string) => {
  const trimmed = value.trim();
  const patterns = [
    /^(?:=)?HYPERLINK\(\s*"([^"]+)"/i,
    /^(?:=)?ГИПЕРССЫЛКА\(\s*"([^"]+)"/i,
    /^(?:=)?HYPERLINK\(\s*'([^']+)'/i,
    /^(?:=)?ГИПЕРССЫЛКА\(\s*'([^']+)'/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return trimmed;
};

const normalizeOrgPath = (organizationId: string) =>
  organizationId.replace(/[^a-zA-Z0-9_-]/g, "").trim() || "default";

const normalizeProductPath = (productId?: string | null) =>
  productId?.replace(/[^a-zA-Z0-9_-]/g, "").trim() || "unassigned";

const resolveMaxImageBytes = () => {
  const parsed = Number(process.env.PRODUCT_IMAGE_MAX_BYTES);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 5 * 1024 * 1024;
};

const maxImageBytes = resolveMaxImageBytes();

const resolveRemoteImageFetchTimeoutMs = () => {
  const parsed = Number(process.env.PRODUCT_IMAGE_FETCH_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 1_000) {
    return parsed;
  }
  return 4_000;
};

const remoteImageFetchTimeoutMs = resolveRemoteImageFetchTimeoutMs();
const remoteHostAllowCache = new Map<string, boolean>();

type ImageStorageProvider = "local" | "r2";

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
  endpoint: string;
};

const resolveRequestedProvider = (): ImageStorageProvider => {
  const value = process.env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase();
  if (value === "r2") {
    return "r2";
  }
  return "local";
};

const resolveR2Config = (): { config: R2Config | null; missing: string[] } => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucketName = process.env.R2_BUCKET_NAME?.trim() ?? "";
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim() ?? "";
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  const missing: string[] = [];
  if (!accountId) missing.push("R2_ACCOUNT_ID");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucketName) missing.push("R2_BUCKET_NAME");
  if (!publicBaseUrl) missing.push("R2_PUBLIC_BASE_URL");
  if (!endpoint) missing.push("R2_ENDPOINT");

  if (missing.length) {
    return { config: null, missing };
  }

  return {
    config: {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucketName,
      publicBaseUrl,
      endpoint,
    },
    missing: [],
  };
};

let storageWarningShown = false;
let uploadWarningShown = false;

const resolveStorageProvider = (): { provider: ImageStorageProvider; config: R2Config | null } => {
  const requestedProvider = resolveRequestedProvider();
  if (requestedProvider === "local") {
    return { provider: "local", config: null };
  }

  const { config, missing } = resolveR2Config();
  if (config) {
    return { provider: "r2", config };
  }

  if (isProductionRuntime()) {
    throw new Error(`Missing required R2 environment variables: ${missing.join(", ")}`);
  }

  if (!storageWarningShown) {
    storageWarningShown = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[image-storage] IMAGE_STORAGE_PROVIDER=r2 but configuration is incomplete (${missing.join(
        ", ",
      )}); falling back to local storage`,
    );
  }

  return { provider: "local", config: null };
};

const warnUploadFailure = (error: unknown) => {
  if (uploadWarningShown) {
    return;
  }
  uploadWarningShown = true;
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.warn(`[image-storage] upload failed; using source URL fallback (${message})`);
};

let r2Client: S3Client | null = null;

const getR2Client = (config: R2Config) => {
  if (r2Client) {
    return r2Client;
  }

  r2Client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return r2Client;
};

const detectImageExtension = (contentType: string | null, sourceUrl?: string) => {
  const normalizedType = contentType?.toLowerCase().split(";")[0]?.trim();
  if (normalizedType === "image/png") {
    return "png";
  }
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") {
    return "jpg";
  }
  if (normalizedType === "image/webp") {
    return "webp";
  }
  if (normalizedType === "image/avif") {
    return "avif";
  }
  if (normalizedType === "image/heic") {
    return "heic";
  }
  if (normalizedType === "image/heif") {
    return "heif";
  }
  if (normalizedType === "image/gif") {
    return "gif";
  }
  if (normalizedType === "image/bmp") {
    return "bmp";
  }
  if (normalizedType === "image/tiff") {
    return "tiff";
  }
  if (normalizedType === "image/svg+xml") {
    return "svg";
  }
  if (sourceUrl) {
    try {
      const ext = extname(new URL(sourceUrl).pathname).toLowerCase().replace(".", "");
      if (
        [
          "png",
          "jpg",
          "jpeg",
          "webp",
          "avif",
          "heic",
          "heif",
          "gif",
          "bmp",
          "tif",
          "tiff",
          "svg",
        ].includes(ext)
      ) {
        return ext === "jpeg" ? "jpg" : ext;
      }
    } catch {
      // ignore
    }
  }
  return "jpg";
};

const toManagedLocalUrl = (organizationId: string, fileName: string, productId?: string | null) =>
  `/uploads/imported-products/${normalizeOrgPath(organizationId)}/products/${normalizeProductPath(
    productId,
  )}/${fileName}`;

const toManagedR2Url = (config: R2Config, objectKey: string) => {
  const base = config.publicBaseUrl.endsWith("/")
    ? config.publicBaseUrl
    : `${config.publicBaseUrl}/`;
  return new URL(objectKey, base).toString();
};

const getObjectKey = (organizationId: string, fileName: string, productId?: string | null) =>
  `retails/${normalizeOrgPath(organizationId)}/products/${normalizeProductPath(productId)}/${fileName}`;

const uploadBufferToStorage = async (input: {
  organizationId: string;
  productId?: string | null;
  buffer: Buffer;
  contentType: string;
  sourceUrl?: string;
}) => {
  const extension = detectImageExtension(input.contentType, input.sourceUrl);
  const hash = createHash("sha1").update(input.buffer).digest("hex");
  const fileName = `${hash}.${extension}`;
  const storage = resolveStorageProvider();

  if (storage.provider === "r2" && storage.config) {
    const objectKey = getObjectKey(input.organizationId, fileName, input.productId);
    const client = getR2Client(storage.config);
    await client.send(
      new PutObjectCommand({
        Bucket: storage.config.bucketName,
        Key: objectKey,
        Body: input.buffer,
        ContentType: input.contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return {
      url: toManagedR2Url(storage.config, objectKey),
      managed: true,
    };
  }

  const orgDir = join(
    localImageRootDir,
    normalizeOrgPath(input.organizationId),
    "products",
    normalizeProductPath(input.productId),
  );
  await mkdir(orgDir, { recursive: true });
  await writeFile(join(orgDir, fileName), input.buffer);
  return {
    url: toManagedLocalUrl(input.organizationId, fileName, input.productId),
    managed: true,
  };
};

const parseDataImage = (value: string) => {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const contentType = match[1].toLowerCase();
  if (!contentType.startsWith("image/")) {
    return null;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2], "base64");
  } catch {
    return null;
  }

  if (!buffer.length || buffer.length > maxImageBytes) {
    return null;
  }

  return { buffer, contentType };
};

const isPrivateIPv4 = (address: string) => {
  const [a, b] = address.split(".").map((part) => Number(part));
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return true;
  }
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  return false;
};

const isPrivateIPv6 = (address: string) => {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80")
  );
};

const isBlockedIpAddress = (address: string) => {
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIPv4(address);
  }
  if (version === 6) {
    return isPrivateIPv6(address);
  }
  return true;
};

const isBlockedHostName = (hostName: string) => {
  const normalized = hostName.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
};

const isRemoteHostAllowed = async (hostName: string) => {
  const cached = remoteHostAllowCache.get(hostName);
  if (cached !== undefined) {
    return cached;
  }

  if (isBlockedHostName(hostName)) {
    remoteHostAllowCache.set(hostName, false);
    return false;
  }

  if (isIP(hostName)) {
    const allowed = !isBlockedIpAddress(hostName);
    remoteHostAllowCache.set(hostName, allowed);
    return allowed;
  }

  try {
    const records = await lookup(hostName, { all: true, verbatim: true });
    if (!records.length) {
      remoteHostAllowCache.set(hostName, false);
      return false;
    }
    const allowed = records.every((record) => !isBlockedIpAddress(record.address));
    remoteHostAllowCache.set(hostName, allowed);
    return allowed;
  } catch {
    remoteHostAllowCache.set(hostName, false);
    return false;
  }
};

const downloadRemoteImage = async (url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostAllowed = await isRemoteHostAllowed(parsed.hostname);
  if (!hostAllowed) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remoteImageFetchTimeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxImageBytes) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxImageBytes) {
      return null;
    }

    return {
      buffer,
      contentType,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const getManagedUrlPrefixes = () => {
  const prefixes = ["/uploads/imported-products/"];
  const { config } = resolveR2Config();
  if (config?.publicBaseUrl) {
    prefixes.push(config.publicBaseUrl.replace(/\/+$/, ""));
  }
  return prefixes;
};

export const isManagedProductImageUrl = (url: string) => {
  const value = url.trim();
  if (!value) {
    return false;
  }
  const prefixes = getManagedUrlPrefixes();
  return prefixes.some((prefix) => value.startsWith(prefix));
};

const isUnassignedManagedProductImageUrl = (url: string) =>
  url.includes("/products/unassigned/");

export const normalizeProductImageUrl = (value?: string | null) => {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  let candidate = extractHyperlinkTarget(normalized);
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else if (/^www\./i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  if (candidate.startsWith("data:image/")) {
    return candidate;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return candidate;
    }
    return null;
  } catch {
    if (isManagedProductImageUrl(candidate)) {
      return candidate;
    }
    return null;
  }
};

export type ResolveProductImageUrlResult = {
  url: string | null;
  managed: boolean;
};

export const resolveProductImageUrl = async (input: {
  value?: string | null;
  organizationId: string;
  productId?: string | null;
  cache?: Map<string, ResolveProductImageUrlResult>;
}) => {
  const normalized = normalizeProductImageUrl(input.value);
  if (!normalized) {
    return { url: null, managed: false } as ResolveProductImageUrlResult;
  }

  const cached = input.cache?.get(normalized);
  if (cached) {
    return cached;
  }

  const shouldRehomeUnassignedManagedImage =
    Boolean(input.productId) && isUnassignedManagedProductImageUrl(normalized);

  if (isManagedProductImageUrl(normalized) && !shouldRehomeUnassignedManagedImage) {
    const result = { url: normalized, managed: true } as ResolveProductImageUrlResult;
    input.cache?.set(normalized, result);
    return result;
  }

  if (normalized.startsWith("data:image/")) {
    const parsed = parseDataImage(normalized);
    if (!parsed) {
      const result = { url: null, managed: false } as ResolveProductImageUrlResult;
      input.cache?.set(normalized, result);
      return result;
    }
    try {
      const uploaded = await uploadBufferToStorage({
        organizationId: input.organizationId,
        productId: input.productId,
        buffer: parsed.buffer,
        contentType: parsed.contentType,
      });
      input.cache?.set(normalized, uploaded);
      return uploaded;
    } catch (error) {
      warnUploadFailure(error);
      const result = { url: null, managed: false } as ResolveProductImageUrlResult;
      input.cache?.set(normalized, result);
      return result;
    }
  }

  const downloaded = await downloadRemoteImage(normalized);
  if (!downloaded) {
    const result = { url: normalized, managed: false } as ResolveProductImageUrlResult;
    input.cache?.set(normalized, result);
    return result;
  }

  try {
    const uploaded = await uploadBufferToStorage({
      organizationId: input.organizationId,
      productId: input.productId,
      buffer: downloaded.buffer,
      contentType: downloaded.contentType,
      sourceUrl: normalized,
    });
    input.cache?.set(normalized, uploaded);
    return uploaded;
  } catch (error) {
    warnUploadFailure(error);
    const result = { url: normalized, managed: false } as ResolveProductImageUrlResult;
    input.cache?.set(normalized, result);
    return result;
  }
};

export const uploadProductImageBuffer = async (input: {
  organizationId: string;
  productId?: string | null;
  buffer: Buffer;
  contentType: string;
  sourceFileName?: string;
}) => {
  if (!input.organizationId) {
    throw new Error("forbidden");
  }
  if (!input.contentType.toLowerCase().startsWith("image/")) {
    throw new Error("imageInvalidType");
  }
  if (!input.buffer.length || input.buffer.length > maxImageBytes) {
    throw new Error("imageTooLarge");
  }

  return uploadBufferToStorage({
    organizationId: input.organizationId,
    productId: input.productId,
    buffer: input.buffer,
    contentType: input.contentType,
    sourceUrl: input.sourceFileName ? `https://upload.local/${input.sourceFileName}` : undefined,
  });
};

export const assertProductImageStorageConfigured = () => {
  if (resolveRequestedProvider() !== "r2") {
    return;
  }

  const { missing } = resolveR2Config();
  if (!missing.length) {
    return;
  }

  throw new Error(`Missing required R2 environment variables: ${missing.join(", ")}`);
};
