// Reproduce actual stock-image crops; never turn query photos into references.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, dirname } from "node:path";
import sharp from "sharp";
const root = resolve(".local/elfbar-pp-improve");
const fixture = JSON.parse(await readFile("scripts/qa/fixtures/elfbar-miami-references.json"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const local = (file) => { const p = resolve(root, file); assert.ok(!relative(root, p).startsWith("..")); return p; };
let bytes;
try { bytes = await readFile(local(fixture.source.file)); } catch {
  assert.ok(process.argv.includes("--download"), "Supply public reference or explicitly use --download");
  const url = new URL(fixture.source.url); assert.equal(url.protocol, "https:"); assert.equal(url.hostname, "dcdn-us.mitiendanube.com");
  const response = await fetch(url, { redirect: "error", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const chunks = []; let total = 0;
  for await (const chunk of response.body) { total += chunk.length; assert.ok(total <= 1_000_000); chunks.push(chunk); }
  bytes = Buffer.concat(chunks); assert.equal(hash(bytes), fixture.source.sha256);
  await mkdir(dirname(local(fixture.source.file)), { recursive: true }); await writeFile(local(fixture.source.file), bytes);
}
assert.equal(hash(bytes), fixture.source.sha256);
const queries = JSON.parse(await readFile("scripts/qa/fixtures/elfbar-independent-photos.json"));
assert.ok(!queries.queries.some((query) => query.sha256 === hash(bytes) || query.url === fixture.source.url));
for (const asset of fixture.assets) {
  const image = await sharp(bytes).extract(asset.crop).jpeg({ quality: 90 }).toBuffer();
  assert.equal(hash(image), asset.sha256); await writeFile(local(asset.file), image);
  const canonical = await sharp(image).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
  await mkdir(local("canonical"), { recursive: true });
  if (asset.canonicalSha256) assert.equal(hash(canonical), asset.canonicalSha256);
  await writeFile(local(`canonical/${asset.file}`), canonical);
}
console.log(JSON.stringify({ referenceCrops: fixture.assets.length, sourceImages: 1, queryPhotosIndexed: 0 }));
