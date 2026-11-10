import { getServerAuthToken } from "@/server/auth/token";
import {
  fetchPublicProductImage,
  parseProductImageHttpUrl,
  readLocalProductImage,
} from "@/server/services/productImageFetch";

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

const resolveManagedSourceUrl = (rawSourceUrl: string, requestUrl: URL) => {
  const sourceUrl = rawSourceUrl.trim();
  if (!sourceUrl) {
    return null;
  }

  const appUrls = [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]
    .filter((value): value is string => Boolean(value))
    .map((value) => parseProductImageHttpUrl(value))
    .filter((value): value is URL => Boolean(value));
  if (!appUrls.length && process.env.NODE_ENV !== "production") {
    appUrls.push(new URL(requestUrl.origin));
  }
  const configuredR2Url = process.env.R2_PUBLIC_BASE_URL
    ? parseProductImageHttpUrl(process.env.R2_PUBLIC_BASE_URL)
    : null;
  const r2Url = configuredR2Url && !configuredR2Url.port ? configuredR2Url : null;
  const r2Prefix = r2Url ? `${r2Url.pathname.replace(/\/+$/, "")}/` : null;
  const localPaths = ["/uploads/imported-products/", "/uploads/product-images/"];
  const allowUrl = (url: URL) => {
    if (url.username || url.password) return false;
    return (
      appUrls.some((app) => app.origin === url.origin) &&
      localPaths.some((prefix) => url.pathname.startsWith(prefix))
    ) || Boolean(r2Url && r2Prefix && r2Url.origin === url.origin && url.pathname.startsWith(r2Prefix));
  };
  const isRetailPath = sourceUrl.startsWith("/retails/") || sourceUrl.startsWith("retails/");
  const parsed = isRetailPath
    ? r2Url && parseProductImageHttpUrl(sourceUrl.replace(/^\/+/, ""), new URL(r2Prefix ?? "/", r2Url))
    : parseProductImageHttpUrl(sourceUrl, appUrls[0] ?? new URL(requestUrl.origin));
  if (!parsed || !allowUrl(parsed)) return null;
  return {
    url: parsed,
    allowUrl,
    isLocalUpload: appUrls.some((app) => app.origin === parsed.origin) && localPaths.some((prefix) => parsed.pathname.startsWith(prefix)),
  };
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

  const managedSourceUrl = resolveManagedSourceUrl(rawSourceUrl, requestUrl);
  if (!managedSourceUrl) {
    return Response.json({ message: "forbidden" }, { status: 403 });
  }

  try {
    const configuredMaxBytes = Number(process.env.PRODUCT_IMAGE_MAX_BYTES);
    const maxBytes = Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0
      ? configuredMaxBytes
      : 5 * 1024 * 1024;
    const image = (
      managedSourceUrl.isLocalUpload
        ? await readLocalProductImage(managedSourceUrl.url.pathname, maxBytes)
        : null
    ) ?? await fetchPublicProductImage(managedSourceUrl.url.toString(), {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      maxBytes,
      allowUrl: managedSourceUrl.allowUrl,
    });
    if (!image) {
      return Response.json({ message: "imageReadFailed" }, { status: 502 });
    }

    const body = new Uint8Array(image.buffer);
    if (!body.byteLength) {
      return Response.json({ message: "imageReadFailed" }, { status: 400 });
    }

    const byHeader = normalizeImageMimeType(image.contentType);
    const byUrl = normalizeImageMimeType(resolveMimeTypeFromUrl(managedSourceUrl.url.toString()));
    const byBytes = inferImageMimeTypeFromBytes(new Uint8Array(body.slice(0, 16)));
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

    return new Response(body, {
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
