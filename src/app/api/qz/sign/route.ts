import { NextResponse } from "next/server";

import { getServerAuthToken } from "@/server/auth/token";
import { getQzSigningStatus, signQzTrayRequest } from "@/server/services/qzSigning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async (request: Request) => {
  const token = await getServerAuthToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const payload = typeof body?.request === "string" ? body.request : "";
  if (!payload || payload.length > 20_000) {
    return NextResponse.json({ error: "invalidInput" }, { status: 400 });
  }

  const status = getQzSigningStatus();
  if (!status.signingConfigured) {
    return NextResponse.json({ error: "qzSigningNotConfigured" }, { status: 503 });
  }
  if (status.keyPairMatches === false) {
    return NextResponse.json({ error: "qzCertificateKeyMismatch" }, { status: 503 });
  }

  try {
    return NextResponse.json({ signature: signQzTrayRequest(payload) });
  } catch {
    return NextResponse.json({ error: "qzSigningFailed" }, { status: 500 });
  }
};
