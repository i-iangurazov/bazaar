import { cookies } from "next/headers";

import { LOYALTY_SESSION_COOKIE, getCardView } from "@/server/services/loyalty/memberAuth";
import { AppError } from "@/server/services/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => {
  try {
    const view = await getCardView(cookies().get(LOYALTY_SESSION_COOKIE)?.value ?? "");
    return Response.json(view, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { message: error instanceof AppError ? error.message : "genericMessage" },
      { status: error instanceof AppError ? error.status : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
