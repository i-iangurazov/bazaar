import { getAuthTokenFromCookieHeader } from "@/server/auth/token";
import { whatsappImageForActor } from "@/server/whatsapp/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params: paramsPromise }: { params: Promise<{ messageId: string }> }) {
  const params = await paramsPromise;

  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  try {
    const token = await getAuthTokenFromCookieHeader(request.headers.get("cookie"));
    if (!token?.sub || !token.organizationId || !/^[a-zA-Z0-9_-]{10,80}$/.test(params.messageId))
      return new Response(null, { status: 404, headers });
    const image = await whatsappImageForActor(
      { id: token.sub, organizationId: String(token.organizationId) },
      params.messageId,
    );
    return new Response(new Uint8Array(image), {
      headers: { ...headers, "Content-Type": "image/jpeg" },
    });
  } catch {
    return new Response(null, { status: 404, headers });
  }
}
