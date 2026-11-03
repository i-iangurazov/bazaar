import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Offline production scripts are tested against synthetic records, with no provider calls.
// @ts-expect-error Standalone JS command has no declaration file.
import { exportQueue, hash, verifyPackage } from "../../scripts/marketing/instagram/workflow.mjs";
// @ts-expect-error Standalone JS command has no declaration file.
import { summarize } from "../../scripts/marketing/instagram/report.mjs";

describe("Instagram approval and outcome reporting", () => {
  it("rejects a changed asset or caption after review", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bazaar-ig-review-"));
    try {
      await writeFile(join(dir, "r01_ru.png"), "original asset");
      const row = {
        id: "r01_ru",
        caption: "Reviewed copy",
        files: [{ file: "r01_ru.png", sha256: hash("original asset") }],
      };
      const approved = { ...row, approvalHash: hash(JSON.stringify(row)) };
      await expect(verifyPackage(approved, dir)).resolves.toBeUndefined();
      await expect(verifyPackage({ ...approved, caption: "Changed claim" }, dir)).rejects.toThrow(
        "Manifest changed",
      );
      await writeFile(join(dir, "r01_ru.png"), "different asset");
      await expect(verifyPackage(approved, dir)).rejects.toThrow("Asset changed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("exports only exact approved organic content and uses a stable idempotency key", () => {
    const draft = { id: "r01_ru", approvalHash: "current", paid: false };
    expect(exportQueue([draft], {}, "campaign")).toEqual([]);
    expect(exportQueue([draft], { r01_ru: { hash: "stale" } }, "campaign")).toEqual([]);
    const approvals = { r01_ru: { hash: "current", by: "owner", at: "2026-11-03" } };
    expect(exportQueue([draft], approvals, "campaign")[0].idempotencyKey).toBe(
      "campaign:r01_ru:current",
    );
    expect(exportQueue([draft], approvals, "campaign")).toEqual(
      exportQueue([draft], approvals, "campaign"),
    );
  });
  it("blocks ads even when someone adds an approval", () => {
    expect(() =>
      exportQueue([{ id: "ad01_ru", paid: true }], { ad01_ru: { hash: "x" } }, "campaign"),
    ).toThrow("Paid ads");
  });
  it("deduplicates qualified outcomes and keeps paid costs separate from organic", () => {
    const base = {
      campaign: "kg_store_launch_202611",
      content: "ad01_ru",
      medium: "paid_social",
      evidence: "synthetic",
      entityId: "business-1",
    };
    const report = summarize({
      currency: "KGS",
      spend: [{ campaign: base.campaign, content: base.content, amount: 900 }],
      events: [
        { ...base, kind: "qualified" },
        { ...base, kind: "qualified" },
        { ...base, kind: "registration" },
        {
          ...base,
          medium: "organic_social",
          content: "r01_ru",
          entityId: "business-2",
          kind: "registration",
        },
      ],
    });
    expect(report.rows[0]).toMatchObject({
      qualified: 1,
      cpqlKgs: 900,
      costPerRegistrationKgs: 900,
      mediaCacKgs: null,
    });
    expect(report.rows[1].costPerRegistrationKgs).toBeNull();
    expect(report.unique.registeredOrganizations).toBe(2);
  });
  it("requires evidence and never fabricates a conversion with a zero denominator", () => {
    expect(summarize({ currency: "KGS", spend: [], events: [] }).unique.qualified).toBe(0);
    expect(() => summarize({ currency: "USD", spend: [], events: [] })).toThrow("KGS");
    expect(() =>
      summarize({
        currency: "KGS",
        spend: [],
        events: [{ campaign: "kg_store_launch_202611", kind: "qualified" }],
      }),
    ).toThrow("evidence");
  });
});
