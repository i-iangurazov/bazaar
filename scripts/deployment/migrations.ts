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

// Observed completed production ledger entries, verified against Git history.
// These are not pending-migration approvals and are never restored or replayed.
// Provenance and scope: docs/deployment-migration-history.md.
export const acknowledgedAppliedHistory: Readonly<Record<string, {
  recordedChecksum: string; releaseChecksum: string | null;
}>> = {
  "20260429123000_bazaar_api_keys": {
    recordedChecksum: "01d8eafc05ce163d68a9906c0ce83e2b2b3188ca21af59739f74785defcfbc95",
    releaseChecksum: "ef6bd40462fd79d293eb9eab79e92518a1b5a37136c53f147ba6eaa4b356341c",
  },
  "20260831122000_allow_zero_cost_stock_movement": {
    recordedChecksum: "0c472ace8b0b64bcc5e83fffc5f17040d9b27b2e64ee8a01420db37478a63a98", releaseChecksum: null,
  },
  "20260831120000_product_cost_precise_basis_value": {
    recordedChecksum: "8b4b977fa0fb4cc2a6e91389cd6ea33d70f5b66cfa7fdf96690101418ea77d66", releaseChecksum: null,
  },
  "20260831121000_stock_movement_inventory_value": {
    recordedChecksum: "2d3c0b3fa238ff8d48acf78c8d165acaaf3bff411d75f0a7967820400c5d06c2", releaseChecksum: null,
  },
  "20260831121500_stock_movement_valuation_cursor_index": {
    recordedChecksum: "378043484b656d0fc0c3f061e0f556944a7db95eb6b0f3911775931f5fd34445", releaseChecksum: null,
  },
};

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
  const divergentHistory = active.flatMap((record) => {
    const file = files.find((candidate) => candidate.name === record.migration_name);
    if (!file || file.checksum !== record.checksum) {
      const acknowledged = acknowledgedAppliedHistory[record.migration_name];
      if (acknowledged?.recordedChecksum === record.checksum &&
          acknowledged.releaseChecksum === (file?.checksum ?? null)) return [];
      return [{ name: record.migration_name, recordedChecksum: record.checksum, releaseChecksum: file?.checksum ?? null }];
    }
    return [];
  });
  if (divergentHistory.length) {
    // Migration names and SQL digests are safe deployment diagnostics. No
    // database URL, credentials, customer rows or provider values are logged.
    throw new Error(`Database migration history differs from this release: ${JSON.stringify(divergentHistory)}`);
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
