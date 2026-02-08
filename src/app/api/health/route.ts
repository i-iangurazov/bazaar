import { getServerAuthToken } from "@/server/auth/token";
import { prisma } from "@/server/db/prisma";
import { getRedisPublisher } from "@/server/redis";
import { incrementCounter, httpRequestsTotal } from "@/server/metrics/metrics";
import { getKkmAdapter } from "@/server/kkm/registry";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  incrementCounter(httpRequestsTotal, { path: "/api/health" });
  const configuredSecret = process.env.HEALTHCHECK_SECRET;
  const providedSecret = request.headers.get("x-health-secret");
  const token = await getServerAuthToken();
  const isAdmin = Boolean(token?.sub && token.role === "ADMIN");
  const internalAccess = configuredSecret ? providedSecret === configuredSecret : isAdmin;

  if (!internalAccess) {
    return Response.json({ status: "ok" });
  }

  let db = "unknown";
  let migrations = "unknown";
  let redis = "unknown";
  let kkm: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }

  try {
    const pending = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL
    `;
    migrations = pending[0]?.count === 0 ? "ok" : "pending";
  } catch {
    migrations = "unknown";
  }

  try {
    const client = getRedisPublisher();
    if (!client) {
      redis = "missing";
    } else {
      await client.ping();
      redis = "up";
    }
  } catch {
    redis = "down";
  }

  try {
    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId");
    if (storeId) {
      const profile = await prisma.storeComplianceProfile.findFirst({
        where: { storeId },
        select: { enableKkm: true, kkmMode: true, kkmProviderKey: true },
      });
      if (profile?.enableKkm && profile.kkmMode === "ADAPTER") {
        const adapter = getKkmAdapter(profile.kkmProviderKey);
        const health = await adapter.health();
        kkm = health.ok ? "up" : "down";
      } else {
        kkm = "disabled";
      }
    }
  } catch {
    kkm = "down";
  }

  const status =
    db === "up" && migrations === "ok" && redis === "up" && (!kkm || kkm === "up" || kkm === "disabled")
      ? "ok"
      : "degraded";

  return Response.json({ status, db, migrations, redis, ...(kkm ? { kkm } : {}) });
};
