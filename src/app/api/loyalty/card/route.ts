import { cookies } from "next/headers";

import { LOYALTY_SESSION_COOKIE, getCardView } from "@/server/services/loyalty/memberAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => {
  try {
    const view = await getCardView(cookies().get(LOYALTY_SESSION_COOKIE)?.value ?? "");
    return Response.json(view, { status: 200 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 401;
    return Response.json({ message: (error as Error).message || "loyaltyUnauthorized" }, { status });
  }
};
