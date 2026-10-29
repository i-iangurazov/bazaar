import { spawn } from "node:child_process";
import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { catalogQaEnvironment, catalogQaDatabaseUrl } from "./environment";

const root = process.cwd();
const env = catalogQaEnvironment();
const admin = new PrismaClient({
  datasourceUrl: catalogQaDatabaseUrl.replace(/\/bazaar_hardening_agent4_platform$/, "/postgres"),
});
const [identity] = await admin.$queryRaw<
  Array<{ directory: string }>
>`SELECT current_setting('data_directory') AS directory`;
if (!identity.directory.startsWith("/private/tmp/bazaar-catalog-20261029."))
  throw new Error("Refusing non-disposable database cluster");
const existing = await admin.$queryRaw<
  Array<{ datname: string }>
>`SELECT datname FROM pg_database WHERE datname = 'bazaar_hardening_agent4_platform'`;
if (!existing.length)
  await admin.$executeRawUnsafe('CREATE DATABASE "bazaar_hardening_agent4_platform"');
await admin.$disconnect();
const migration = spawn("pnpm", ["prisma:migrate"], { env, stdio: "inherit" });
if ((await new Promise((resolve) => migration.on("exit", resolve))) !== 0)
  throw new Error("QA migration failed");
const workspace = resolve(root, "artifacts/catalog-pricing-20261029/app");
await mkdir(workspace, { recursive: true });
for (const directory of ["src", "messages"])
  await cp(resolve(root, directory), resolve(workspace, directory), { recursive: true });
for (const file of ["package.json", "tsconfig.json", "tailwind.config.ts", "postcss.config.cjs"])
  await cp(resolve(root, file), resolve(workspace, file));
for (const directory of ["node_modules", "public", "prisma"]) {
  try {
    await symlink(resolve(root, directory), resolve(workspace, directory), "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
await writeFile(
  resolve(workspace, "next.config.mjs"),
  `import config from ${JSON.stringify(resolve(root, "next.config.mjs"))};
export default { ...config, output: undefined, webpack(c, options) {
  const result = config.webpack ? config.webpack(c, options) : c;
  result.cache = false;
  return result;
} };\n`,
);
const require = createRequire(import.meta.url);
const production = process.argv.includes("--production");
if (production) {
  const build = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "build"], {
    cwd: workspace, env: { ...env, NODE_ENV: "production" }, stdio: "inherit",
  });
  if ((await new Promise(resolve => build.on("exit", resolve))) !== 0) throw new Error("QA production build failed");
}
const server = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), production ? "start" : "dev", "--hostname", "127.0.0.1", "--port", "3124"],
  {
    cwd: workspace,
    env: { ...env, NODE_ENV: production ? "production" : "development" },
    stdio: "inherit",
  },
);
process.on("SIGTERM", () => server.kill("SIGTERM"));
process.on("SIGINT", () => server.kill("SIGINT"));
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
