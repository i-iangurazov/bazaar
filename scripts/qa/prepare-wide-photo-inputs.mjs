// Apply the existing upload/worker JPEG preparation to a frozen public corpus.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import sharp from "sharp";
const root = resolve(".local/product-photo-wide");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const raw = await readFile(`${root}/manifest.json`), manifest = JSON.parse(raw);
assert.equal(manifest.policySha256, hash(await readFile("scripts/qa/fixtures/product-photo-wide-policy.json")));
await mkdir(`${root}/canonical`, { recursive: true });
const entries = [];
for (const row of manifest.entries) {
  const file = resolve(root, row.file); assert.ok(!relative(root, file).startsWith(".."));
  const source = await readFile(file); assert.equal(hash(source), row.sha256);
  const bytes = await sharp(source, { pages: 1, limitInputPixels: 40_000_000 }).rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
  const canonicalFile = `canonical/${row.id}.jpg`;
  await writeFile(`${root}/${canonicalFile}`, bytes);
  entries.push({ ...row, canonicalFile, canonicalSha256: hash(bytes) });
}
await writeFile(`${root}/inputs.json`, JSON.stringify({ ...manifest, manifestSha256: hash(raw), entries }, null, 2)+"\n");
console.log(JSON.stringify({ photos: entries.length, manifestSha256: hash(raw), inference: false }));
