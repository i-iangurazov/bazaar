import { join } from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";
import { exportProductImagesData } from "@/server/services/products/read";
import type { StoreAccessUser } from "@/server/services/storeAccess";
import { storeZipFile } from "@/lib/imageExportStore";
import { ImageExportZipWriter } from "@/server/services/imageExportZip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mimeToExt: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
};

const extToMime: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

const resolvePositiveByteLimit = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const maxImageBytes = resolvePositiveByteLimit(process.env.PRODUCT_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
const maxZipBytes = resolvePositiveByteLimit(
  process.env.IMAGE_EXPORT_MAX_BYTES,
  512 * 1024 * 1024,
);

const getExtension = (contentType: string, url: string): string => {
  const mime = contentType.split(";")[0]?.trim() ?? "";
  if (mimeToExt[mime]) return mimeToExt[mime]!;
  const match = url.split("?")[0].match(/\.\w{2,5}$/);
  return match?.[0] ?? ".jpg";
};

const sanitizeFolderName = (name: string) =>
  name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "product";

const fetchImageBuffer = async (
  url: string,
  appOrigin: string,
): Promise<{ buffer: Buffer; contentType: string } | null> => {
  if (url.startsWith("/uploads/")) {
    const filePath = join(process.cwd(), "public", url);
    try {
      const file = await stat(filePath);
      if (file.size < 1 || file.size > maxImageBytes) {
        return null;
      }
      const buffer = await readFile(filePath);
      const ext = url.split("?")[0].match(/\.\w{2,5}$/)?.[0] ?? "";
      return { buffer, contentType: extToMime[ext] ?? "image/jpeg" };
    } catch {
      return null;
    }
  }
  const absoluteUrl = url.startsWith("http") ? url : `${appOrigin}${url}`;
  const response = await fetch(absoluteUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const contentLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > maxImageBytes) {
    return null;
  }
  if (!response.body) {
    return null;
  }
  const chunks: Buffer[] = [];
  let byteLength = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxImageBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  const buffer = Buffer.concat(chunks, byteLength);
  if (!buffer.length) {
    return null;
  }
  const contentType = response.headers.get("Content-Type") ?? "";
  return { buffer, contentType };
};

export type ExportImagesEvent =
  | { type: "total"; count: number }
  | { type: "progress"; done: number; total: number; name: string }
  | { type: "zipping" }
  | { type: "ready"; token: string; filename: string }
  | { type: "error"; message: string };

export const GET = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token) return new Response("Unauthorized", { status: 401 });

  const { searchParams, origin: appOrigin } = new URL(request.url);
  const storeId = searchParams.get("storeId") ?? undefined;
  const storeName = searchParams.get("storeName") ?? "products";

  const user: StoreAccessUser = {
    id: token.sub as string,
    organizationId: token.organizationId as string,
    role: token.role as string,
    isOrgOwner: token.isOrgOwner as boolean | null,
    isPlatformOwner: token.isPlatformOwner as boolean | null,
  };

  const encoder = new TextEncoder();
  const send = (data: ExportImagesEvent) =>
    encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      const temporaryDirectory = await mkdtemp(join(tmpdir(), "bazaar-image-export-"));
      const archivePath = join(temporaryDirectory, "images.zip");
      const zip = new ImageExportZipWriter(archivePath, maxZipBytes);
      try {
        const products = await exportProductImagesData({
          prisma,
          organizationId: user.organizationId,
          user,
          storeId,
        });

        controller.enqueue(send({ type: "total", count: products.length }));

        for (let i = 0; i < products.length; i++) {
          if (request.signal.aborted) {
            throw new Error("imageExportAborted");
          }
          const product = products[i]!;
          const folder = sanitizeFolderName(product.name);

          controller.enqueue(
            send({ type: "progress", done: i, total: products.length, name: product.name }),
          );

          for (let j = 0; j < product.images.length; j++) {
            const imageUrl = product.images[j]!;
            try {
              const result = await fetchImageBuffer(imageUrl, appOrigin);
              if (result) {
                const ext = getExtension(result.contentType, imageUrl);
                await zip.addFile(`${folder}/image-${j + 1}${ext}`, result.buffer);
              } else {
                console.warn(`[export-images] Skipping (fetch failed): ${imageUrl}`);
              }
            } catch (err) {
              console.warn(`[export-images] Skipping (error): ${imageUrl}`, err);
            }
          }
        }

        controller.enqueue(
          send({ type: "progress", done: products.length, total: products.length, name: "" }),
        );
        controller.enqueue(send({ type: "zipping" }));

        await zip.close();
        const downloadToken = randomUUID();
        const safeStoreName = sanitizeFolderName(storeName);
        const date = new Date().toISOString().slice(0, 10);
        const filename = `images-${safeStoreName}-${date}.zip`;

        await storeZipFile(
          downloadToken,
          archivePath,
          filename,
          {
            userId: user.id,
            organizationId: user.organizationId,
          },
        );

        controller.enqueue(send({ type: "ready", token: downloadToken, filename }));
      } catch (err) {
        console.error("[export-images] Fatal error:", err);
        controller.enqueue(send({ type: "error", message: "Export failed" }));
      } finally {
        await zip.abort();
        await rm(temporaryDirectory, { recursive: true, force: true });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
