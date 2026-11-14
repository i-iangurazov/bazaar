// Local files only; this exporter never connects to a database or provider API.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import sharp from "sharp";

const root = resolve(".local/elfbar-independent"), previous = resolve(".local/elfbar-model-comparison");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile("scripts/qa/fixtures/elfbar-independent-photos.json");
const manifest = JSON.parse(manifestBytes);
const policyBytes = await readFile("scripts/qa/fixtures/elfbar-independent-policy.json");
assert.equal(manifest.policySha256, digest(policyBytes));
const priorBytes = await readFile(`${previous}/frozen-inputs.json`);
const priorProtocol = JSON.parse(await readFile("scripts/qa/fixtures/elfbar-model-comparison.json"));
assert.equal(digest(priorBytes), priorProtocol.frozenInputSha256);
const prior = JSON.parse(priorBytes), gallery = prior.test;
assert.equal(gallery.storeId, "photo-search-field-shop");
assert.equal(gallery.sources.length, 38);
const priorHashes = new Set();
for (const split of [prior.calibration, prior.test]) {
  for (const entry of [...split.sources, ...split.queries]) {
    const path = resolve(previous, entry.file);
    assert.ok(!relative(previous, path).startsWith(".."));
    const bytes = await readFile(path); assert.equal(digest(bytes), entry.sha256);
    priorHashes.add(entry.sha256);
  }
}
await mkdir(`${root}/queries`, { recursive: true });
await mkdir(`${root}/gallery`, { recursive: true });
const matrices = {};
for (const model of ["ppshitu", "dinov2-224"]) {
  const file = `gallery/${model}.npy`, original = `${previous}/${model}-test.npy`;
  await copyFile(original, `${root}/${file}`);
  matrices[model] = { file, sha256: digest(await readFile(`${root}/${file}`)) };
}
const queries = [], seen = new Set();
for (const entry of manifest.queries) {
  const source = resolve(root, entry.file);
  assert.ok(!relative(root, source).startsWith(".."));
  const bytes = await readFile(source);
  assert.equal(digest(bytes), entry.sha256); assert.ok(!seen.has(entry.sha256));
  seen.add(entry.sha256);
  const canonical = await sharp(bytes, { pages: 1, limitInputPixels: 40_000_000 }).rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
  assert.ok(!priorHashes.has(digest(canonical)), "Query reuses previous gallery/test bytes");
  const expected = gallery.products.find((product) => product.sku === entry.expectedSku);
  assert.ok(!entry.expectedSku || expected);
  const file = `queries/${entry.id}.jpg`; await writeFile(`${root}/${file}`, canonical);
  queries.push({ ...entry, originalFile: entry.file, originalSha256: entry.sha256,
    expectedId: expected?.id ?? null, file, sha256: digest(canonical), multiObject: false });
}
const data = { schema: 1, manifestSha256: digest(manifestBytes), policySha256: digest(policyBytes),
  previousInputSha256: digest(priorBytes), modelManifestSha256: priorProtocol.modelManifestSha256,
  storeId: gallery.storeId, catalogHash: prior.catalogHash,
  sources: gallery.sources.map(({ ppEmbedding, ...source }) => source), products: gallery.products,
  matrices, queries, databaseWrites: false,
  ingress: "One application-equivalent JPEG canonicalization of the original public photo upload; identical input bytes for both models" };
await writeFile(`${root}/inputs.json`, JSON.stringify(data, null, 2) + "\n");
console.log(JSON.stringify({ queries: queries.length, known: queries.filter((q) => q.expectedId).length,
  absent: queries.filter((q) => !q.expectedId).length, galleryPhotos: gallery.sources.length, databaseWrites: false }));
