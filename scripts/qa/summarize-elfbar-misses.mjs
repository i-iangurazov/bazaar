// Reproducible summary of known-case diagnostics and unchanged application queries.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const root = "docs/benchmarks/product-photo-misses-20261114";
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const diagnostic = JSON.parse(gunzipSync(await readFile(`${root}/diagnosis.json.gz`)));
const clip = JSON.parse(gunzipSync(await readFile(`${root}/clip-diagnosis.json.gz`)));
const fixture = await read("scripts/qa/fixtures/elfbar-photo-field.json");
const baseline = await read("docs/benchmarks/product-photo-multiview-20261114/multiview-results.json");
const runs = [baseline, await read(`${root}/fallback36-results.json`), await read(`${root}/gallery40-results.json`), await read(`${root}/approved38-results.json`)];
const keys = (run) => run.results.map((row) => `${row.query}:${row.mode}:${row.inputSha256}`).sort();
function merge(views) {
  const best = new Map();
  for (const view of views) for (const hit of view.top) if ((best.get(hit.group)?.score ?? -Infinity) < hit.score) best.set(hit.group, hit);
  return [...best.values()].sort((a, b) => b.score - a.score);
}
const automatic = (view) => view.kind === "full" || view.kind.startsWith("detection-");
function maxTarget(part, kind, rotate = false) {
  return Math.max(...part.views.filter((view) => kind === "auto" ? automatic(view) : view.kind === kind)
    .flatMap((view) => view.turns.filter((turn) => rotate || !turn.quarterTurns).map((turn) => turn.target?.score ?? -1)));
}
function intersection(a, b) {
  const area = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return area / (a.width * a.height + b.width * b.height - area);
}
for (const run of runs) {
  assert.equal(run.manifestSha256, baseline.manifestSha256);
  assert.deepEqual(keys(run), keys(baseline)); assert.equal(run.results.length, 40);
  assert.equal(run.galleryUnchanged, true); assert.equal(run.originalShopUnchanged, true);
  assert.equal(run.emptyStoreHasNoLeakedCandidates, true); assert.equal(run.threshold, .68);
}
for (const row of diagnostic.results) {
  const prior = baseline.results.find((result) => result.query === row.id && result.mode === "auto");
  const hits = merge(row.low.views.filter(automatic).map((view) => view.turns[0])).filter((hit) => hit.score >= .68);
  assert.equal(row.inputSha256, prior.inputSha256); assert.equal(hits.length, prior.items.length);
  if (hits.length) assert.equal(diagnostic.sources.find((source) => source.group === hits[0].group).productId, prior.items[0].id);
}
const misses = diagnostic.results.filter((row) => row.high).map((row) => {
  const oracle = row.low.views.find((view) => view.kind === "oracle");
  const observations = runs.map((run) => run.results.find((result) => result.query === row.id && result.mode === "auto"));
  return { query: row.id, bestDetectionOracleIoU: Math.max(0, ...row.low.views.filter(automatic).filter((view) => view.region).map((view) => intersection(view.region, oracle.region))),
    scores: { automatic: maxTarget(row.low, "auto"), oldManual: maxTarget(row.low, "manual"), tighterManual: maxTarget(row.low, "oracle"), tighterManualHighResolution: maxTarget(row.high, "oracle"), tighterManualOriginal1080: maxTarget(row.original, "oracle"), tighterManualOriginal1080Rotations: maxTarget(row.original, "oracle", true), allAutoQuarterTurns: maxTarget(row.low, "auto", true) },
    automaticOutcomes: observations.map((result) => result.outcome), regionSources: observations.map((result) => result.recognition.regionSource) };
});
const counts = (rows) => ({ requests: rows.length, correctFirst: rows.filter((row) => row.rank === 1).length,
  correctTop5: rows.filter((row) => row.rank && row.rank <= 5).length, empty: rows.filter((row) => !row.items.length).length, withCandidates: rows.filter((row) => row.items.length).length,
  wrongFirst: rows.filter((row) => row.expectedId && row.items.length && row.items[0].id !== row.expectedId).length });
const clipRows = clip.results.map((row) => ({ ...row, ranked: merge(row.views.filter(automatic)) }));
const clipSingle = clipRows.filter((row) => row.expectedSku && !fixture.queries.find((query) => query.id === row.id).multiObject);
const summary = { schema: 1, baselineAutomaticPredictionsReproduced: 20, misses,
  exploratoryChineseClip: { thresholdCalibrated: false, ppKnownSingleRawTop1: diagnostic.results.filter((row) => row.expectedSku && !row.multiObject && merge(row.low.views.filter(automatic).map((view) => view.turns[0]))[0].sku === row.expectedSku).length, knownSingleRawTop1: clipSingle.filter((row) => row.ranked[0].sku === row.expectedSku).length,
    knownSingleQueries: clipSingle.length, absentTopScores: clipRows.filter((row) => !row.expectedSku).map((row) => ({ query: row.id, score: row.ranked[0].score })) },
  runs: runs.map((run) => ({ label: run.runLabel ?? "baseline36", galleryPhotos: run.galleryProgress.ready,
    modes: ["auto", "manual"].map((mode) => { const rows = run.results.filter((row) => row.mode === mode);
      return { mode, knownSingle: counts(rows.filter((row) => row.expectedId && !row.multiObject)), knownMultiple: counts(rows.filter((row) => row.expectedId && row.multiObject)), absent: counts(rows.filter((row) => !row.expectedId)) }; }) })),
  limits: ["Known development cases; gallery and query frames are correlated within the same videos", "Tighter boxes are human diagnostic upper bounds, not automatic results", "Higher-resolution variants reuse the same timestamps; not additional independent photographs", "Chinese-CLIP scores and native PP scores are not interchangeable or calibrated as probabilities"] };
await writeFile(`${root}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary.runs, null, 2));
