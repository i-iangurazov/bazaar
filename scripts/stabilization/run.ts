import { spawnSync } from "node:child_process";
import { stabilizationEnvironment, assertStabilizationDatabase } from "./environment";

const compose = ["compose", "-p", "bazaar-stabilization", "-f", "docker-compose.stabilization.yml"];
const env = stabilizationEnvironment();
const run = (command: string, args: string[], capture = false) => {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} exited with status ${result.status ?? "unavailable"}`);
  }
  return result.stdout?.trim() ?? "";
};

const mode = process.argv[2] ?? "test";
if (!["up", "test", "down"].includes(mode)) throw new Error("Use up, test or down.");
if (mode === "down") {
  run("docker", [...compose, "down"]);
} else {
  assertStabilizationDatabase(env);
  run("docker", [...compose, "up", "-d", "--wait", "--wait-timeout", "90", "--pull", "never"]);
  // Verify the target container identity and ephemeral storage before applying any schema.
  for (const service of ["postgres", "redis"]) {
    const id = run("docker", [...compose, "ps", "-q", service], true);
    if (!id || /\s/.test(id)) throw new Error(`Expected one ${service} test container.`);
    const [container] = JSON.parse(run("docker", ["inspect", id], true));
    if (
      container.Config.Labels["com.docker.compose.project"] !== "bazaar-stabilization" ||
      container.Config.Labels["bazaar.test-purpose"] !== "disposable-stabilization" ||
      container.Mounts.some((mount: { Type: string }) => mount.Type === "volume" || mount.Type === "bind")
    ) throw new Error("Refusing a container without the disposable stabilization identity/storage.");
  }
  run("pnpm", ["exec", "prisma", "generate"]);
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    const [identity] = await db.$queryRaw<{ database: string; username: string }[]>`
      SELECT current_database() AS database, current_user AS username
    `;
    if (identity.database !== "bazaar_hardening_ci" || identity.username !== "bazaar_test") {
      throw new Error("Connected database does not match the disposable test identity.");
    }
  } finally {
    await db.$disconnect();
  }
  // Existing migrations only, against the verified empty/disposable DB. No reset or seed fallback.
  run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
  if (mode === "test") run("pnpm", ["exec", "vitest", "run", "--config", "vitest.stabilization.config.ts"]);
  else console.log("Disposable stabilization services ready on PostgreSQL 55432 / Redis 56379.");
}
