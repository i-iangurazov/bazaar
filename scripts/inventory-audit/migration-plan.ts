import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { planProductionMigrations } from "../deployment/migrations";
const config = parseEnv(await readFile(".vercel/.env.production.local", "utf8"));
if (!config.DATABASE_URL) throw new Error("No existing production database connection");
const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
try {
  const directories = (await readdir("prisma/migrations", { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const files = await Promise.all(directories.map(async ({ name }) => ({
    name, checksum: createHash("sha256").update(await readFile(`prisma/migrations/${name}/migration.sql`)).digest("hex"),
  })));
  const report = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const history = await tx.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"
    `;
    const pending = planProductionMigrations(files, history);
    const trigger = await tx.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='inventory_snapshot_stock_version' AND NOT tgisinternal) AS present
    `;
    return { readOnly: true, checkedAt: new Date().toISOString(), pending,
      stockVersionTrigger: trigger[0]?.present, stockMigration: history.find((entry) => entry.migration_name === "20260910000000_inventory_stock_version") ?? null };
  });
  await mkdir("artifacts/bazaar-stock-audit", { recursive: true });
  await writeFile("artifacts/bazaar-stock-audit/production-migration-plan.json", JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally { await db.$disconnect(); }
