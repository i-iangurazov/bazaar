import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import {
  disableMobileDevice,
  getMobileDeviceStatus,
  MobilePlatform,
  registerMobileDevice,
} from "@/server/services/mobileDevices";

export const dynamic = "force-dynamic";

const registrationSchema = z.object({
  installationId: z.string().trim().min(8).max(160),
  platform: z.enum(["ios", "android"]),
  token: z.string().trim().min(8).max(4096),
  appVersion: z.string().trim().min(1).max(40),
  buildNumber: z.string().trim().min(1).max(40),
  deviceName: z.string().trim().max(120).optional(),
  osVersion: z.string().trim().max(80).optional(),
});
const installationSchema = z.object({ installationId: z.string().trim().min(8).max(160) });

const auth = async () => {
  const token = await getServerAuthToken();
  return token?.sub && token.organizationId
    ? { userId: token.sub, organizationId: String(token.organizationId) }
    : null;
};

const unauthorized = () => NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

export const POST = async (request: Request) => {
  const current = await auth();
  if (!current) return unauthorized();
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  try {
    const device = await registerMobileDevice(prisma, {
      ...current,
      ...parsed.data,
      platform: parsed.data.platform === "ios" ? MobilePlatform.IOS : MobilePlatform.ANDROID,
    });
    return NextResponse.json({
      registered: true,
      platform: device.platform === MobilePlatform.IOS ? "ios" : "android",
      lastSeenAt: device.lastSeenAt.toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "REGISTRATION_UNAVAILABLE" }, { status: 503 });
  }
};

export const DELETE = async (request: Request) => {
  const current = await auth();
  if (!current) return unauthorized();
  const parsed = installationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  await disableMobileDevice(prisma, { ...current, ...parsed.data });
  return NextResponse.json({ disabled: true });
};

export const GET = async (request: Request) => {
  const current = await auth();
  if (!current) return unauthorized();
  const parsed = installationSchema.safeParse({
    installationId: new URL(request.url).searchParams.get("installationId"),
  });
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const device = await getMobileDeviceStatus(prisma, { ...current, ...parsed.data });
  return NextResponse.json({
    registered: Boolean(device?.enabled),
    platform: device?.platform === MobilePlatform.IOS ? "ios" : device ? "android" : null,
    appVersion: device?.appVersion ?? null,
    lastSeenAt: device?.lastSeenAt.toISOString() ?? null,
  });
};
