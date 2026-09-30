import { cookies } from "next/headers";

import { LOYALTY_SESSION_COOKIE, issueCardToken } from "@/server/services/loyalty/memberAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issues a short-lived customer QR token. The token itself never leaves this response. */
export const POST = async () => {
  try {
    const result = await issueCardToken(cookies().get(LOYALTY_SESSION_COOKIE)?.value ?? "");
    return Response.json(
      { token: result.token, expiresAt: result.expiresAt.toISOString() },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = (error as { status?: number }).status ?? 401;
    return Response.json({ message: (error as Error).message || "loyaltyUnauthorized" }, { status });
  }
};
