import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
const nextEnv = createRequire(require.resolve("next/package.json"))("@next/env");
nextEnv.loadEnvConfig(process.cwd(), true);
for (const key of Object.keys(process.env)) {
  if (/^(?:RESEND_|OPENAI_|R2_|STRIPE_|SMTP_|BAKAI_|M_MARKET_|O_MARKET_)/.test(key))
    process.env[key] = "";
}
// Anonymous pages need no database fixtures. Never inherit a production connection.
Object.assign(process.env, {
  DATABASE_URL: "postgresql://landing:landing@127.0.0.1:55449/bazaar_landing_preview",
  REDIS_URL: "",
  NEXTAUTH_SECRET: "landing-local-only",
  NEXTAUTH_URL: "http://localhost:3120",
  NODE_ENV: "development",
  VERCEL: "0",
  VERCEL_ENV: "development",
  EMAIL_PROVIDER: "log",
  SIGNUP_MODE: "open",
});
nextEnv.updateInitialEnv({ ...process.env });
const next = require("next");
const app = next({ dev: true, hostname: "localhost", port: 3120 });
await app.prepare();
const server = createServer(app.getRequestHandler());
server.listen(3120, "127.0.0.1", () =>
  console.log("Landing preview: http://localhost:3120 (isolated configuration)"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    void app.close().finally(() => process.exit(0));
  });
