import { getServerAuthToken } from "@/server/auth/token";
import {
  downloadRemoteImage,
  readManagedLocalProductImage,
} from "@/server/services/productImageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeImageMimeType = (value: string) => {
  const normalized = value.toLowerCase().split(";")[0]?.trim() ?? "";
  if (normalized === "image/jpg" || normalized === "image/pjpeg") {
    return "image/jpeg";
  }
  if (normalized === "image/heic-sequence" || normalized === "image/x-heic") {
    return "image/heic";
  }
  if (normalized === "image/heics" || normalized === "image/x-heics") {
    return "image/heic";
  }
  if (normalized === "image/heif-sequence" || normalized === "image/x-heif") {
    return "image/heif";
  }
  if (normalized === "image/heifs" || normalized === "image/x-heifs") {
    return "image/heif";
  }
  return normalized;
};

const resolveImageMimeTypeByExtension = (extension: string) => {
  const normalized = extension.toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") {
    return "image/jpeg";
  }
  if (normalized === "png") {
    return "image/png";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  if (normalized === "avif") {
    return "image/avif";
  }
  if (normalized === "gif") {
    return "image/gif";
  }
  if (normalized === "bmp") {
    return "image/bmp";
  }
  if (normalized === "tif" || normalized === "tiff") {
    return "image/tiff";
  }
  if (normalized === "heic" || normalized === "heics") {
    return "image/heic";
  }
  if (normalized === "heif" || normalized === "heifs" || normalized === "hif") {
    return "image/heif";
  }
  return "";
};

const resolveMimeTypeFromUrl = (sourceUrl: string) => {
  try {
    const parsed = new URL(sourceUrl);
    const rawExt = parsed.pathname.split(".").pop()?.trim().toLowerCase() ?? "";
    if (!rawExt) {
      return "";
    }
    return resolveImageMimeTypeByExtension(rawExt);
  } catch {
    return "";
  }
};

const inferImageMimeTypeFromBytes = (bytes: Uint8Array) => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  return "";
};

const normalizeOrgPath = (organizationId: string) =>
  organizationId.replace(/[^a-zA-Z0-9_-]/g, "").trim() || "default";

type ManagedSource =
  | { kind: "local"; url: string }
  | {
      kind: "remote";
      url: string;
      policy: { allowedOrigin: string; allowedPathPrefix: string };
    };

const safeManagedPathSegmentPattern = /^[A-Za-z0-9._-]+$/;

const encodeManagedPath = (pathname: string) => {
  if (!pathname.startsWith("/") || pathname.includes("//")) {
    return null;
  }

  const rawSegments = pathname.split("/");
  const encodedSegments: string[] = [];
  for (const [index, rawSegment] of rawSegments.entries()) {
    if (!rawSegment) {
      if (index === 0 || index === rawSegments.length - 1) {
        encodedSegments.push("");
        continue;
      }
      return null;
    }

    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (
      segment === "." ||
      segment === ".." ||
      segment.includes("%") ||
      !safeManagedPathSegmentPattern.test(segment)
    ) {
      return null;
    }
    encodedSegments.push(encodeURIComponent(segment));
  }

  return encodedSegments.join("/");
};

const resolveManagedSource = (
  rawSourceUrl: string,
  requestUrl: URL,
  organizationId: string,
): ManagedSource | null => {
  const sourceUrl = rawSourceUrl.trim();
  if (!sourceUrl) {
    return null;
  }

  const r2Base = process.env.R2_PUBLIC_BASE_URL?.trim();
  let parsed: URL;
  try {
    parsed =
      r2Base && (sourceUrl.startsWith("retails/") || sourceUrl.startsWith("/retails/"))
        ? new URL(sourceUrl.replace(/^\/+/, ""), `${r2Base.replace(/\/+$/, "")}/`)
        : new URL(sourceUrl, requestUrl.origin);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  const normalizedOrganizationId = normalizeOrgPath(organizationId);
  const localPrefixes = [
    `/uploads/imported-products/${normalizedOrganizationId}/`,
    `/uploads/product-images/${normalizedOrganizationId}/`,
  ];
  if (localPrefixes.some((prefix) => parsed.pathname.startsWith(prefix))) {
    const configuredAppOrigins = [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => {
        try {
          return [new URL(value).origin];
        } catch {
          return [];
        }
      });
    if (
      sourceUrl.startsWith("/") ||
      parsed.origin === requestUrl.origin ||
      configuredAppOrigins.includes(parsed.origin)
    ) {
      return { kind: "local", url: parsed.toString() };
    }
  }

  if (r2Base) {
    try {
      const configuredR2Base = new URL(`${r2Base.replace(/\/+$/, "")}/`);
      if (
        (configuredR2Base.protocol !== "http:" && configuredR2Base.protocol !== "https:") ||
        configuredR2Base.port ||
        configuredR2Base.username ||
        configuredR2Base.password ||
        parsed.search ||
        parsed.hash
      ) {
        return null;
      }
      const configuredBasePath = encodeManagedPath(configuredR2Base.pathname);
      const safePath = encodeManagedPath(parsed.pathname);
      if (!configuredBasePath || !safePath) {
        return null;
      }
      const basePathPrefix = configuredBasePath.endsWith("/")
        ? configuredBasePath
        : `${configuredBasePath}/`;
      const r2OrgPrefix = `${basePathPrefix}retails/${encodeURIComponent(normalizedOrganizationId)}/`;
      if (parsed.origin === configuredR2Base.origin && safePath.startsWith(r2OrgPrefix)) {
        return {
          kind: "remote",
          url: `${configuredR2Base.origin}${safePath}`,
          policy: {
            allowedOrigin: configuredR2Base.origin,
            allowedPathPrefix: r2OrgPrefix,
          },
        };
      }
    } catch {
      return null;
    }
  }

  return null;
};

export const GET = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token) {
    return Response.json({ message: "unauthorized" }, { status: 401 });
  }
  if (!token.organizationId || (token.role !== "ADMIN" && token.role !== "MANAGER")) {
    return Response.json({ message: "forbidden" }, { status: 403 });
  }

  const requestUrl = new URL(request.url);
  const rawSourceUrl = requestUrl.searchParams.get("url");
  if (!rawSourceUrl) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  const managedSource = resolveManagedSource(rawSourceUrl, requestUrl, token.organizationId);
  if (!managedSource) {
    return Response.json({ message: "forbidden" }, { status: 403 });
  }

  try {
    const source =
      managedSource.kind === "local"
        ? await readManagedLocalProductImage({
            url: managedSource.url,
            organizationId: token.organizationId,
          })
        : await downloadRemoteImage(managedSource.url, managedSource.policy);
    if (!source) {
      return Response.json({ message: "imageReadFailed" }, { status: 502 });
    }

    if (!source.buffer.byteLength) {
      return Response.json({ message: "imageReadFailed" }, { status: 400 });
    }

    const byHeader = normalizeImageMimeType(source.contentType);
    const byUrl = normalizeImageMimeType(resolveMimeTypeFromUrl(managedSource.url));
    const byBytes = inferImageMimeTypeFromBytes(new Uint8Array(source.buffer.subarray(0, 16)));
    const contentType = byHeader.startsWith("image/")
      ? byHeader
      : byUrl.startsWith("image/")
        ? byUrl
        : byBytes
          ? byBytes
          : "";
    if (!contentType || contentType === "image/svg+xml") {
      return Response.json({ message: "imageInvalidType" }, { status: 400 });
    }

    return new Response(new Uint8Array(source.buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch {
    return Response.json({ message: "imageReadFailed" }, { status: 500 });
  }
};
