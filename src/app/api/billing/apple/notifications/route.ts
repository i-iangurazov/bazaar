import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/server/services/errors";
import { acceptAppleServerNotification } from "@/server/billing/appleLifecycle";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 260_000) return new NextResponse(null, { status: 413 });
    const raw = await request.text();
    if (raw.length > 260_000) return new NextResponse(null, { status: 413 });
    const { signedPayload } = z.object({ signedPayload: z.string().min(30).max(250_000) }).parse(JSON.parse(raw));
    await acceptAppleServerNotification(signedPayload);
    return NextResponse.json({ accepted: true });
  } catch (error) {
    return NextResponse.json({ accepted: false }, { status: error instanceof AppError && error.code === "BAD_REQUEST" ? 400 : 503 });
  }
}
