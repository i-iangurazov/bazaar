import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Review each additive migration before adding it to the production rollout.
export const approvedProductionMigrations = {
  "20260905140000_user_session_version": "5578b1bf0e83de2ff743ba32ae7b080d89c8ae122f76b139cac54de6658cba04",
  "20260905150000_dead_letter_retry_claim": "3cb56dbbea878d9980a92fc7f88079ec569c935b840a04fd2b1525c2c27c1814",
} as const;

type MigrationFile = { name: string; checksum: string };
type MigrationRecord = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export function planProductionMigrations(
  files: MigrationFile[],
  history: MigrationRecord[],
  approved: Readonly<Record<string, string>> = approvedProductionMigrations,
) {
  for (const [name, checksum] of Object.entries(approved)) {
    if (!files.some((file) => file.name === name && file.checksum === checksum)) {
      throw new Error("A reviewed release migration is missing or its SQL changed.");
    }
  }
  const active = history.filter((record) => !record.rolled_back_at);
  if (active.some((record) => !record.finished_at)) throw new Error("Unfinished migration requires recovery.");
  for (const record of active) {
    const file = files.find((candidate) => candidate.name === record.migration_name);
    if (!file || file.checksum !== record.checksum) {
      throw new Error("Database migration history differs from this release.");
    }
  }
  const completed = new Set(active.map((record) => record.migration_name));
  const pending = files.filter((file) => !completed.has(file.name)).map((file) => file.name);
  if (pending.some((name) => !Object.hasOwn(approved, name))) {
    throw new Error("An unapproved migration is pending; this release will not apply it.");
  }
  return pending;
}

async function main() {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
    console.log("Production migrations run only inside a Vercel production build.");
    return;
  }
  const migrationsPath = resolve("prisma/migrations");
  const folders = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const files = await Promise.all(folders.map(async (name) => ({
    name,
    checksum: createHash("sha256").update(await readFile(resolve(migrationsPath, name, "migration.sql"))).digest("hex"),
  })));
  const database = new PrismaClient();
  let pending: string[];
  try {
    const history = await database.$queryRaw<MigrationRecord[]>`
      SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"
    `;
    pending = planProductionMigrations(files, history);
  } finally {
    await database.$disconnect();
  }
  if (!pending.length) {
    console.log("Production migration history already includes this release's migrations.");
    return;
  }
  console.log(`Applying ${pending.length} reviewed additive migration(s): ${pending.join(", ")}`);
  const result = spawnSync("pnpm", ["prisma:migrate"], { stdio: "inherit", env: process.env });
  if (result.error || result.status !== 0) throw new Error("Production migration did not finish successfully.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // Prisma configuration remains in the provider environment; never print it.
    console.error(error instanceof Error && !error.name.startsWith("Prisma")
      ? error.message : "Production migration preflight failed; inspect the provider's database status.");
    process.exitCode = 1;
  });
}
