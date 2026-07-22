import { CustomerOrderSource, CustomerOrderStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  runBazaarExternalIdBackfill,
  type BazaarExternalIdBackfillEvent,
  verifyBazaarExternalIdBackfillCandidateInsideTransaction,
} from "../../scripts/bazaar-external-id-backfill";
import { prisma } from "@/server/db/prisma";
import {
  analyzeBazaarExternalIdentityRows,
  bazaarExternalIdDigest,
} from "@/server/services/bazaarExternalIdentity";

import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("Bazaar external ID backfill", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("keeps dry-run read-only and applies a clean plan idempotently in batches", async () => {
    const { org, store } = await seedBase();
    await prisma.customerOrder.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          number: "SO-BACKFILL-1",
          source: CustomerOrderSource.API,
          status: CustomerOrderStatus.CONFIRMED,
          notes: "customer comment\nBazaar API externalId: PRIVATE-EXT-1",
        },
        {
          organizationId: org.id,
          storeId: store.id,
          number: "SO-BACKFILL-2",
          source: CustomerOrderSource.API,
          status: CustomerOrderStatus.CONFIRMED,
          notes: "Bazaar API externalId: PRIVATE-EXT-2",
        },
      ],
    });
    const seededOrders = await prisma.customerOrder.findMany({
      where: { organizationId: org.id, source: CustomerOrderSource.API },
      select: { id: true, number: true },
    });
    const dryRunEvents: BazaarExternalIdBackfillEvent[] = [];
    const dryRun = await runBazaarExternalIdBackfill(
      { mode: "dry-run", batchSize: 1 },
      { client: prisma, emit: (event) => dryRunEvents.push(event) },
    );
    expect(dryRun).toMatchObject({
      status: "clean",
      scannedCount: 2,
      candidateCount: 2,
      writtenCount: 0,
    });
    await expect(
      prisma.customerOrder.count({ where: { externalOrderId: { not: null } } }),
    ).resolves.toBe(0);
    const serializedDryRunEvents = dryRunEvents.map((event) => JSON.stringify(event)).join("\n");
    expect(serializedDryRunEvents).not.toContain("PRIVATE-EXT-1");
    expect(serializedDryRunEvents).not.toContain("customer comment");
    expect(dryRunEvents.filter((event) => event.type === "backfill_candidate")).toEqual(
      expect.arrayContaining(
        seededOrders.map((order) => ({
          type: "backfill_candidate",
          orderId: order.id,
          organizationId: org.id,
          storeId: store.id,
          source: "API",
          externalIdDigest: bazaarExternalIdDigest(
            order.number === "SO-BACKFILL-1" ? "PRIVATE-EXT-1" : "PRIVATE-EXT-2",
          ),
        })),
      ),
    );
    expect(dryRunEvents.filter((event) => event.type === "backfill_candidate")).toHaveLength(2);

    const writeEvents: BazaarExternalIdBackfillEvent[] = [];
    const written = await runBazaarExternalIdBackfill(
      { mode: "write", batchSize: 1 },
      { client: prisma, emit: (event) => writeEvents.push(event) },
    );
    expect(written).toMatchObject({
      status: "completed",
      scannedCount: 2,
      candidateCount: 0,
      alreadyPopulatedCount: 2,
      writtenCount: 2,
    });
    await expect(
      prisma.customerOrder.findMany({
        where: { organizationId: org.id, source: CustomerOrderSource.API },
        select: { externalOrderId: true },
        orderBy: { number: "asc" },
      }),
    ).resolves.toEqual([
      { externalOrderId: "PRIVATE-EXT-1" },
      { externalOrderId: "PRIVATE-EXT-2" },
    ]);
    expect(writeEvents.filter((event) => event.type === "write_progress")).toHaveLength(2);

    const replay = await runBazaarExternalIdBackfill(
      { mode: "write", batchSize: 1 },
      { client: prisma },
    );
    expect(replay).toMatchObject({
      status: "completed",
      candidateCount: 0,
      alreadyPopulatedCount: 2,
      writtenCount: 0,
    });
  });

  it("blocks the entire write when the preflight finds an exact collision", async () => {
    const { org, store } = await seedBase();
    await prisma.customerOrder.createMany({
      data: [
        {
          organizationId: org.id,
          storeId: store.id,
          number: "SO-COLLISION-1",
          source: CustomerOrderSource.API,
          notes: "Bazaar API externalId: PRIVATE-COLLISION",
        },
        {
          organizationId: org.id,
          storeId: store.id,
          number: "SO-COLLISION-2",
          source: CustomerOrderSource.API,
          notes: "Bazaar API externalId: PRIVATE-COLLISION",
        },
      ],
    });
    const events: BazaarExternalIdBackfillEvent[] = [];
    const result = await runBazaarExternalIdBackfill(
      { mode: "write", batchSize: 1 },
      { client: prisma, emit: (event) => events.push(event) },
    );

    expect(result).toMatchObject({ status: "blocked", issueCount: 1, writtenCount: 0 });
    expect(events).toContainEqual({
      type: "audit_issue",
      kind: "DUPLICATE_EXTERNAL_ID",
      organizationId: org.id,
      storeId: store.id,
      externalIdDigest: bazaarExternalIdDigest("PRIVATE-COLLISION"),
      orderIds: expect.any(Array),
    });
    expect(JSON.stringify(events)).not.toContain("PRIVATE-COLLISION");
    await expect(
      prisma.customerOrder.count({ where: { externalOrderId: { not: null } } }),
    ).resolves.toBe(0);
  });

  it("rejects a candidate when its exact legacy marker drifts before the write", async () => {
    const { org, store } = await seedBase();
    const order = await prisma.customerOrder.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        number: "SO-DRIFT-1",
        source: CustomerOrderSource.API,
        notes: "Bazaar API externalId: PRIVATE-BEFORE",
      },
      select: {
        id: true,
        organizationId: true,
        storeId: true,
        notes: true,
        externalOrderId: true,
      },
    });
    const audit = analyzeBazaarExternalIdentityRows([order]);
    expect(audit.candidates).toHaveLength(1);

    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { notes: "Bazaar API externalId: PRIVATE-AFTER" },
    });

    await expect(
      prisma.$transaction((tx) =>
        verifyBazaarExternalIdBackfillCandidateInsideTransaction(tx, audit.candidates[0]),
      ),
    ).rejects.toMatchObject({ safeCode: "WRITE_TARGET_DRIFT" });
    await expect(
      prisma.customerOrder.findUniqueOrThrow({
        where: { id: order.id },
        select: { externalOrderId: true },
      }),
    ).resolves.toEqual({ externalOrderId: null });
  });
});
