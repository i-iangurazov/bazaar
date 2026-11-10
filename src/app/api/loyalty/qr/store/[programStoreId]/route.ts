import { resolveJoinTarget } from "@/server/services/loyalty/memberAuth";
import { renderQrPng } from "@/server/services/loyalty/qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Registration QR for one participating store. The URL is built from this request. */
export const GET = async (request: Request, context: { params: Promise<{ programStoreId: string }> }) => {
  const params = await context.params;
  const target = await resolveJoinTarget(params.programStoreId);
  if (!target) return new Response("not found", { status: 404 });
  const origin = new URL(request.url).origin;
  const png = await renderQrPng(`${origin}/loyalty/join/${target.programStoreId}`);
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
};
