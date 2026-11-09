import { handleGoPayNotification } from "@/server/billing/goPayWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handleGoPayNotification;
