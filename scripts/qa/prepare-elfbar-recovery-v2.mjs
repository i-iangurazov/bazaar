// Reproduce real crops from separately supplied, pinned public videos. No network/inference.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const root = resolve(".local/elfbar-recovery-v2");
const protocol = JSON.parse(await readFile("scripts/qa/fixtures/elfbar-recovery-v2.json"));
const ffmpeg = process.argv.find((arg) => arg.startsWith("--ffmpeg="))?.slice(9);
assert.ok(ffmpeg && resolve(ffmpeg) === ffmpeg, "Supply --ffmpeg=/absolute/path/to/ffmpeg");
const local = (file) => { const path = resolve(root, file); assert.ok(!relative(root, path).startsWith("..")); return path; };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const source of [protocol.source, protocol.holdoutSource]) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(local(source.file))) digest.update(chunk);
  assert.equal(digest.digest("hex"), source.sha256);
}
await mkdir(local("review"), { recursive: true }); await mkdir(local("canonical"), { recursive: true });
async function frame(source, seconds, file) {
  await promisify(execFile)(ffmpeg, ["-v", "error", "-ss", String(seconds), "-threads", "2", "-i", local(source.file), "-frames:v", "1", "-y", local(file)], { timeout: 120000 });
}
await frame(protocol.source, protocol.reference.seconds, "review/high-70.png");
const reference = await sharp(local("review/high-70.png")).extract(protocol.reference.crop).rotate(protocol.reference.rotation).jpeg({ quality: 90 }).toBuffer();
assert.equal(hash(reference), protocol.reference.sha256); await writeFile(local(protocol.reference.file), reference);
await frame(protocol.source, protocol.source.labelEvidence.seconds, "review/high-360.png");
const label = await sharp(local("review/high-360.png")).extract({ left: 300, top: 1600, width: 600, height: 800 }).rotate(180).png().toBuffer();
assert.equal(hash(label), protocol.source.labelEvidence.sha256); await writeFile(local(protocol.source.labelEvidence.file), label);
await frame(protocol.holdoutSource, protocol.holdoutSource.labelEvidence.seconds, protocol.holdoutSource.labelEvidence.file);
assert.equal(hash(await readFile(local(protocol.holdoutSource.labelEvidence.file))), protocol.holdoutSource.labelEvidence.sha256);
for (const query of protocol.holdoutQueries) {
  await frame(protocol.holdoutSource, query.seconds, query.file);
  assert.equal(hash(await readFile(local(query.file))), query.sha256);
}
for (const asset of [{ ...protocol.reference, canonicalFile: "canonical/"+protocol.reference.file }, ...protocol.holdoutQueries]) {
  const bytes = await sharp(local(asset.file)).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
  assert.equal(hash(bytes), asset.canonicalSha256); await writeFile(local(asset.canonicalFile), bytes);
}
console.log(JSON.stringify({ sourcesVerified: 2, referenceCrops: 1, newHoldoutQueries: 4, inference: false, downloads: false }));
