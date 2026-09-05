import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Offline transport checks only. No application/Prisma/provider module loads here. */
export const emailFlowCheckCommand = (args: string[]) => {
  if (args.length && !(args.length === 1 && args[0] === "--offline")) {
    throw new Error(
      "Only --offline is supported. Real delivery needs a separately authorized recipient and provider verification.",
    );
  }
  return [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.stabilization-unit.config.ts",
    "tests/unit/transactional-email.test.ts",
  ];
};

export const runEmailFlowCheck = (args = process.argv.slice(2)) => {
  const command = emailFlowCheckCommand(args);
  console.log(
    "[email-flow] Running offline transport checks with synthetic payloads and mocked providers. No real email will be sent.",
  );
  const result = spawnSync("pnpm", command, {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test", RUN_DB_TESTS: "0", SKIP_DB_TESTS: "1" },
  });
  if (result.error || result.status !== 0) throw new Error("Offline email checks failed.");
  console.log(
    "[email-flow] Offline checks passed. Provider configuration, sender DNS, inbox delivery and auth database workflows remain unverified by this command.",
  );
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runEmailFlowCheck();
  } catch (error) {
    console.error(
      `[email-flow] ${error instanceof Error ? error.message : "Offline validation failed."}`,
    );
    process.exitCode = 1;
  }
}
