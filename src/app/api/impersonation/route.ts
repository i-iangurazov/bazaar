import { NextResponse } from "next/server";

import { cookies } from "next/headers";

import { prisma } from "@/server/db/prisma";
import { getServerAuthToken } from "@/server/auth/token";

const COOKIE_NAME = "impersonation_session";

const buildResponse = (payload: Record<string, unknown>, status = 200) =>
  NextResponse.json(payload, { status });

export const GET = async () => {
  const token = await getServerAuthToken();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAME)?.value ?? "";
  if (!token || !sessionId) {
    return buildResponse({ active: false }, 200);
  }

  const session = await prisma.impersonationSession.findUnique({
    where: { id: sessionId },
    select: { id: true, expiresAt: true, revokedAt: true, createdById: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.createdById !== token.sub) {
    return buildResponse({ active: false }, 200);
  }

  return buildResponse({ active: true, sessionId }, 200);
};

export const POST = async (req: Request) => {
  const token = await getServerAuthToken();
  if (!token || token.role !== "ADMIN") {
    return buildResponse({ error: "forbidden" }, 403);
  }

  const body = (await req.json().catch(() => null)) as { sessionId?: string } | null;
  const sessionId = body?.sessionId ?? "";
  if (!sessionId) {
    return buildResponse({ error: "missingSessionId" }, 400);
  }

  const session = await prisma.impersonationSession.findUnique({
    where: { id: sessionId },
    include: { targetUser: { select: { id: true, organizationId: true } } },
  });

  if (
    !session ||
    session.createdById !== token.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.targetUser.organizationId !== token.organizationId
  ) {
    return buildResponse({ error: "invalidSession" }, 400);
  }

  const response = buildResponse({ ok: true });
  response.cookies.set(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: session.expiresAt,
    path: "/",
  });
  return response;
};

export const DELETE = async () => {
  const response = buildResponse({ ok: true });
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });
  return response;
};
