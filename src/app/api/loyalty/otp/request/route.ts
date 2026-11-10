import { z } from "zod";

import { getLocaleFromAcceptLanguage, normalizeLocale } from "@/lib/locales";
import { requestJoinOtp } from "@/server/services/loyalty/memberAuth";
import { loyaltyAuthErrorResponse } from "@/server/services/loyalty/authErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    programStoreId: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
  })
  .strict();

export const POST = async (request: Request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "invalidInput" }, { status: 400 });
  try {
    const cookieLocale = request.headers.get("cookie")?.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)?.[1];
    const locale =
      normalizeLocale(cookieLocale) ??
      getLocaleFromAcceptLanguage(request.headers.get("accept-language"));
    return Response.json(await requestJoinOtp({ ...parsed.data, locale }), { status: 200 });
  } catch (error) {
    return loyaltyAuthErrorResponse(error);
  }
};
