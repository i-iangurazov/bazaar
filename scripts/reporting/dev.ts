import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { reportingEnvironment, assertReportingDatabase } from "./environment";
const require = createRequire(import.meta.url);
const nextEnv = createRequire(require.resolve("next/package.json"))("@next/env");
nextEnv.loadEnvConfig(process.cwd(), true);
const production = process.argv.includes("--production");
Object.assign(process.env, reportingEnvironment(), {
  NODE_ENV: production ? "production" : "development",
  ALLOW_LOCALHOST_DATABASE_IN_PRODUCTION: "true",
  ALLOW_LOG_EMAIL_IN_PRODUCTION: "true",
});
if (process.env.REPORTING_HTTPS === "1") process.env.NEXTAUTH_URL = "https://localhost:3123";
assertReportingDatabase();
nextEnv.updateInitialEnv({ ...process.env });
const { default: next } = await import("next");
const app = next({ dev: !production, hostname: "localhost", port: 3123 });
await app.prepare();
const server =
  process.env.REPORTING_HTTPS === "1"
    ? createSecureServer(
        {
          key: readFileSync(process.env.REPORTING_TLS_KEY_PATH ?? "/tmp/baam-local.key"),
          cert: readFileSync(process.env.REPORTING_TLS_CERT_PATH ?? "/tmp/baam-local.crt"),
        },
        app.getRequestHandler(),
      )
    : createServer(app.getRequestHandler());
server.listen(3123, "127.0.0.1", () =>
  console.log("Isolated reporting app ready on localhost:3123"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    void app.close().finally(() => process.exit(0));
  });
