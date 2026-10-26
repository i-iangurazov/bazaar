/** Development-only screen QA in a disposable source copy and separate cookie host. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { assertUxDatabase, uxEnvironment } from "../ux/environment.ts";

assert.equal(process.env.UX_SUITE, "espresso");
const root = process.cwd();
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(root, true);
Object.assign(process.env, uxEnvironment(), {
  NODE_ENV: "development", NEXTAUTH_URL: "http://espresso-qa.localhost:3123", NEXT_TELEMETRY_DISABLED: "1",
});
assertUxDatabase();

// Next 14's custom-server prepare() reloads config and ignores options.conf.
// Use the standard CLI in a separate project root, rather than sharing .next.
const manifest = resolve(root, ".next/standalone/.next/server/middleware-manifest.json");
const originalManifest = await readFile(manifest);
const workspace = resolve(root, `artifacts/ux/espresso/scanner-dev-${Date.now()}`);
await mkdir(workspace, { recursive: true });
await cp(resolve(root, "src"), resolve(workspace, "src"), { recursive: true });
await cp(resolve(root, "messages"), resolve(workspace, "messages"), { recursive: true });
for (const file of ["package.json", "tsconfig.json", "tailwind.config.ts", "postcss.config.cjs"]) {
  await cp(resolve(root, file), resolve(workspace, file));
}
for (const directory of ["node_modules", "public", "prisma"]) {
  await symlink(resolve(root, directory), resolve(workspace, directory), "dir");
}
await writeFile(resolve(workspace, "next.config.mjs"), [
  `import configured from ${JSON.stringify(relative(workspace, resolve(root, "next.config.mjs")))};`,
  'export default { ...configured, output: undefined, distDir: ".next" };', "",
].join("\n"));
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3123"], {
  cwd: workspace, env: process.env, stdio: "inherit",
});
process.once("SIGINT", () => child.kill("SIGINT"));
process.once("SIGTERM", () => child.kill("SIGTERM"));
const result = await new Promise((done, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => done({ code, signal }));
});
assert((await readFile(manifest)).equals(originalManifest), "Development QA changed the production middleware manifest");
await writeFile(resolve(root, "artifacts/ux/espresso/scanner-dev-isolation.json"), JSON.stringify({
  workspace, database: "bazaar_espresso_ui", url: "http://espresso-qa.localhost:3123",
  productionManifestUnchanged: true,
  productionManifestSha256: createHash("sha256").update(originalManifest).digest("hex"),
  result,
}, null, 2) + "\n");
process.exit(result.code ?? (result.signal === "SIGINT" || result.signal === "SIGTERM" ? 0 : 1));
