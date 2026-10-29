/** Run the real standalone production build against the isolated Espresso fixtures. */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { assertUxDatabase, uxEnvironment } from "../ux/environment";

if (process.env.UX_SUITE !== "espresso") throw new Error("Set UX_SUITE=espresso explicitly");
// Load first, then neutralize provider settings before Next reads the copied env files.
// Otherwise a key absent from the parent process could be reintroduced by .env.local.
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd(), false);
Object.assign(process.env, uxEnvironment());
assertUxDatabase();

const standalone = resolve(".next/standalone");
const server = resolve(standalone, "server.js");
if (!existsSync(server)) throw new Error("Build the isolated Espresso app before starting it");
// Next's standalone output intentionally excludes public assets and client chunks.
cpSync(resolve("public"), resolve(standalone, "public"), { recursive: true });
cpSync(resolve(".next/static"), resolve(standalone, ".next/static"), { recursive: true });

const result = spawnSync(process.execPath, [server], {
  env: {
    ...uxEnvironment(),
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: "3122",
    ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
    ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
  },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
