import { z } from "zod";

import { requestJoinOtp } from "@/server/services/loyalty/memberAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({ programStoreId: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254) })
  .strict();

export const POST = async (request: Request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "invalidInput" }, { status: 400 });
  try {
    return Response.json(await requestJoinOtp(parsed.data), { status: 200 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400;
    return Response.json({ message: (error as Error).message || "genericMessage" }, { status });
  }
};
