import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { control, daemon, loadManifest } from "./daemon";
import { applicationFingerprint, initializePaths, runtimeFingerprint } from "./services";
import { requireDiskSpace } from "./files";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const command = process.argv[2] ?? "start";
async function waitForStop() {
  const paths = await initializePaths(root);
  for (let i = 0; i < 360; i++) {
    const live = await control(root).catch(() => null);
    if (!live) {
      const last = JSON.parse(await readFile(paths.status, "utf8")) as {
        phase: string;
        stopErrors?: string[];
      };
      if (last.phase !== "stopped")
        throw new Error(
          `Shutdown did not finish cleanly:${JSON.stringify(last.stopErrors ?? last.phase)}`,
        );
      return;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(
    "Shutdown has not finished;inspect local:status/logs. No force-stop was performed.",
  );
}
async function main() {
  if (command === "daemon") {
    await daemon(root);
    return;
  }
  const paths = await initializePaths(root);
  if (command === "logs") {
    for (const name of ["supervisor", "app", "build"]) {
      console.log(`\n${name}.log`);
      console.log(
        await readFile(join(paths.logs, `${name}.log`), "utf8")
          .then((text) => text.split("\n").slice(-25).join("\n"))
          .catch(() => "No log yet"),
      );
    }
    return;
  }
  if (["status", "backup", "stop"].includes(command)) {
    const result = await control(root, command === "status" ? "/status" : `/${command}`).catch(
      async (error: unknown) => {
        if (command === "status")
          return {
            phase: "not-running",
            reason: String(error),
            lastState: await readFile(paths.status, "utf8")
              .then((text) => JSON.parse(text) as unknown)
              .catch(() => null),
          };
        throw error;
      },
    );
    if (command === "stop") {
      await waitForStop();
      console.log("Bazaar and its managed services stopped;data retained.");
      return;
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command !== "start")
    throw new Error("Use local,local:status,local:stop,local:backup or local:logs.");
  let current = await control(root).catch(() => null);
  let startupExited = false;
  if (current?.phase === "ready") {
    await requireDiskSpace(paths.root);
    const build = await readFile(join(paths.data, "build.json"), "utf8")
      .then((text) => JSON.parse(text) as { fingerprint: string })
      .catch(() => null);
    if (
      build?.fingerprint === (await applicationFingerprint(paths)) &&
      current.runtimeFingerprint === (await runtimeFingerprint(paths)) &&
      current.aiEnabled === (process.env.BAZAAR_LOCAL_AI !== "disabled")
    ) {
      console.log(`Bazaar is already ready: ${String(current.url)}`);
      return;
    }
    console.log("Local code/configuration changed;restarting with a backup.");
    await control(root, "/stop");
    await waitForStop();
    current = null;
  }
  if (!current) {
    await loadManifest(root);
    const log = await open(join(paths.logs, "supervisor-process.log"), "a", 0o600);
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fileURLToPath(import.meta.url), "daemon"],
      { cwd: root, env: process.env, detached: true, stdio: ["ignore", log.fd, log.fd] },
    );
    child.unref();
    child.once("exit", () => {
      startupExited = true;
    });
    child.once("error", () => {
      startupExited = true;
    });
    await log.close();
  }
  let previous = "";
  for (let attempt = 0; attempt < 20 * 60; attempt++) {
    const state = await control(root).catch(() => null);
    const phase = String(state?.phase ?? "starting-supervisor");
    if (phase !== previous) {
      console.log(`Bazaar local: ${phase}`);
      previous = phase;
    }
    if (phase === "ready") {
      console.log(
        `Ready: http://localhost:3122\nData: ${paths.data}\nBackups: ${paths.backups}\nStop: pnpm local:stop`,
      );
      return;
    }
    if (!state && attempt > 3) {
      const last = await readFile(paths.status, "utf8")
        .then((text) => JSON.parse(text) as { phase?: string; error?: string })
        .catch(() => null);
      if (last?.phase === "failed") throw new Error(last.error ?? "Local startup failed");
      if (startupExited)
        throw new Error(
          "Local supervisor exited before readiness;see .local/bazaar/logs/supervisor-process.log.",
        );
    }
    if (phase === "disk-space-blocked") throw new Error(String(state?.error));
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(
    "Local startup timeout;see pnpm local:logs. Durable services/data were not deleted.",
  );
}
main().catch((error: unknown) => {
  console.error(String(error));
  process.exitCode = 1;
});
