import { AppError } from "@/server/services/errors";
import { createRateLimiter } from "@/server/middleware/rateLimiter";
import { pairConnectorDevice } from "@/server/services/kkmConnector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return Response.json({ message: error.message }, { status: error.status });
  }
  return Response.json({ message: "genericMessage" }, { status: 500 });
};

const resolveClientIp = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
};

export const POST = async (request: Request) => {
  const ip = resolveClientIp(request);
  try {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 10,
      prefix: "kkm-connector-pair",
    });
    await limiter.consume(ip);
  } catch (error) {
    if (error instanceof Error && error.message === "rateLimited") {
      return Response.json({ message: "rateLimited" }, { status: 429 });
    }
    if (error instanceof Error && error.message === "redisUnavailable") {
      return Response.json({ message: "serviceUnavailable" }, { status: 503 });
    }
    return Response.json({ message: "genericMessage" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as
    | { code?: string; deviceName?: string }
    | null;
  if (!body?.code || typeof body.code !== "string") {
    return Response.json({ message: "invalidInput" }, { status: 400 });
  }

  try {
    const paired = await pairConnectorDevice({
      code: body.code,
      deviceName: body.deviceName ?? "",
    });
    return Response.json(
      {
        token: paired.token,
        device: paired.device,
      },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
};
