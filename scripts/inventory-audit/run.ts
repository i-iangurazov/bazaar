import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { stockAuditEnvironment, assertStockAuditDatabase } from "./environment";

const env = stockAuditEnvironment();
assertStockAuditDatabase(env);
async function run(command: string, args: string[]) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
await run("pnpm", ["exec", "prisma", "migrate", "deploy"]);
await run(process.execPath, ["--import", "tsx", "scripts/inventory-audit/seed.ts"]);
await run(process.execPath, ["--import", "tsx", "scripts/inventory-audit/extend-fixture.ts"]);
await mkdir("artifacts/bazaar-stock-audit", { recursive: true });
const log = await open("artifacts/bazaar-stock-audit/server.log", "w", 0o600);
const server = spawn(process.execPath, ["--import", "tsx", "scripts/inventory-audit/dev.ts"], {
  env: { ...env, NODE_OPTIONS: "--max-old-space-size=6144" },
  stdio: ["ignore", log.fd, log.fd],
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Browser server exited ${server.exitCode}`);
    try {
      const response = await fetch("http://localhost:3119/api/auth/csrf", {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Compilation/startup may still be in progress. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("Isolated browser server did not become ready");
  await run(process.execPath, ["scripts/inventory-audit/browser.mjs"]);
} finally {
  server.kill("SIGTERM");
  await log.close();
}
