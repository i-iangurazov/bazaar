import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { withBaamExecutionContext } from "@/server/services/baamExecutionContext";
import { createSupplier } from "@/server/services/suppliers";

describe.skipIf(!shouldRunDbTests)("BAAM existing domain transaction receipts", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const seed = await seedBase({ plan: "ENTERPRISE" });
    const actor = await prisma.user.findFirstOrThrow({
      where: { organizationId: seed.org.id, role: "MANAGER" },
    });
    const conversation = await prisma.baamConversation.create({
      data: { organizationId: seed.org.id, userId: actor.id, title: "Test" },
    });
    const turn = await prisma.baamTurn.create({
      data: {
        conversationId: conversation.id,
        clientRequestId: randomUUID(),
        requestHash: "test",
        scopeRevision: 0,
        locale: "en",
        leaseUntil: new Date(Date.now() + 60000),
      },
    });
    const attemptToken = randomUUID();
    const action = await prisma.baamAction.create({
      data: {
        conversationId: conversation.id,
        turnId: turn.id,
        tool: "supplier_create",
        fingerprint: "test",
        input: {},
        summary: {},
        scopeRevision: 0,
        status: "RUNNING",
        attemptToken,
      },
    });
    const execution = await prisma.baamExecution.create({
      data: { actionId: action.id, step: "create", fingerprint: "test" },
    });
    const context = {
      executionId: execution.id,
      attemptToken,
      organizationId: seed.org.id,
      actorId: actor.id,
      storeIds: [seed.store.id],
      roles: ["ADMIN", "MANAGER"],
      auditActions: ["SUPPLIER_CREATE"],
    };
    const run = () =>
      withBaamExecutionContext(context, () =>
        createSupplier({
          organizationId: seed.org.id,
          actorId: actor.id,
          requestId: execution.id,
          name: "BAAM concurrent supplier",
        }),
      );
    return { seed, actor, execution, conversation, run };
  }
  it("rolls back the losing concurrent mutation and recovers the committed resource after a lost response", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.run(), f.run()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.supplier.count({ where: { name: "BAAM concurrent supplier" } })).toBe(1);
    const receipt = await prisma.baamExecution.findUniqueOrThrow({ where: { id: f.execution.id } });
    expect(receipt.status).toBe("COMMITTED");
    expect(receipt.receipts).toEqual([
      expect.objectContaining({ entity: "Supplier", entityId: expect.any(String) }),
    ]);
    await expect(f.run()).rejects.toMatchObject({ message: "baamExecutionAlreadyCommitted" });
    expect(await prisma.supplier.count({ where: { name: "BAAM concurrent supplier" } })).toBe(1);
  });
  it("rolls back domain changes and its audit when the dialog context changes", async () => {
    const f = await fixture();
    await prisma.baamConversation.update({
      where: { id: f.conversation.id },
      data: { revision: 1 },
    });
    await expect(f.run()).rejects.toMatchObject({ message: "baamScopeChanged" });
    expect(await prisma.supplier.count({ where: { name: "BAAM concurrent supplier" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: f.execution.id } })).toBe(0);
  });
  it("rechecks a revoked role in the same transaction as the mutation", async () => {
    const f = await fixture();
    await prisma.user.update({ where: { id: f.actor.id }, data: { role: "STAFF" } });
    await expect(f.run()).rejects.toMatchObject({ message: "forbidden" });
    expect(await prisma.supplier.count({ where: { name: "BAAM concurrent supplier" } })).toBe(0);
  });
  it("fences a delayed worker after another attempt claims recovery", async () => {
    const f = await fixture();
    await prisma.baamAction.update({
      where: { id: f.execution.actionId },
      data: { attemptToken: randomUUID() },
    });
    await expect(f.run()).rejects.toMatchObject({ message: "baamScopeChanged" });
    expect(await prisma.supplier.count({ where: { name: "BAAM concurrent supplier" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { requestId: f.execution.id } })).toBe(0);
  });
});
