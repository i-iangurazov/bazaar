import { appleCompletionRoute } from "@/server/billing/appleCompletionRoute";
export const runtime = "nodejs";
export const POST = (request: Request) => appleCompletionRoute(request, "challenge");
