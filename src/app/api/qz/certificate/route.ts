import { NextResponse } from "next/server";

import { getServerAuthToken } from "@/server/auth/token";
import { getQzSigningStatus, getQzTrayCertificate } from "@/server/services/qzSigning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = async () => {
  const token = await getServerAuthToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const status = getQzSigningStatus();
  const certificate = getQzTrayCertificate();
  if (!status.signingConfigured || !certificate) {
    return new Response(null, { status: 204 });
  }

  return new Response(certificate, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
