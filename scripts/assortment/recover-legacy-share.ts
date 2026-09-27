import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import {
  planAssortmentRecovery,
  applyAssortmentRecovery,
  type AssortmentRecoveryPlan,
} from "../../src/server/services/assortmentRecovery";

// Explicit maintenance command. Never invoked by builds, migrations, page reads or seeds.
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const organizationId = option("--organization"),
  shareAuditId = option("--share-audit");
const production = args.includes("--production"),
  apply = option("--apply-plan");
const output = resolve(option("--output") ?? "artifacts/assortment-sources/recovery");
if (!organizationId || !shareAuditId)
  throw new Error("Explicit --organization and --share-audit are required");
const config = production
  ? parseEnv(await readFile(".vercel/.env.production.local", "utf8"))
  : process.env;
const databaseUrl = production
  ? config.DATABASE_URL_UNPOOLED || config.DATABASE_URL
  : config.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("An explicit database connection is required");
const host = new URL(databaseUrl).hostname;
if (production ? !host.endsWith(".neon.tech") : !["localhost", "127.0.0.1"].includes(host))
  throw new Error("Unexpected database environment");
await mkdir(output, { recursive: true, mode: 0o700 });
const db = new PrismaClient({ datasourceUrl: databaseUrl });
try {
  if (apply) {
    const plan = JSON.parse(await readFile(resolve(apply), "utf8")) as AssortmentRecoveryPlan;
    if (
      plan.version !== 1 ||
      plan.organizationId !== organizationId ||
      plan.shareAuditId !== shareAuditId
    )
      throw new Error("Plan identity mismatch");
    const result = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        return applyAssortmentRecovery(tx, plan);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 },
    );
    await writeFile(
      resolve(output, "applied.json"),
      JSON.stringify({ at: new Date(), ...result }, null, 2),
      { mode: 0o600 },
    );
    // Publish only after the transaction and its receipt are durable. Product reads
    // use the database; this asks already-open screens to refresh their query cache.
    let refresh: "published" | "not-configured" | "failed" = "not-configured";
    if (config.REDIS_URL) {
      const prefix = (config.REDIS_KEY_PREFIX ?? "").trim();
      if (prefix && !/^[A-Za-z0-9:_-]{1,64}$/.test(prefix))
        throw new Error("Recovery committed; invalid REDIS_KEY_PREFIX prevents screen refresh");
      const redis = new Redis(config.REDIS_URL, {
        lazyConnect: true,
        connectTimeout: 3_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      redis.on("error", () => {}); // Do not log connection credentials.
      try {
        const channel = `${prefix}${prefix && !prefix.endsWith(":") ? ":" : ""}inventory.events`;
        const sourceId = randomUUID();
        for (const baseline of plan.baselines)
          await redis.publish(
            channel,
            JSON.stringify({
              sourceId,
              event: { type: "assortment.updated", payload: { storeId: baseline.storeId } },
            }),
          );
        refresh = "published";
      } catch {
        refresh = "failed";
      } finally {
        redis.disconnect();
      }
    }
    console.log(JSON.stringify({ ...result, refresh }));
    if (refresh !== "published")
      console.warn("Recovery committed. Reopen existing screens to refresh their cached data.");
  } else {
    const plan = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
        return planAssortmentRecovery(tx, organizationId, shareAuditId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000 },
    );
    const path = resolve(output, `plan-${plan.fingerprint}.json`);
    await writeFile(path, JSON.stringify(plan, null, 2), { mode: 0o600, flag: "wx" });
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          path,
          fingerprint: plan.fingerprint,
          boundary: plan.boundary,
          stores: plan.baselines.map((b) => ({
            name: b.name,
            before: b.currentVisible,
            after: b.visible,
            retainedArchived: b.productIds.length - b.visible,
            hidden: b.removedAssignmentIds.length,
          })),
        },
        null,
        2,
      ),
    );
  }
} finally {
  await db.$disconnect();
}
