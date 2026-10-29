import { handleFreedomPayNotification } from "@/server/billing/paymentWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleFreedomPayNotification(request, "result");
