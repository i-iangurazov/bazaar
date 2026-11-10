import { receiveWhatsAppWebhook } from "@/server/whatsapp/webhook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, { params: paramsPromise }: { params: Promise<{ connectionId: string }> }) {
  try {
    const params = await paramsPromise;
    return await receiveWhatsAppWebhook(request, params.connectionId);
  } catch {
    return new Response("unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
// Provider reachability checks do not reveal connection existence or credentials.
export async function GET() {
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}
