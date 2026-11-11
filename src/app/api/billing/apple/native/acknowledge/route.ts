import { appleNativeRoute } from "@/server/billing/appleNativeRoute";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => appleNativeRoute(request, "acknowledge");
