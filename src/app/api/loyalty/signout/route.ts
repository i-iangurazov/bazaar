import { NextResponse } from "next/server";

import { LOYALTY_SESSION_COOKIE, revokeSession } from "@/server/services/loyalty/memberAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async (request: Request) => {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((pair) => pair.trim().split("="))
    .find(([name]) => name === LOYALTY_SESSION_COOKIE)?.[1];
  if (token) await revokeSession(decodeURIComponent(token)).catch(() => undefined);
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(LOYALTY_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
};
