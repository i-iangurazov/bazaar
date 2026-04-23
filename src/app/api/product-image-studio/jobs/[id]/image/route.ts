import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { isManagedProductImageUrl } from "@/server/services/productImageStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: {
    id: string;
  };
};

const normalizeImageMimeType = (value: string) => value.toLowerCase().split(";")[0]?.trim() ?? "";

const resolveMimeTypeFromUrl = (sourceUrl: string) => {
  try {
    const parsed = new URL(sourceUrl, "https://local.invalid");
    const extension = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
    if (extension === "jpg" || extension === "jpeg") {
      return "image/jpeg";
    }
    if (extension === "png") {
      return "image/png";
    }
    if (extension === "webp") {
      return "image/webp";
    }
  } catch {
    return "";
  }
  return "";
};

const resolveManagedSourceUrl = (rawSourceUrl: string, requestUrl: URL) => {
  const sourceUrl = rawSourceUrl.trim();
  if (!sourceUrl) {
    return null;
  }

  try {
    const parsed = new URL(sourceUrl, requestUrl.origin);
    if (!isManagedProductImageUrl(sourceUrl) && !isManagedProductImageUrl(parsed.toString())) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

export const GET = async (request: Request, { params }: RouteParams) => {
  const token = await getServerAuthToken();
  if (!token?.organizationId) {
    return new Response(null, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const kind = requestUrl.searchParams.get("kind");
  if (kind !== "source" && kind !== "output") {
    return new Response(null, { status: 400 });
  }

  const job = await prisma.productImageStudioJob.findFirst({
    where: {
      id: params.id,
      organizationId: String(token.organizationId),
    },
    select: {
      sourceImageUrl: true,
      sourceImageMimeType: true,
      outputImageUrl: true,
      outputImageMimeType: true,
    },
  });

  const imageUrl = kind === "source" ? job?.sourceImageUrl : job?.outputImageUrl;
  const configuredMimeType =
    kind === "source" ? job?.sourceImageMimeType : job?.outputImageMimeType;
  if (!imageUrl) {
    return new Response(null, { status: 404 });
  }

  const managedSourceUrl = resolveManagedSourceUrl(imageUrl, requestUrl);
  if (!managedSourceUrl) {
    return new Response(null, { status: 403 });
  }

  try {
    const sourceResponse = await fetch(managedSourceUrl, { cache: "no-store" });
    if (!sourceResponse.ok) {
      return new Response(null, { status: 502 });
    }

    const body = await sourceResponse.arrayBuffer();
    if (!body.byteLength) {
      return new Response(null, { status: 404 });
    }

    const byHeader = normalizeImageMimeType(sourceResponse.headers.get("content-type") ?? "");
    const byConfigured = normalizeImageMimeType(configuredMimeType ?? "");
    const byUrl = normalizeImageMimeType(resolveMimeTypeFromUrl(managedSourceUrl));
    const contentType = byHeader.startsWith("image/")
      ? byHeader
      : byConfigured.startsWith("image/")
        ? byConfigured
        : byUrl.startsWith("image/")
          ? byUrl
          : "image/jpeg";

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
};
