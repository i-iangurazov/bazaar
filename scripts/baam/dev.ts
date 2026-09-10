import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
const require = createRequire(import.meta.url);
const nextEnv = createRequire(require.resolve("next/package.json"))("@next/env");
nextEnv.loadEnvConfig(process.cwd(), true);
const providerKey = process.env.BAAM_LIVE_PROVIDER === "1" ? process.env.OPENAI_API_KEY : undefined;
const production = process.argv.includes("--production");
Object.assign(process.env, baamTestEnvironment(), {
  NODE_ENV: production ? "production" : "development",
  ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
  ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
});
if (process.env.BAAM_TEST_HTTPS === "1") process.env.NEXTAUTH_URL = "https://localhost:3121";
assertBaamTestDatabase();
if (providerKey) process.env.OPENAI_API_KEY = providerKey;
nextEnv.updateInitialEnv({ ...process.env });
const { default: next } = await import("next");
const app = next({ dev: !production, hostname: "localhost", port: 3121 });
await app.prepare();
const server =
  process.env.BAAM_TEST_HTTPS === "1"
    ? createSecureServer(
        { key: readFileSync("/tmp/baam-local.key"), cert: readFileSync("/tmp/baam-local.crt") },
        app.getRequestHandler(),
      )
    : createServer(app.getRequestHandler());
server.listen(3121, "127.0.0.1", () => console.log("BAAM isolated app: http://localhost:3121"));
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    void app.close().finally(() => process.exit(0));
  });
