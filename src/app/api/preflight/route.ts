import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { assertStartupConfigured } from "@/server/config/startupChecks";
import { getRedisPublisher } from "@/server/redis";

export const runtime = "nodejs";

const getAccess = async (request: Request) => {
  const configuredSecret = process.env.HEALTHCHECK_SECRET;
  const providedSecret = request.headers.get("x-health-secret");
  if (configuredSecret) {
    return providedSecret === configuredSecret;
  }

  const token = await getServerAuthToken();
  return Boolean(token?.sub && token.role === "ADMIN");
};

export const GET = async (request: Request) => {
  const hasAccess = await getAccess(request);
  if (!hasAccess) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }

  let startup = "ok";
  let db = "ok";
  let migrations = "ok";
  let redis = "ok";
  const errors: string[] = [];

  try {
    await assertStartupConfigured();
  } catch (error) {
    startup = "failed";
    errors.push((error as Error).message);
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    db = "failed";
    errors.push(`db:${(error as Error).message}`);
  }

  try {
    const pending = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL
    `;
    if ((pending[0]?.count ?? 0) > 0) {
      migrations = "pending";
      errors.push("migrations:pending");
    }
  } catch (error) {
    migrations = "failed";
    errors.push(`migrations:${(error as Error).message}`);
  }

  try {
    const redisClient = getRedisPublisher();
    if (!redisClient) {
      redis = process.env.NODE_ENV === "production" ? "failed" : "missing";
      if (process.env.NODE_ENV === "production") {
        errors.push("redis:missing");
      }
    } else {
      await redisClient.ping();
    }
  } catch (error) {
    redis = "failed";
    errors.push(`redis:${(error as Error).message}`);
  }

  const ready =
    startup === "ok" &&
    db === "ok" &&
    migrations === "ok" &&
    (redis === "ok" || (redis === "missing" && process.env.NODE_ENV !== "production"));
  const statusCode = ready ? 200 : 503;

  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: { startup, db, migrations, redis },
      errors,
    },
    { status: statusCode },
  );
};
