import { spawnSync } from "node:child_process";
import { stockAuditEnvironment } from "./environment";
const env = stockAuditEnvironment();
// Browser fixtures live in agent2_inventory; destructive suites use another DB.
env.DATABASE_URL = env.DATABASE_TEST_URL =
  "postgresql://bazaar_test:bazaar_test_only@127.0.0.1:55439/bazaar_hardening_ci";
env.EXPECTED_TEST_DB_NAME = "bazaar_hardening_ci";
env.ALLOW_TEST_DB_RESET = "1";
env.REDIS_URL = "redis://127.0.0.1:56389/13";
const result = spawnSync("pnpm", ["exec", "vitest", "run", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
