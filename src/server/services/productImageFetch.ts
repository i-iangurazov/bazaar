import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { readFile, realpath, stat } from "node:fs/promises";
import { request as requestHttp, type IncomingMessage } from "node:http";
import { request as requestHttps } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { resolve, sep } from "node:path";

const redirects = new Set([301, 302, 303, 307, 308]);
const blockedIPv4Addresses = new BlockList();
const blockedIPv6Addresses = new BlockList();
// Keep the same non-public ranges as the public catalogue image proxy.
const blockedNetworks: Array<[string, number, "ipv4" | "ipv6"]> = [
  ["0.0.0.0", 8, "ipv4"], ["10.0.0.0", 8, "ipv4"], ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"], ["169.254.0.0", 16, "ipv4"], ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"], ["192.0.2.0", 24, "ipv4"], ["192.88.99.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"], ["198.18.0.0", 15, "ipv4"], ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"], ["224.0.0.0", 4, "ipv4"], ["240.0.0.0", 4, "ipv4"],
  ["::", 96, "ipv6"], ["::1", 128, "ipv6"], ["::ffff:0:0", 96, "ipv6"],
  ["64:ff9b::", 96, "ipv6"], ["64:ff9b:1::", 48, "ipv6"], ["100::", 64, "ipv6"],
  ["100:0:0:1::", 64, "ipv6"], ["2001::", 32, "ipv6"], ["2001:2::", 48, "ipv6"],
  ["2001:10::", 28, "ipv6"], ["2001:20::", 28, "ipv6"], ["2001:db8::", 32, "ipv6"],
  ["2002::", 16, "ipv6"], ["3fff::", 20, "ipv6"], ["5f00::", 16, "ipv6"], ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"], ["fec0::", 10, "ipv6"], ["ff00::", 8, "ipv6"],
];
blockedNetworks.forEach(([address, prefix, family]) => {
  (family === "ipv4" ? blockedIPv4Addresses : blockedIPv6Addresses).addSubnet(address, prefix, family);
});

const normalizeHostname = (value: string) => value.replace(/^\[|\]$/g, "").toLowerCase();
const isPublicAddress = (address: string) => {
  const family = isIP(normalizeHostname(address));
  return family === 4
    ? !blockedIPv4Addresses.check(normalizeHostname(address), "ipv4")
    : family === 6 && !blockedIPv6Addresses.check(normalizeHostname(address), "ipv6");
};

export const parseProductImageHttpUrl = (value: string, base?: URL) => {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
};

const withAbort = async <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => {
  signal.throwIfAborted();
  return new Promise<T>((resolveOperation, reject) => {
    const abort = () => reject(signal.reason ?? new Error("imageReadAborted"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolveOperation, reject).finally(() => signal.removeEventListener("abort", abort));
  });
};

const resolvePublicAddresses = async (url: URL, signal: AbortSignal) => {
  if (url.port) return null;
  const hostname = normalizeHostname(url.hostname);
  const normalized = hostname.replace(/\.$/, "");
  if (normalized === "localhost" || [".localhost", ".local", ".internal"].some((suffix) => normalized.endsWith(suffix))) return null;
  if (isIP(hostname)) return isPublicAddress(hostname) ? [{ address: hostname, family: isIP(hostname) }] : null;
  const records = await withAbort(lookup(hostname, { all: true, verbatim: true }), signal);
  return records.length && records.every(({ address }) => isPublicAddress(address)) ? records : null;
};

const requestPinnedImage = (url: URL, addresses: LookupAddress[], signal: AbortSignal) =>
  new Promise<IncomingMessage>((resolveResponse, reject) => {
    // The connection uses only this already validated snapshot. Native HTTP retains
    // the original hostname for Host, HTTPS SNI and certificate verification.
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
      const matching = family ? addresses.filter((entry) => entry.family === family) : addresses;
      if (!matching.length) {
        callback(new Error("imageHostNotAllowed"), "");
      } else if (options.all) {
        callback(null, matching);
      } else {
        callback(null, matching[0].address, matching[0].family);
      }
    };
    const request = (url.protocol === "https:" ? requestHttps : requestHttp)(url, {
      agent: false,
      lookup: pinnedLookup,
      signal,
    }, resolveResponse);
    request.once("error", reject);
    request.end();
  });

export type ProductImageBytes = { buffer: Buffer; contentType: string };

/** Reads public image sources without redirects or DNS changes escaping validation. */
export const fetchPublicProductImage = async (
  sourceUrl: string,
  options: { signal: AbortSignal; maxBytes: number; allowUrl?: (url: URL) => boolean },
): Promise<ProductImageBytes | null> => {
  if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0) return null;
  let url = parseProductImageHttpUrl(sourceUrl);
  for (let hop = 0; url && hop <= 3; hop += 1) {
    options.signal.throwIfAborted();
    if (options.allowUrl && !options.allowUrl(url)) return null;
    const addresses = await resolvePublicAddresses(url, options.signal);
    if (!addresses) return null;
    const response = await requestPinnedImage(url, addresses, options.signal);
    if (redirects.has(response.statusCode ?? 0)) {
      const next = response.headers.location;
      response.destroy();
      url = next && hop < 3 ? parseProductImageHttpUrl(next, url) : null;
      continue;
    }
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      response.destroy();
      return null;
    }
    const declaredLength = Number(response.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      response.destroy();
      return null;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response) {
      options.signal.throwIfAborted();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > options.maxBytes) {
        response.destroy();
        return null;
      }
      chunks.push(bytes);
    }
    return length ? { buffer: Buffer.concat(chunks, length), contentType: response.headers["content-type"] ?? "" } : null;
  }
  return null;
};

/** Local uploads remain readable without making loopback requests from the server. */
export const readLocalProductImage = async (sourcePath: string, maxBytes: number): Promise<ProductImageBytes | null> => {
  try {
    const url = new URL(sourcePath, "http://local-upload.invalid");
    if (url.origin !== "http://local-upload.invalid") return null;
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith("/uploads/") || pathname.includes("\\") || pathname.includes("\0")) return null;
    const root = resolve(process.cwd(), "public/uploads");
    const candidate = resolve(process.cwd(), "public", `.${pathname}`);
    if (!candidate.startsWith(root + sep)) return null;
    const [actualRoot, actualPath] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!actualPath.startsWith(actualRoot + sep)) return null;
    const file = await stat(actualPath);
    if (!file.isFile() || file.size < 1 || file.size > maxBytes) return null;
    const buffer = await readFile(actualPath);
    return buffer.length && buffer.length <= maxBytes ? { buffer, contentType: "" } : null;
  } catch {
    return null;
  }
};
