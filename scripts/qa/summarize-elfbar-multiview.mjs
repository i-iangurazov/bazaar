// Compare the same frozen real-camera inputs, retaining misses and wrong candidates.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const root = "docs/benchmarks/product-photo-multiview-20261114";
const files = ["docs/benchmarks/product-photo-field-20261114/results.json", `${root}/detector-results.json`, `${root}/multiview-results.json`];
const labels = ["baseline", "detector", "multiview"];
const runs = await Promise.all(files.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
const keys = (run) => run.results.map((row) => `${row.query}:${row.mode}:${row.inputSha256}`).sort();
const quantile = (rows, q) => { const sorted = rows.map((row) => row.ms).sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * q) - 1]; };
const count = (rows) => ({ requests: rows.length, correctFirst: rows.filter((row) => row.rank === 1).length,
  correctTop5: rows.filter((row) => row.rank && row.rank <= 5).length,
  wrongFirst: rows.filter((row) => row.expectedId && row.items.length && row.items[0].id !== row.expectedId).length,
  empty: rows.filter((row) => !row.items.length).length,
  withCandidates: rows.filter((row) => row.items.length).length,
  textMatched: rows.filter((row) => row.recognition.labelStatus === "matched").length });
for (const run of runs) {
  assert.equal(run.manifestSha256, runs[0].manifestSha256); assert.equal(run.threshold, 0.68);
  assert.deepEqual(keys(run), keys(runs[0])); assert.equal(run.results.length, 40);
  assert.equal(run.galleryUnchanged, true); assert.equal(run.originalShopUnchanged, true);
  assert.equal(run.emptyStoreHasNoLeakedCandidates, true);
}
const summary = runs.map((run, i) => ({ run: labels[i], galleryPhotos: run.galleryProgress.ready,
  uniqueInputs: run.uniqueQueries, requests: run.results.length,
  modes: ["auto", "manual"].map((mode) => {
    const rows = run.results.filter((row) => row.mode === mode);
    return { mode, knownSingle: count(rows.filter((row) => row.expectedId && !row.multiObject)),
      knownMultiple: count(rows.filter((row) => row.expectedId && row.multiObject)),
      absent: count(rows.filter((row) => !row.expectedId)),
      latencyMs: { p50: quantile(rows, .5), p95: quantile(rows, .95), max: Math.max(...rows.map((row) => row.ms)) },
      flavors: [...new Set(rows.map((row) => row.expectedSku))].filter(Boolean).map((sku) => ({ sku, ...count(rows.filter((row) => row.expectedSku === sku)) })) };
  }) }));
await writeFile(`${root}/summary.json`, JSON.stringify({ schema: 1, frozenQueryManifestSha256: runs[0].manifestSha256,
  limitations: ["Same known inputs used during development; not an independent accuracy estimate", "Gallery and query frames are correlated within source videos", "Sequential local API latency; no production throughput measurement"], runs: summary }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
