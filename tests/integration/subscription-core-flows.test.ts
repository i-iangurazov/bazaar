import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { createContractTerms } from "@/server/billing/contractTerms";
import {
  startInitialProductImport,
  getInitialProductImportStatus,
} from "@/server/billing/initialProductImport";
import { getSubscriptionUsage } from "@/server/billing/subscriptionUsage";
import { assertProductExportAccess, assertReadableFeature } from "@/server/billing/coreAccess";
import {
  runProductImport,
  listImportBatches,
  rollbackImportBatch,
} from "@/server/services/imports";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

async function seedModern(plan: "STARTER" | "BUSINESS" = "STARTER") {
  const f = await seedBase({ plan });
  await prisma.organization.update({ where: { id: f.org.id }, data: {
    currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000),
  } });
  await prisma.user.updateMany({
    where: { organizationId: f.org.id, id: { not: f.adminUser.id } },
    data: { isActive: false },
  });
  await prisma.subscriptionContract.create({
    data: {
      organizationId: f.org.id,
      catalogVersion: "2026-11",
      termsSnapshot: createContractTerms("2026-11"),
    },
  });
  return f;
}
const initialUsage = async (id: string) =>
  (await getSubscriptionUsage(id)).find((row) => row.resource === "initialImport");
const start = (f: Awaited<ReturnType<typeof seedModern>>, rowCounts: number[]) =>
  startInitialProductImport({ organizationId: f.org.id, actorId: f.adminUser.id, rowCounts });
function upload(
  f: Awaited<ReturnType<typeof seedModern>>,
  sessionId: string,
  chunkIndex: number,
  sku: string,
  unit = f.baseUnit.code,
  key = randomUUID(),
) {
  return runProductImport({
    organizationId: f.org.id,
    actorId: f.adminUser.id,
    storeId: f.store.id,
    requestId: key,
    idempotencyKey: key,
    initialImportChunk: { sessionId, chunkIndex },
    rows: [{ sku, name: sku, unit }],
  });
}

(shouldRunDbTests ? describe : describe.skip)("new catalog core flows on PostgreSQL", () => {
  beforeEach(resetDatabase);
  it("imports one file in resumable chunks and consumes one allowance only after all chunks", async () => {
    const f = await seedModern();
    const session = await start(f, [1, 1]);
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 0, reserved: 1 });
    const a = await upload(f, session.sessionId, 0, "INITIAL-A");
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 0, reserved: 1 });
    const replay = await upload(f, session.sessionId, 0, "INITIAL-A");
    expect(replay.batch.id).toBe(a.batch.id);
    expect(
      await prisma.product.count({ where: { organizationId: f.org.id, sku: "INITIAL-A" } }),
    ).toBe(1);
    await upload(f, session.sessionId, 1, "INITIAL-B");
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 1, reserved: 0, remaining: 0 });
    expect(await getInitialProductImportStatus(f.org.id)).toMatchObject({
      complete: true,
      completedChunks: expect.arrayContaining([0, 1]),
    });
    await expect(start(f, [1])).rejects.toThrow("billingUsageAlreadyCompleted");
    const postCompleteReplay = await upload(f, session.sessionId, 0, "INITIAL-A");
    expect(postCompleteReplay.batch.id).toBe(a.batch.id);
  });
  it("preserves applied chunks when a later chunk fails and permits correction of the unapplied chunk", async () => {
    const f = await seedModern();
    const session = await start(f, [1, 1]);
    await upload(f, session.sessionId, 0, "GOOD-A");
    await prisma.product.createMany({ data: Array.from({ length: 998 }, (_, i) => ({
      organizationId: f.org.id, name: `Capacity ${i}`, sku: `CAP-${i}`,
      unit: f.baseUnit.code, baseUnitId: f.baseUnit.id,
    })) });
    await expect(upload(f, session.sessionId, 1, "BAD-B")).rejects.toThrow();
    expect(
      await prisma.initialProductImportChunk.count({ where: { sessionId: session.sessionId } }),
    ).toBe(1);
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 0, reserved: 1 });
    await expect(upload(f, session.sessionId, 0, "CHANGED-A")).rejects.toThrow(
      "initialImportChunkChanged",
    );
    await prisma.product.update({ where: { id: f.product.id }, data: { isDeleted: true } });
    await upload(f, session.sessionId, 1, "CORRECTED-B");
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 1, reserved: 0 });
  });
  it("serializes concurrent initial-file starts and duplicate chunk submissions", async () => {
    const f = await seedModern();
    const starts = await Promise.all([start(f, [1, 1]), start(f, [1, 1])]);
    expect(starts[0].sessionId).toBe(starts[1].sessionId);
    const results = await Promise.all([
      upload(f, starts[0].sessionId, 0, "RACE"),
      upload(f, starts[0].sessionId, 0, "RACE"),
    ]);
    expect(results[0].batch.id).toBe(results[1].batch.id);
    expect(
      await prisma.initialProductImportChunk.count({ where: { sessionId: starts[0].sessionId } }),
    ).toBe(1);
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 0, reserved: 1 });
  });
  it("limits the declared file, rejects a different manifest and resumes a stale reservation", async () => {
    const f = await seedModern();
    await expect(start(f, [1000, 1])).rejects.toThrow("importTooLarge");
    const session = await start(f, [1, 1]);
    await expect(start(f, [1])).rejects.toThrow("initialImportSessionMismatch");
    await upload(f, session.sessionId, 0, "STALE-A");
    await prisma.subscriptionUsageReservation.updateMany({
      where: { organizationId: f.org.id, resource: "initialImport" },
      data: { expiresAt: new Date(0) },
    });
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 0, reserved: 0 });
    expect((await start(f, [1, 1])).sessionId).toBe(session.sessionId);
    await upload(f, session.sessionId, 1, "STALE-B");
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 1, reserved: 0 });
  });
  it("keeps Starter initial history but does not open rollback or repeat imports", async () => {
    const f = await seedModern();
    const session = await start(f, [1]);
    const result = await upload(f, session.sessionId, 0, "ONCE");
    expect((await listImportBatches({ organizationId: f.org.id })).items).toHaveLength(1);
    await expect(
      rollbackImportBatch({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        batchId: result.batch.id,
      }),
    ).rejects.toThrow("featureLockedImports");
    await expect(
      runProductImport({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        storeId: f.store.id,
        rows: [{ sku: "BYPASS", unit: f.baseUnit.code }],
      }),
    ).rejects.toThrow("initialImportSessionRequired");
  });
  it("preserves repeated Business imports and does not consume an initial-import allowance", async () => {
    const f = await seedModern("BUSINESS");
    for (const sku of ["REPEAT-A", "REPEAT-B"])
      await runProductImport({
        organizationId: f.org.id,
        actorId: f.adminUser.id,
        requestId: randomUUID(),
        storeId: f.store.id,
        rows: [{ sku, name: sku, unit: f.baseUnit.code }],
      });
    expect(await prisma.importBatch.count({ where: { organizationId: f.org.id } })).toBe(2);
    expect(await initialUsage(f.org.id)).toMatchObject({ used: 0, reserved: 0 });
  });
  it("keeps paid historical analytics and owner raw export after expiry without opening staff export", async () => {
    const f = await seedModern("BUSINESS");
    await prisma.organization.update({
      where: { id: f.org.id },
      data: {
        trialEndsAt: new Date(0),
        currentPeriodEndsAt: new Date(0),
        subscriptionStatus: "PAST_DUE",
      },
    });
    await expect(assertReadableFeature(f.org.id, "analytics")).resolves.toBeTruthy();
    await expect(
      assertProductExportAccess({ organizationId: f.org.id, actorId: f.adminUser.id }),
    ).resolves.toBeUndefined();
  });
  it("keeps new Starter raw export owner-only", async () => {
    const f = await seedModern();
    await expect(
      assertProductExportAccess({ organizationId: f.org.id, actorId: f.adminUser.id }),
    ).resolves.toBeUndefined();
    await expect(
      assertProductExportAccess({ organizationId: f.org.id, actorId: f.managerUser.id }),
    ).rejects.toThrow("forbidden");
  });
});
