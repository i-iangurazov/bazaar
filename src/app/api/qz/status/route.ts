import { NextResponse } from "next/server";

import { getServerAuthToken } from "@/server/auth/token";
import { getQzSigningStatus } from "@/server/services/qzSigning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => {
  const token = await getServerAuthToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json(getQzSigningStatus(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
};
