import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { eventBus, type EventPayload } from "@/server/events/eventBus";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;
describeDb("POS shift close resolution", () => {
  beforeEach(resetDatabase);
  async function setup() {
    const f = await seedBase({ plan: "ENTERPRISE", allowNegativeStock: true });
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    const register = await prisma.posRegister.create({
      data: { organizationId: f.org.id, storeId: f.store.id, name: "Close QA", code: "CLOSE" },
    });
    const cashier = createTestCaller({ ...f.cashierUser, organizationId: f.org.id });
    const manager = createTestCaller({ ...f.managerUser, organizationId: f.org.id });
    const admin = createTestCaller({ ...f.adminUser, organizationId: f.org.id });
    const shift = await cashier.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    const draft = () =>
      cashier.pos.sales.createDraft({
        registerId: register.id,
        lines: [{ productId: f.product.id, qty: 2 }],
      });
    return { ...f, register, shift, cashier, manager, admin, draft };
  }

  it("lets a cashier cancel a shared held receipt without opening a different active receipt", async () => {
    const f = await setup();
    const held = await f.manager.pos.sales.createDraft({
      registerId: f.register.id,
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    await f.manager.pos.sales.holdDraft({ saleId: held.id });
    const active = await f.draft();
    await f.cashier.pos.sales.cancelDraft({ saleId: held.id });
    const current = await f.cashier.pos.shifts.current({ registerId: f.register.id });
    expect(current?.heldReceiptCount).toBe(0);
    expect(current?.activeReceipts.map((r) => r.id)).toEqual([active.id]);
    expect(await prisma.salePayment.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("makes cancellation retry safe and allows supervisors to resolve another cashier's active draft", async () => {
    const f = await setup();
    const sale = await f.draft();
    const first = await f.manager.pos.sales.cancelDraft({ saleId: sale.id });
    expect(await f.manager.pos.sales.cancelDraft({ saleId: sale.id })).toEqual(first);
    expect(
      await prisma.auditLog.count({
        where: { action: "POS_SALE_DRAFT_CANCEL", entityId: sale.id },
      }),
    ).toBe(1);
    expect(
      (
        await f.cashier.pos.shifts.close({
          shiftId: f.shift.id,
          closingCashCountedKgs: 0,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe("CLOSED");
  });

  it("reconciles a lost resume response to the same receipt and completes it only once", async () => {
    const f = await setup();
    const sale = await f.draft();
    await f.cashier.pos.sales.holdDraft({ saleId: sale.id });
    const request = { saleId: sale.id, registerId: f.register.id };
    expect((await f.cashier.pos.sales.resumeHeldDraft(request)).id).toBe(sale.id);
    expect((await f.cashier.pos.sales.resumeHeldDraft(request)).id).toBe(sale.id);
    const completion = {
      saleId: sale.id,
      payments: [{ method: "CASH" as const, amountKgs: 200 }],
      idempotencyKey: randomUUID(),
    };
    await f.cashier.pos.sales.complete(completion);
    const close = { shiftId: f.shift.id, closingCashCountedKgs: 200, idempotencyKey: randomUUID() };
    const results = await Promise.all([
      f.cashier.pos.shifts.close(close),
      f.cashier.pos.shifts.close(close),
    ]);
    expect(results.map((r) => r.status)).toEqual(["CLOSED", "CLOSED"]);
    await f.cashier.pos.sales.complete(completion);
    expect(await prisma.customerOrder.count({ where: { status: "COMPLETED" } })).toBe(1);
    expect(await prisma.salePayment.count()).toBe(1);
    expect((await prisma.stockMovement.aggregate({ _sum: { qtyDelta: true } }))._sum.qtyDelta).toBe(
      -2,
    );
    expect(
      await prisma.auditLog.count({ where: { action: "POS_SHIFT_CLOSE", entityId: f.shift.id } }),
    ).toBe(1);
    expect(results[0].expectedCashKgs).toBe(200);
  });

  it("returns the exact blocking receipt and keeps an unsuccessful payment free of side effects", async () => {
    const f = await setup();
    const sale = await f.draft();
    await expect(
      f.cashier.pos.sales.complete({
        saleId: sale.id,
        payments: [{ method: "CARD", amountKgs: 100 }],
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("posPaymentTotalMismatch");
    expect(await prisma.salePayment.count()).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
    const blocked = await f.cashier.pos.shifts
      .close({ shiftId: f.shift.id, closingCashCountedKgs: 0, idempotencyKey: randomUUID() })
      .catch((e) => e);
    expect(blocked.message).toBe("posShiftDraftsOpen");
    expect(blocked.cause?.details).toMatchObject({
      shiftId: f.shift.id,
      registerId: f.register.id,
      receipts: [{ id: sale.id, number: sale.number }],
    });
    const current = await f.cashier.pos.shifts.current({ registerId: f.register.id });
    expect(current?.activeReceipts[0]).toMatchObject({
      id: sale.id,
      totalKgs: 200,
      lineCount: 1,
      canCancel: true,
    });
    await f.cashier.pos.sales.cancelDraft({ saleId: sale.id });
    expect(
      (
        await f.cashier.pos.shifts.close({
          shiftId: f.shift.id,
          closingCashCountedKgs: 0,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe("CLOSED");
  });

  it("never treats a recorded payment as an ordinary cancelable draft", async () => {
    const f = await setup();
    const sale = await f.draft();
    await prisma.salePayment.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        shiftId: f.shift.id,
        customerOrderId: sale.id,
        method: "CASH",
        amountKgs: 200,
      },
    });
    await expect(f.cashier.pos.sales.cancelDraft({ saleId: sale.id })).rejects.toThrow(
      "posDraftHasRecordedOperations",
    );
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(
      "DRAFT",
    );
    expect(await prisma.salePayment.count()).toBe(1);
  });

  it("does not give a cashier cancellation rights to another cashier's active receipt or another organization", async () => {
    const f = await setup();
    const sale = await f.manager.pos.sales.createDraft({ registerId: f.register.id });
    await expect(f.cashier.pos.sales.cancelDraft({ saleId: sale.id })).rejects.toThrow(
      "posSaleOwnerMismatch",
    );
    const foreign = await prisma.organization.create({
      data: { name: "Other organization", plan: "ENTERPRISE" },
    });
    const outsider = createTestCaller({ ...f.adminUser, organizationId: foreign.id });
    await expect(outsider.pos.sales.cancelDraft({ saleId: sale.id })).rejects.toThrow(
      "posSaleNotFound",
    );
    await expect(
      outsider.pos.shifts.close({
        shiftId: f.shift.id,
        closingCashCountedKgs: 0,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("posShiftNotFound");
  });

  it.each(["cashier", "manager", "admin"] as const)(
    "lets %s clear an empty draft and close a shift",
    async (role) => {
      const f = await setup();
      const api = f[role];
      const empty = await api.pos.sales.createDraft({ registerId: f.register.id });
      expect(
        (await api.pos.shifts.current({ registerId: f.register.id }))?.activeReceipts[0].lineCount,
      ).toBe(0);
      await api.pos.sales.cancelDraft({ saleId: empty.id });
      const result = await api.pos.shifts.close({
        shiftId: f.shift.id,
        closingCashCountedKgs: 0,
        idempotencyKey: randomUUID(),
      });
      expect(result.status).toBe("CLOSED");
      expect(result.expectedCashKgs).toBe(0);
      expect(await prisma.salePayment.count()).toBe(0);
      expect(await prisma.stockMovement.count()).toBe(0);
    },
  );

  it("resolves several held, active and return drafts without undoing the completed source sale", async () => {
    const f = await setup();
    const sold = await f.draft();
    await f.cashier.pos.sales.complete({
      saleId: sold.id,
      payments: [{ method: "CASH", amountKgs: 200 }],
      idempotencyKey: randomUUID(),
    });
    const returned = await f.cashier.pos.returns.createDraft({
      shiftId: f.shift.id,
      originalSaleId: sold.id,
    });
    const held = await f.draft();
    await f.cashier.pos.sales.holdDraft({ saleId: held.id });
    const empty = await f.cashier.pos.sales.createDraft({ registerId: f.register.id });
    expect(await f.cashier.pos.shifts.current({ registerId: f.register.id })).toMatchObject({
      heldReceiptCount: 1,
      activeReceiptCount: 1,
      returnDraftCount: 1,
    });
    await f.cashier.pos.sales.cancelDraft({ saleId: held.id });
    await f.cashier.pos.sales.cancelDraft({ saleId: empty.id });
    await f.cashier.pos.returns.cancel({ saleReturnId: returned.id, idempotencyKey: randomUUID() });
    expect(await f.cashier.pos.shifts.current({ registerId: f.register.id })).toMatchObject({
      heldReceiptCount: 0,
      activeReceiptCount: 0,
      returnDraftCount: 0,
    });
    expect(
      (
        await f.admin.pos.shifts.close({
          shiftId: f.shift.id,
          closingCashCountedKgs: 200,
          idempotencyKey: randomUUID(),
        })
      ).expectedCashKgs,
    ).toBe(200);
    expect(await prisma.salePayment.count()).toBe(1);
    expect((await prisma.stockMovement.aggregate({ _sum: { qtyDelta: true } }))._sum.qtyDelta).toBe(
      -2,
    );
  });

  it("ignores drafts belonging to another register and shift", async () => {
    const f = await setup();
    const otherRegister = await f.admin.pos.registers.create({
      storeId: f.store.id,
      name: "Other register",
      code: "OTHER",
    });
    const otherShift = await f.cashier.pos.shifts.open({
      registerId: otherRegister.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    const otherDraft = await f.cashier.pos.sales.createDraft({ registerId: otherRegister.id });
    expect(await f.cashier.pos.shifts.current({ registerId: f.register.id })).toMatchObject({
      heldReceiptCount: 0,
      activeReceiptCount: 0,
      returnDraftCount: 0,
    });
    await f.cashier.pos.shifts.close({
      shiftId: f.shift.id,
      closingCashCountedKgs: 0,
      idempotencyKey: randomUUID(),
    });
    expect(
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: otherDraft.id } })).status,
    ).toBe("DRAFT");
    expect(
      (await prisma.registerShift.findUniqueOrThrow({ where: { id: otherShift.id } })).status,
    ).toBe("OPEN");
  });

  it("serializes opening a new draft against closing the same shift", async () => {
    const f = await setup();
    const [closed, created] = await Promise.allSettled([
      f.cashier.pos.shifts.close({
        shiftId: f.shift.id,
        closingCashCountedKgs: 0,
        idempotencyKey: randomUUID(),
      }),
      f.cashier.pos.sales.createDraft({ registerId: f.register.id }),
    ]);
    expect([closed.status, created.status].filter((s) => s === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.customerOrder.count({ where: { status: "DRAFT", shift: { status: "CLOSED" } } }),
    ).toBe(0);
  });

  it("closes with the committed payment total when a sale completes concurrently", async () => {
    const f = await setup();
    const sale = await f.draft();
    const [completion, close] = await Promise.allSettled([
      f.cashier.pos.sales.complete({
        saleId: sale.id,
        payments: [{ method: "CASH", amountKgs: 200 }],
        idempotencyKey: randomUUID(),
      }),
      f.cashier.pos.shifts.close({
        shiftId: f.shift.id,
        closingCashCountedKgs: 200,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(completion.status).toBe("fulfilled");
    if (close.status === "rejected") expect(close.reason.message).toBe("posShiftDraftsOpen");
    const final =
      close.status === "fulfilled"
        ? close.value
        : await f.cashier.pos.shifts.close({
            shiftId: f.shift.id,
            closingCashCountedKgs: 200,
            idempotencyKey: randomUUID(),
          });
    expect(final.expectedCashKgs).toBe(200);
    expect(final.discrepancyKgs).toBe(0);
    expect(await prisma.salePayment.count()).toBe(1);
  });

  it("notifies other tabs once after committed cancellation, never for a rejected operation", async () => {
    const f = await setup();
    const sale = await f.draft();
    const events: EventPayload[] = [];
    const unsubscribe = eventBus.subscribe((event) => events.push(event));
    try {
      await Promise.all([
        f.cashier.pos.sales.cancelDraft({ saleId: sale.id }),
        f.cashier.pos.sales.cancelDraft({ saleId: sale.id }),
      ]);
      expect(events.filter((e) => e.type === "shift.updated")).toEqual([
        {
          type: "shift.updated",
          payload: { storeId: f.store.id, registerId: f.register.id, shiftId: f.shift.id },
        },
      ]);
      const other = await f.manager.pos.sales.createDraft({ registerId: f.register.id });
      await expect(f.cashier.pos.sales.cancelDraft({ saleId: other.id })).rejects.toThrow(
        "posSaleOwnerMismatch",
      );
      expect(events.filter((e) => e.type === "shift.updated")).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it("does not silently cancel an empty draft that contains a recorded payment when resuming another receipt", async () => {
    const f = await setup();
    const held = await f.draft();
    await f.cashier.pos.sales.holdDraft({ saleId: held.id });
    const empty = await f.cashier.pos.sales.createDraft({ registerId: f.register.id });
    await prisma.salePayment.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        shiftId: f.shift.id,
        customerOrderId: empty.id,
        method: "CASH",
        amountKgs: 1,
      },
    });
    await expect(
      f.cashier.pos.sales.resumeHeldDraft({ saleId: held.id, registerId: f.register.id }),
    ).rejects.toThrow("posDraftHasRecordedOperations");
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe(
      "DRAFT",
    );
  });

  it("rechecks an empty cart under its lock before replacing it with a held receipt", async () => {
    const f = await setup();
    const held = await f.draft();
    await f.cashier.pos.sales.holdDraft({ saleId: held.id });
    const empty = await f.cashier.pos.sales.createDraft({ registerId: f.register.id });
    let unlock!: () => void;
    let ready!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const edit = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CustomerOrder" WHERE id = ${empty.id} FOR UPDATE`;
        const [connection] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        ready(connection.pid);
        await release;
        await tx.customerOrderLine.create({
          data: {
            customerOrderId: empty.id,
            productId: f.product.id,
            qty: 1,
            unitPriceKgs: 100,
            lineTotalKgs: 100,
          },
        });
        await tx.customerOrder.update({
          where: { id: empty.id },
          data: { subtotalKgs: 100, totalKgs: 100 },
        });
      },
      { timeout: 10000 },
    );
    const pid = await locked;
    const resume = f.cashier.pos.sales
      .resumeHeldDraft({ saleId: held.id, registerId: f.register.id })
      .catch((error) => error);
    try {
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const [row] = await prisma.$queryRaw<
          Array<{ blocked: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        blocked = row.blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally {
      unlock();
    }
    await edit;
    expect((await resume).message).toBe("posActiveDraftExists");
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe(
      "DRAFT",
    );
  });
});
