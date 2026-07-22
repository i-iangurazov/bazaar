import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

import { transformCatalogImageToWebp } from "@/server/services/catalogImageTransform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
const DEFAULT_WIDTH = 720;
const DEFAULT_QUALITY = 78;
const DEFAULT_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 4_000;
const MIN_WIDTH = 120;
const MAX_WIDTH = 1440;
const MIN_QUALITY = 45;
const MAX_QUALITY = 90;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MANAGED_LOCAL_PATHS = ["/uploads/imported-products/", "/uploads/product-images/"];

const blockedIPv4Addresses = new BlockList();
const blockedIPv6Addresses = new BlockList();
const blockedSubnets: Array<[string, number, "ipv4" | "ipv6"]> = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.88.99.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["::ffff:0:0", 96, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["64:ff9b:1::", 48, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001::", 32, "ipv6"],
  ["2001:10::", 28, "ipv6"],
  ["2001:20::", 28, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["2002::", 16, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
];
for (const [network, prefix, family] of blockedSubnets) {
  if (family === "ipv4") {
    blockedIPv4Addresses.addSubnet(network, prefix, family);
  } else {
    blockedIPv6Addresses.addSubnet(network, prefix, family);
  }
}

class CatalogImageProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type AllowedSource = {
  origin: string;
  pathPrefixes: string[];
};

const parseWidth = (value: string | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WIDTH;
  }
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.trunc(parsed)));
};

const parseQuality = (value: string | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_QUALITY;
  }
  return Math.max(MIN_QUALITY, Math.min(MAX_QUALITY, Math.trunc(parsed)));
};

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizePathPrefix = (pathname: string) => {
  const normalized = pathname.replace(/\/{2,}/g, "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

const parseConfiguredHttpUrl = (value: string | undefined) => {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const getAllowedSources = () => {
  const sources = new Map<string, Set<string>>();
  const addSource = (url: URL, pathPrefixes: string[]) => {
    const existing = sources.get(url.origin) ?? new Set<string>();
    pathPrefixes.forEach((prefix) => existing.add(normalizePathPrefix(prefix)));
    sources.set(url.origin, existing);
  };

  const appUrl =
    parseConfiguredHttpUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    parseConfiguredHttpUrl(process.env.NEXTAUTH_URL);
  if (appUrl) {
    addSource(appUrl, MANAGED_LOCAL_PATHS);
  }

  const r2PublicUrl = parseConfiguredHttpUrl(process.env.R2_PUBLIC_BASE_URL);
  if (r2PublicUrl) {
    addSource(r2PublicUrl, [normalizePathPrefix(r2PublicUrl.pathname)]);
  }

  return {
    appUrl,
    sources: Array.from(sources, ([origin, pathPrefixes]) => ({
      origin,
      pathPrefixes: Array.from(pathPrefixes),
    })),
  };
};

const hasAllowedPath = (source: AllowedSource, pathname: string) =>
  source.pathPrefixes.some((prefix) => pathname.startsWith(prefix));

const resolveAllowedManagedUrl = (rawSourceUrl: string, relativeTo?: URL) => {
  const sourceUrl = rawSourceUrl.trim();
  if (!sourceUrl) {
    return null;
  }

  const { appUrl, sources } = getAllowedSources();
  let parsed: URL;
  try {
    if (relativeTo) {
      parsed = new URL(sourceUrl, relativeTo);
    } else if (sourceUrl.startsWith("/")) {
      if (!appUrl) {
        return null;
      }
      parsed = new URL(sourceUrl, appUrl);
    } else {
      parsed = new URL(sourceUrl);
    }
  } catch {
    return null;
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  const allowedSource = sources.find((source) => source.origin === parsed.origin);
  if (!allowedSource || !hasAllowedPath(allowedSource, parsed.pathname)) {
    return null;
  }
  return parsed;
};

const normalizeHostName = (hostName: string) =>
  hostName.startsWith("[") && hostName.endsWith("]") ? hostName.slice(1, -1) : hostName;

const isBlockedHostName = (hostName: string) => {
  const normalized = normalizeHostName(hostName).toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
};

const isBlockedIpAddress = (address: string) => {
  const normalized = normalizeHostName(address);
  const version = isIP(normalized);
  if (version === 4) {
    return blockedIPv4Addresses.check(normalized, "ipv4");
  }
  if (version === 6) {
    return blockedIPv6Addresses.check(normalized, "ipv6");
  }
  return true;
};

const raceWithAbort = async <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) {
    throw new CatalogImageProxyError(504, "imageReadTimeout");
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(new CatalogImageProxyError(504, "imageReadTimeout"));
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
};

const assertPublicHost = async (hostName: string, signal: AbortSignal) => {
  const normalizedHost = normalizeHostName(hostName);
  if (isBlockedHostName(normalizedHost)) {
    throw new CatalogImageProxyError(404, "catalogNotFound");
  }

  if (isIP(normalizedHost)) {
    if (isBlockedIpAddress(normalizedHost)) {
      throw new CatalogImageProxyError(404, "catalogNotFound");
    }
    return;
  }

  let records: LookupAddress[];
  try {
    records = await raceWithAbort(
      lookup(normalizedHost, { all: true, verbatim: true }),
      signal,
    );
  } catch (error) {
    if (error instanceof CatalogImageProxyError) {
      throw error;
    }
    throw new CatalogImageProxyError(502, "imageReadFailed");
  }
  if (!records.length || records.some((record) => isBlockedIpAddress(record.address))) {
    throw new CatalogImageProxyError(404, "catalogNotFound");
  }
};

const fetchAllowedImage = async (sourceUrl: URL, signal: AbortSignal) => {
  let currentUrl = sourceUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHost(currentUrl.hostname, signal);
    let response: Response;
    try {
      response = await fetch(currentUrl.toString(), {
        cache: "force-cache",
        next: { revalidate: 86_400 },
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new CatalogImageProxyError(504, "imageReadTimeout");
      }
      throw error;
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }
    if (redirectCount >= MAX_REDIRECTS) {
      throw new CatalogImageProxyError(502, "imageReadFailed");
    }

    const location = response.headers.get("location");
    const redirectUrl = location ? resolveAllowedManagedUrl(location, currentUrl) : null;
    if (!redirectUrl) {
      throw new CatalogImageProxyError(404, "catalogNotFound");
    }
    currentUrl = redirectUrl;
  }
  throw new CatalogImageProxyError(502, "imageReadFailed");
};

const normalizeImageMimeType = (value: string) => value.toLowerCase().split(";")[0]?.trim() ?? "";

const isAllowedImageMimeType = (mimeType: string) =>
  mimeType.startsWith("image/") && mimeType !== "image/svg+xml";

const isTransformableMimeType = (mimeType: string) =>
  isAllowedImageMimeType(mimeType) && mimeType !== "image/gif";

const readLimitedBody = async (response: Response, maxBytes: number, signal: AbortSignal) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new CatalogImageProxyError(413, "imageTooLarge");
  }
  if (!response.body) {
    throw new CatalogImageProxyError(502, "imageReadFailed");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await raceWithAbort(reader.read(), signal);
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw new CatalogImageProxyError(413, "imageTooLarge");
    }
    chunks.push(Buffer.from(value));
  }
  if (!totalBytes) {
    throw new CatalogImageProxyError(502, "imageReadFailed");
  }
  return Buffer.concat(chunks, totalBytes);
};

export const GET = async (request: Request) => {
  const requestUrl = new URL(request.url);
  const rawSourceUrl = requestUrl.searchParams.get("url");
  if (!rawSourceUrl) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  const sourceUrl = resolveAllowedManagedUrl(rawSourceUrl);
  if (!sourceUrl) {
    return Response.json({ message: "catalogNotFound" }, { status: 404 });
  }

  const width = parseWidth(requestUrl.searchParams.get("w"));
  const quality = parseQuality(requestUrl.searchParams.get("q"));
  const maxBytes = parsePositiveInt(process.env.PRODUCT_IMAGE_MAX_BYTES, DEFAULT_MAX_SOURCE_BYTES);
  const timeoutMs = parsePositiveInt(
    process.env.PRODUCT_IMAGE_FETCH_TIMEOUT_MS,
    DEFAULT_FETCH_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const sourceResponse = await fetchAllowedImage(sourceUrl, controller.signal);
    if (!sourceResponse.ok) {
      throw new CatalogImageProxyError(502, "imageReadFailed");
    }

    const sourceMimeType = normalizeImageMimeType(
      sourceResponse.headers.get("content-type") ?? "",
    );
    if (!isAllowedImageMimeType(sourceMimeType)) {
      throw new CatalogImageProxyError(415, "imageInvalidType");
    }

    const sourceBuffer = await readLimitedBody(sourceResponse, maxBytes, controller.signal);
    clearTimeout(timeout);

    if (!isTransformableMimeType(sourceMimeType)) {
      return new Response(new Uint8Array(sourceBuffer), {
        status: 200,
        headers: {
          "Content-Type": sourceMimeType,
          "Cache-Control": CACHE_CONTROL,
        },
      });
    }

    const outputBuffer = await transformCatalogImageToWebp({
      sourceBuffer,
      width,
      quality,
      sourceMimeType,
    });

    return new Response(new Uint8Array(outputBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  } catch (error) {
    const proxyError =
      error instanceof CatalogImageProxyError
        ? error
        : controller.signal.aborted
          ? new CatalogImageProxyError(504, "imageReadTimeout")
          : new CatalogImageProxyError(502, "imageReadFailed");
    return Response.json({ message: proxyError.code }, { status: proxyError.status });
  } finally {
    clearTimeout(timeout);
  }
};
