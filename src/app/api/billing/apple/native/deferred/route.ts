import { appleNativeRoute } from "@/server/billing/appleNativeRoute";
export const runtime = "nodejs";
export const POST = (request: Request) => appleNativeRoute(request, "deferred");
