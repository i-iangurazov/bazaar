import { getServerAuthToken } from "@/server/auth/token";
import { isManagedProductImageUrl } from "@/server/services/productImageStorage";

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
  if (normalized === "svg") {
    return "image/svg+xml";
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

const resolveManagedSourceUrl = (rawSourceUrl: string, requestUrl: URL) => {
  const sourceUrl = rawSourceUrl.trim();
  if (!sourceUrl) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl, requestUrl.origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const managedCandidatePath = `${parsed.pathname}${parsed.search}`;
  const isManaged =
    isManagedProductImageUrl(sourceUrl) ||
    isManagedProductImageUrl(parsed.toString()) ||
    isManagedProductImageUrl(managedCandidatePath) ||
    isManagedProductImageUrl(parsed.pathname);
  if (!isManaged) {
    return null;
  }

  return parsed.toString();
};

export const GET = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token) {
    return Response.json({ message: "unauthorized" }, { status: 401 });
  }
  if (!token.organizationId || token.role !== "ADMIN") {
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
    const sourceResponse = await fetch(managedSourceUrl, { cache: "no-store" });
    if (!sourceResponse.ok) {
      return Response.json({ message: "imageReadFailed" }, { status: 502 });
    }

    const body = await sourceResponse.arrayBuffer();
    if (!body.byteLength) {
      return Response.json({ message: "imageReadFailed" }, { status: 400 });
    }

    const byHeader = normalizeImageMimeType(sourceResponse.headers.get("content-type") ?? "");
    const byUrl = normalizeImageMimeType(resolveMimeTypeFromUrl(managedSourceUrl));
    const contentType = byHeader.startsWith("image/")
      ? byHeader
      : byUrl.startsWith("image/")
        ? byUrl
        : "";
    if (!contentType) {
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
