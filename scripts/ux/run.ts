import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:https";
import { uxEnvironment, assertUxDatabase } from "./environment";

const tlsDirectory = await mkdtemp(join(tmpdir(), "bazaar-ux-tls-"));
const env = {
  ...uxEnvironment(),
  UX_STAGE: "after",
  UX_HTTPS: "1",
  UX_TLS_KEY_PATH: join(tlsDirectory, "localhost.key"),
  UX_TLS_CERT_PATH: join(tlsDirectory, "localhost.crt"),
};
Object.assign(process.env, env);
assertUxDatabase();
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
await run(process.execPath, ["--import", "tsx", "scripts/ux/seed.ts"]);
// Compile once: the complete 187-screen matrix must use the release runtime,
// without retaining every page's development compiler in the browser CI job.
await run(process.execPath, ["--import", "tsx", "scripts/ux/build.ts"]);
await run("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  env.UX_TLS_KEY_PATH,
  "-out",
  env.UX_TLS_CERT_PATH,
  "-days",
  "1",
  "-subj",
  "/CN=localhost",
  "-addext",
  "subjectAltName=DNS:localhost,IP:127.0.0.1",
]);
const certificate = await readFile(env.UX_TLS_CERT_PATH);
await mkdir("artifacts/ux", { recursive: true });
const log = await open("artifacts/ux/server.log", "w", 0o600);
const server = spawn(process.execPath, ["--import", "tsx", "scripts/ux/dev.ts", "--production"], {
  env: { ...env, NODE_OPTIONS: "--max-old-space-size=6144" },
  stdio: ["ignore", log.fd, log.fd],
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Browser server exited ${server.exitCode}`);
    try {
      const healthy = await new Promise<boolean>((resolve) => {
        // Trust this fixture certificate only; normal TLS verification stays enabled.
        const request = get(
          "https://127.0.0.1:3122/api/auth/csrf",
          { ca: certificate },
          (response) => {
            response.resume();
            resolve(response.statusCode === 200);
          },
        );
        request.on("error", () => resolve(false));
        request.setTimeout(5000, () => request.destroy());
      });
      if (healthy) {
        ready = true;
        break;
      }
    } catch {
      /* Compilation/startup may still be in progress. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("Isolated browser server did not become ready");
  await run(process.execPath, ["--import", "tsx", "scripts/ux/browser.ts"]);
  await run(process.execPath, ["--import", "tsx", "scripts/ux/ui-controls.ts"]);
  await run(process.execPath, ["--import", "tsx", "scripts/ux/shift-close.ts"]);
  await run(process.execPath, ["--import", "tsx", "scripts/ux/details.ts"]);
  await run(process.execPath, ["--import", "tsx", "scripts/ux/capture.ts"]);
} finally {
  server.kill("SIGTERM");
  await log.close();
  await rm(tlsDirectory, { recursive: true, force: true });
}
