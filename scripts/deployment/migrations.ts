import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// Review each additive migration before adding it to the production rollout.
export const approvedProductionMigrations = {
  "20261002010000_organization_price_types": "728a6ca4e0b566c2a81c228267c17aa0db7439a48556d4f8cd5e1bee283ca0e2",
  "20260930120000_loyalty_foundation": "86bafee280af9b8e9095167ea17889220b163d1965056c02bd5f309c820cc7cc",
  "20260930160000_loyalty_customer_identity": "11e064c167ecbf7baf30d048c5d0df6124a7382c737e3167b7c5ecbf1b98dde3",
  "20260930180000_loyalty_account_reserved": "e9ed032d071778a4244484f5a52400da715f6d4f48ea18992b1f29d8fde026b0",
  "20261001190000_loyalty_redemption_consent": "eea02050602114e3b8ff1528b1498d2950dd3807ff489395767a1be296f00e20",
  "20261001200000_store_price_types_pos_transfer": "17735c800747364b911fcc8fb81c1b41e00e0b16b3d9ecbde74e4ca8da5b199c",
  "20261001210000_label_text_styles": "39b99d43272903667242de8b90bcf3695f88f74153045edf53e7c94a964f20de",
  "20261001220000_inherited_standard_price": "5aa9a9adacc83ac9168fd27fe75308251b24e49f642f222216a5db3792eaf43c",
  "20261001230000_separate_store_price_types": "72bb82141e90e4a601334447cf48de2a5a4f893005b7bc3a10c46630f8f63692",
  "20261001240000_store_price_types_delete_compatibility": "095bc227da3f71444cfbeb162e02efff184b17c87ddaa15dbb033d48914e2ce1",
  "20261002000000_legacy_pos_price_provenance": "391fb9f84e6092338b428f2dcea1bc64de23c2eea82ef63d0b5bc9e6643272da",
  "20260928041000_catalog_source_legacy_guard": "96b4db19be5f981693930c6127245ca90294f7f62c7dfca6124d576949c64b9a",
  "20260928040000_catalog_sources": "0dff005db2dae6bfe5c8be76a651b320272a16b071fbb0e8ace2129865d4df6a",
  "20260928010000_directional_assortments": "9167211cb9a8db9284f868a4ee00413fe05cbc1995e2ae3274394fffbac47ae4",
  "20260928020000_sale_channel": "8025720884209a3ddcbf2535a1d9a413053423417dcf8351d996b9f908d586ca",
  "20260928030000_customer_purchase_identity": "317e494cacd638de634287cf2886711776de1a2fd4119a6dd4a2780eee52b728",
  "20260911001500_baam_workflows": "c09ddb810b7bf1e7f770cbbbaf03d6b3bb034cfc18f5c3c273463ac1111f7303",
  "20260910013000_baam_companion": "875212109f6f7c66bc5b555b43a3bd3d729fb60481a5136a090faa9e3709fec5",
  "20260910000000_inventory_stock_version": "f8a60abef26b45afa0e185ba8623b4e7ab7eb353e6dec5ea42a82418742749df",
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
