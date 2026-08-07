import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerAuthToken } from "@/server/auth/token";
import { getLogger } from "@/server/logging";

const diagnosticSchema = z.object({
  event: z.enum([
    "runtime_ready",
    "network_offline",
    "network_online",
    "deep_link_failed",
    "push_registration_failed",
    "native_share_failed",
  ]),
  detail: z.string().max(120).optional(),
  platform: z.enum(["ios", "android", "web"]),
  appVersion: z.string().max(40),
  build: z.string().max(40),
  osVersion: z.string().max(80).optional(),
});

export const POST = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token?.sub || !token.organizationId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = diagnosticSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  getLogger().info(
    {
      userId: token.sub,
      organizationId: token.organizationId,
      mobile: parsed.data,
    },
    "native mobile diagnostic",
  );
  return NextResponse.json({ accepted: true });
};
