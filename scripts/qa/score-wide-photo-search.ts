// Frozen-scope adapter around the application's existing label matcher, no DB/provider.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { scoreWideQuery, wideMetrics as metrics, type WideQuery, type ScoredWideQuery } from "./wide-photo-metrics";
import { productPhotoSearchMinScore } from "../../src/lib/productPhotoSearch";
const root = ".local/product-photo-wide";
const bytes = await readFile(`${root}/inputs.json`), inputs = JSON.parse(bytes.toString());
const native = JSON.parse(await readFile(`${root}/native.json`, "utf8"));
assert.equal(native.inputSha256, createHash("sha256").update(bytes).digest("hex"));
assert.equal(native.threshold, productPhotoSearchMinScore);
const rows = (native.results as WideQuery[]).map((row) => scoreWideQuery(row, inputs.products));
type Row = ScoredWideQuery;
const summary = Object.fromEntries(["sop", "grocery"].map((dataset) => {
  const regular = rows.filter((r: Row) => r.dataset === dataset && !r.counterfactual);
  const timings = regular.map((r: Row & { ms: number }) => r.ms).sort((a: number, b: number) => a-b);
  return [dataset, { overall: metrics(regular), hard: metrics(regular.filter((r: Row) => r.hard)),
    similarAbsent: metrics(regular.filter((r: Row) => !r.known && r.sameCategoryKnown)),
    targetRemoved: metrics(rows.filter((r: Row) => r.dataset === dataset && r.counterfactual)),
    categories: Object.fromEntries([...new Set<string>(regular.map((r: Row) => r.category))].map((category) => [category, metrics(regular.filter((r: Row) => r.category === category))])),
    latencyMs: { p50: timings[Math.floor(timings.length*.5)], p95: timings[Math.floor(timings.length*.95)] } }];
}));
await writeFile(`${root}/scored.json`, JSON.stringify({ inputSha256: native.inputSha256, summary, results: rows }, null, 2)+"\n");
await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2)+"\n");
console.log(JSON.stringify(summary, null, 2));
