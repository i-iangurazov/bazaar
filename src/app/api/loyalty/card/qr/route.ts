import { cookies } from "next/headers";

import { LOYALTY_SESSION_COOKIE, issueCardToken } from "@/server/services/loyalty/memberAuth";
import { renderQrDataUrl } from "@/server/services/loyalty/qr";
import { AppError } from "@/server/services/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issues a short-lived customer QR token. The token itself never leaves this response. */
export const POST = async () => {
  try {
    const result = await issueCardToken(cookies().get(LOYALTY_SESSION_COOKIE)?.value ?? "");
    return Response.json(
      {
        expiresAt: result.expiresAt.toISOString(),
        qrDataUrl: await renderQrDataUrl(result.token),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { message: error instanceof AppError ? error.message : "genericMessage" },
      { status: error instanceof AppError ? error.status : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
