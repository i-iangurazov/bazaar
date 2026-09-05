import { createServer } from "node:http";
import { createRequire } from "node:module";
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { stabilizationEnvironment, assertStabilizationDatabase } from "./environment";
import { createStabilizationFetch, stabilizationEmailKey } from "./fetch";

const require = createRequire(import.meta.url);
const nextEnv = createRequire(require.resolve("next/package.json"))("@next/env");
nextEnv.loadEnvConfig(process.cwd(), true);
Object.assign(process.env, stabilizationEnvironment());
assertStabilizationDatabase();
Object.assign(process.env, {
  NODE_ENV: "development",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: stabilizationEmailKey,
});
// Next development reloads its initial environment while preparing the server.
// Freeze the isolated overrides as that initial environment too.
nextEnv.updateInitialEnv({ ...process.env });

const originalFetch = globalThis.fetch;
globalThis.fetch = createStabilizationFetch({
  originalFetch,
  captureEmail: async (email) => {
    const id = `local_${randomUUID()}`;
    await mkdir("artifacts/bazaar-stabilization", { recursive: true });
    await appendFile("artifacts/bazaar-stabilization/mailbox.jsonl", `${JSON.stringify({
      id, capturedAt: new Date().toISOString(), ...email,
    })}\n`, { mode: 0o600 });
    return id;
  },
});
const { default: next } = await import("next");
const app = next({ dev: true, hostname: "localhost", port: 3108 });
await app.prepare();
assertStabilizationDatabase();
const { PrismaClient } = await import("@prisma/client");
const database = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
try {
  const [identity] = await database.$queryRaw<{ database: string; username: string }[]>`
    SELECT current_database() AS database, current_user AS username
  `;
  if (identity.database !== "bazaar_hardening_ci" || identity.username !== "bazaar_test") {
    throw new Error("Stabilization server connected to an unexpected database.");
  }
} finally { await database.$disconnect(); }
const server = createServer(app.getRequestHandler());
server.listen(3108, "127.0.0.1", () => {
  console.log("Isolated stabilization app: http://localhost:3108 (test DB 55432; external fetch disabled)");
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void app.close().finally(() => process.exit(0));
  });
}
