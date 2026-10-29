/** Fixture preparation is confined to the separate Espresso QA database. */
import { spawnSync } from "node:child_process";
import { uxEnvironment, assertUxDatabase } from "../ux/environment";
if (process.env.UX_SUITE !== "espresso") throw new Error("Set UX_SUITE=espresso explicitly");
Object.assign(process.env, uxEnvironment());
assertUxDatabase();
for (const args of [
  ["exec", "prisma", "migrate", "deploy"],
  ["exec", "tsx", "scripts/ux/seed.ts"],
  ["exec", "tsx", "scripts/ux/details.ts"],
]) {
  const result = spawnSync("pnpm", args, { env: process.env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
