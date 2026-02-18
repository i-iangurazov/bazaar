import { NextResponse } from "next/server";

import { normalizeLocale } from "@/lib/locales";

const COOKIE_NAME = "NEXT_LOCALE";
const COOKIE_MAX_AGE = 31536000;

export const POST = async (request: Request) => {
  let body: { locale?: string } | undefined;
  try {
    body = (await request.json()) as { locale?: string };
  } catch {
    return NextResponse.json({ error: "invalidBody" }, { status: 400 });
  }

  const locale = normalizeLocale(body?.locale);
  if (!locale) {
    return NextResponse.json({ error: "invalidLocale" }, { status: 400 });
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(COOKIE_NAME, locale, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
};
