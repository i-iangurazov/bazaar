import sharp from "sharp";

import { isManagedProductImageUrl } from "@/server/services/productImageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
const DEFAULT_WIDTH = 720;
const DEFAULT_QUALITY = 78;
const MIN_WIDTH = 120;
const MAX_WIDTH = 1440;
const MIN_QUALITY = 45;
const MAX_QUALITY = 90;

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

const normalizeImageMimeType = (value: string) => value.toLowerCase().split(";")[0]?.trim() ?? "";

const isTransformableMimeType = (mimeType: string) =>
  mimeType.startsWith("image/") && mimeType !== "image/svg+xml" && mimeType !== "image/gif";

export const GET = async (request: Request) => {
  const requestUrl = new URL(request.url);
  const rawSourceUrl = requestUrl.searchParams.get("url");
  if (!rawSourceUrl) {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  const sourceUrl = resolveManagedSourceUrl(rawSourceUrl, requestUrl);
  if (!sourceUrl) {
    return Response.json({ message: "catalogNotFound" }, { status: 404 });
  }

  const width = parseWidth(requestUrl.searchParams.get("w"));
  const quality = parseQuality(requestUrl.searchParams.get("q"));

  try {
    const sourceResponse = await fetch(sourceUrl, {
      cache: "force-cache",
      next: { revalidate: 86_400 },
    });
    if (!sourceResponse.ok) {
      return Response.json({ message: "imageReadFailed" }, { status: 502 });
    }

    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer());
    if (!sourceBuffer.length) {
      return Response.json({ message: "imageReadFailed" }, { status: 502 });
    }

    const sourceMimeType = normalizeImageMimeType(sourceResponse.headers.get("content-type") ?? "");
    if (!isTransformableMimeType(sourceMimeType)) {
      return new Response(new Uint8Array(sourceBuffer), {
        status: 200,
        headers: {
          "Content-Type": sourceMimeType || "application/octet-stream",
          "Cache-Control": CACHE_CONTROL,
        },
      });
    }

    const outputBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width,
        withoutEnlargement: true,
      })
      .webp({
        quality,
        effort: 4,
      })
      .toBuffer();

    return new Response(new Uint8Array(outputBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  } catch {
    return Response.json({ message: "imageReadFailed" }, { status: 500 });
  }
};
