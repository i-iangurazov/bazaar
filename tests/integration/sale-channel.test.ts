import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
import { createTestCaller } from "../helpers/context";

(shouldRunDbTests ? describe : describe.skip)("commercial POS channel", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "BUSINESS", allowNegativeStock: true });
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    const register = await prisma.posRegister.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        name: "Channel register",
        code: "CHANNEL",
      },
    });
    const caller = createTestCaller({ ...f.cashierUser, organizationId: f.org.id });
    await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "channel-shift",
    });
    const draft = (saleChannel?: "IN_STORE" | "ONLINE") =>
      caller.pos.sales.createDraft({
        registerId: register.id,
        saleChannel,
        lines: [{ productId: f.product.id, qty: 2 }],
      });
    return { ...f, register, caller, draft };
  }
  it("defaults older/new POS clients to in-store and saves an online choice without changing money or stock", async () => {
    const f = await fixture(),
      sale = await f.draft();
    expect(sale.saleChannel).toBe("IN_STORE");
    const request = {
      saleId: sale.id,
      saleChannel: "ONLINE" as const,
      idempotencyKey: "channel-complete",
      payments: [{ method: "CASH" as const, amountKgs: 200 }],
    };
    await expect(
      f.caller.pos.sales.complete({ ...request, payments: [{ method: "CASH", amountKgs: 1 }] }),
    ).rejects.toThrow();
    expect((await f.caller.pos.sales.get({ saleId: sale.id }))?.status).toBe("DRAFT");
    const result = await f.caller.pos.sales.complete(request);
    await f.caller.pos.sales.complete(request);
    const saved = await f.caller.pos.sales.get({ saleId: result.id });
    expect(saved).toMatchObject({ saleChannel: "ONLINE", totalKgs: 200, discountKgs: 0 });
    expect(
      await prisma.stockMovement.count({ where: { referenceId: sale.id, type: "SALE" } }),
    ).toBe(1);
    expect(await prisma.salePayment.count({ where: { customerOrderId: sale.id } })).toBe(1);
    expect((await f.caller.pos.sales.createDraft({ registerId: f.register.id }))?.saleChannel).toBe(
      "IN_STORE",
    );
    await expect(
      f.caller.pos.sales.holdDraft({ saleId: sale.id, saleChannel: "INVALID" as "ONLINE" }),
    ).rejects.toThrow();
  });
  it("holds, resumes, and reloads each sale's choice while older payloads preserve saved metadata", async () => {
    const f = await fixture(),
      sale = await f.draft();
    await f.caller.pos.sales.holdDraft({ saleId: sale.id, saleChannel: "ONLINE" });
    const other = await f.caller.pos.sales.createDraft({ registerId: f.register.id });
    expect(other.saleChannel).toBe("IN_STORE");
    await f.caller.pos.sales.resumeHeldDraft({ saleId: sale.id, registerId: f.register.id });
    expect((await f.caller.pos.sales.activeDraft({ registerId: f.register.id }))?.saleChannel).toBe(
      "ONLINE",
    );
    const reused = await f.caller.pos.sales.createDraft({
      registerId: f.register.id,
      saleChannel: "IN_STORE",
    });
    expect(reused.saleChannel).toBe("ONLINE");
    await f.caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "channel-old-client",
      payments: [{ method: "CASH", amountKgs: 200 }],
    });
    expect((await f.caller.pos.sales.get({ saleId: sale.id }))?.saleChannel).toBe("ONLINE");
  });
  it("keeps historical unknown values and selected customer IDs without relabeling old receipts", async () => {
    const f = await fixture();
    const customer = await prisma.customer.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        name: "Linked customer",
        email: "linked@example.invalid",
      },
    });
    const sale = await f.caller.pos.sales.createDraft({
      registerId: f.register.id,
      customerId: customer.id,
    });
    expect(
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } })).customerId,
    ).toBe(customer.id);
    await prisma.customerOrder.update({ where: { id: sale.id }, data: { saleChannel: null } });
    expect((await f.caller.pos.sales.get({ saleId: sale.id }))?.saleChannel).toBeNull();
    await f.caller.pos.sales.updateCustomer({ saleId: sale.id, customerId: null });
    expect(
      (await prisma.customerOrder.findUniqueOrThrow({ where: { id: sale.id } })).customerId,
    ).toBeNull();
  });
});
