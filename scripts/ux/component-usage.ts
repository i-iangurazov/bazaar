/** Reproducible impact inventory, including public consumers of shared primitives. */
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { posix } from "node:path";

const base = process.argv[2] ?? "7e044f726e19ad835faed03262b1226361cb1178";
const files = execFileSync("rg", ["--files", "src"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((path) => /\.tsx?$/.test(path));
const changed = execFileSync(
  "git",
  ["diff", "--name-only", base, "--", "src/components", "src/lib"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
const modules = new Map(changed.map((path) => [path.replace(/\.tsx?$/, ""), path]));
const consumers = Object.fromEntries(changed.map((path) => [path, [] as string[]]));
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    const target = specifier.startsWith("@/")
      ? `src/${specifier.slice(2)}`
      : specifier.startsWith(".")
        ? posix.normalize(posix.join(posix.dirname(file), specifier))
        : "";
    const module = modules.get(target.replace(/\.tsx?$/, ""));
    if (module && !consumers[module].includes(file)) consumers[module].push(file);
  }
}
await mkdir("artifacts/ux", { recursive: true });
await writeFile("artifacts/ux/component-usage.json", JSON.stringify({ base, consumers }, null, 2));
for (const [module, files] of Object.entries(consumers)) console.log(`${module}: ${files.length}`);
