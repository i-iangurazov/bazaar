import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { planProductionMigrations } from "../../scripts/deployment/migrations";

it("matches Prisma's real disposable migration history and produces an empty repeat-deploy plan", async () => {
  const directory = resolve("prisma/migrations");
  const folders = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const files = await Promise.all(folders.map(async ({ name }) => ({
    name,
    checksum: createHash("sha256").update(await readFile(resolve(directory, name, "migration.sql"))).digest("hex"),
  })));
  const history = await prisma.$queryRaw<Array<{
    migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null;
  }>>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  expect(history.length).toBeGreaterThan(0);
  expect(planProductionMigrations(files, history)).toEqual([]);
});
