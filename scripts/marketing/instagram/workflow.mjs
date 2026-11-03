import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const hash = (s) => createHash("sha256").update(s).digest("hex");
export async function verifyPackage(row, dir) {
  const { approvalHash, ...content } = row;
  if (hash(JSON.stringify(content)) !== approvalHash)
    throw new Error(`Manifest changed: ${row.id}`);
  for (const file of row.files) {
    if (!/^[a-z0-9_.-]+$/.test(file.file)) throw new Error("Invalid asset path");
    if (hash(await readFile(`${dir}/${file.file}`)) !== file.sha256)
      throw new Error(`Asset changed: ${file.file}`);
  }
}
export function exportQueue(manifest, approvals, campaign) {
  if (manifest.some((r) => r.paid && approvals[r.id]))
    throw new Error(
      "Paid ads cannot be exported by this organic workflow. Budget and launch approval required.",
    );
  return manifest
    .filter((row) => !row.paid && approvals[row.id]?.hash === row.approvalHash)
    .map((row) => ({
      ...row,
      status: "ready_for_manual_scheduling",
      approvedBy: approvals[row.id].by,
      approvedAt: approvals[row.id].at,
      idempotencyKey: `${campaign}:${row.id}:${row.approvalHash}`,
    }));
}
async function main() {
  const [action, id, suppliedHash, by] = process.argv.slice(2);
  const dir = "artifacts/instagram-canva-20261103";
  const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, "utf8"));
  const approvalFile = `${dir}/approvals.json`;
  let approvals = {};
  try {
    await access(approvalFile);
    approvals = JSON.parse(await readFile(approvalFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (action === "review") {
    manifest.forEach((row) =>
      console.log(
        `${row.id} ${row.paid ? "PAID BLOCKED" : approvals[row.id]?.hash === row.approvalHash ? "approved" : "draft"} ${row.approvalHash}`,
      ),
    );
  } else if (action === "approve") {
    const row = manifest.find((r) => r.id === id);
    if (!row || !by || suppliedHash !== row.approvalHash)
      throw new Error("Usage: approve ID REVIEWED_HASH REVIEWER");
    if (row.paid) throw new Error("Ads remain draft until a separate budget and launch approval.");
    await verifyPackage(row, dir);
    approvals[id] = { hash: suppliedHash, by, at: new Date().toISOString() };
    await writeFile(approvalFile, JSON.stringify(approvals, null, 2), { mode: 0o600 });
    console.log("Local approval saved; nothing has been scheduled or published.");
  } else if (action === "export") {
    const queue = exportQueue(manifest, approvals, "kg_store_launch_202611");
    const campaignHash = hash(
      await readFile("docs/marketing/instagram-2026-11/campaign.json", "utf8"),
    );
    for (const row of queue) {
      if (row.campaignHash !== campaignHash)
        throw new Error(`Brief changed; re-import and review: ${row.id}`);
      await verifyPackage(row, dir);
    }
    await writeFile(`${dir}/approved-queue.json`, JSON.stringify(queue, null, 2));
    console.log(
      `${queue.length} approved packages exported. External scheduling requires a connected Bazaar account.`,
    );
  } else throw new Error("Use review, approve ID HASH REVIEWER, or export");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
