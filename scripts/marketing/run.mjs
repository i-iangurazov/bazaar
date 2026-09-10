import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";

await mkdir("artifacts/bazaar-landing-redesign", { recursive: true });
const output = await open("artifacts/bazaar-landing-redesign/server.log", "w");
const server = spawn(process.execPath, ["scripts/marketing/serve.mjs"], {
  stdio: ["ignore", output.fd, output.fd],
});
const deadline = Date.now() + 120_000;
let ready = false;
try {
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      const response = await fetch("http://localhost:3120/", { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for Next compilation. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Isolated landing server did not start");
  const browser = spawn(process.execPath, ["scripts/marketing/browser.mjs"], {
    stdio: "inherit",
    env: { ...process.env, QA_BASE_URL: "http://localhost:3120" },
  });
  process.exitCode = await new Promise((resolve) =>
    browser.on("exit", (code) => resolve(code ?? 1)),
  );
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve();
    else {
      server.once("exit", resolve);
      setTimeout(() => {
        server.kill("SIGKILL");
        resolve();
      }, 10_000).unref();
    }
  });
  await output.close();
}
