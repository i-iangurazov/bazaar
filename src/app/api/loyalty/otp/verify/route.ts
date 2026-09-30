import { NextResponse } from "next/server";
import { z } from "zod";

import {
  LOYALTY_SESSION_COOKIE,
  loyaltySessionCookieOptions,
  verifyJoinOtp,
} from "@/server/services/loyalty/memberAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    programStoreId: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
    code: z.string().trim().regex(/^\d{6}$/),
  })
  .strict();

export const POST = async (request: Request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "invalidInput" }, { status: 400 });
  try {
    const { token } = await verifyJoinOtp(parsed.data);
    const response = NextResponse.json({ ok: true }, { status: 200 });
    response.cookies.set(LOYALTY_SESSION_COOKIE, token, loyaltySessionCookieOptions);
    return response;
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400;
    return Response.json({ message: (error as Error).message || "genericMessage" }, { status });
  }
};
