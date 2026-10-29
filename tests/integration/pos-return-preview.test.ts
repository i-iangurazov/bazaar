import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db/prisma";
import { createTestCaller } from "../helpers/context";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const describeDb = shouldRunDbTests ? describe : describe.skip;

describeDb("POS return preview uses authoritative refund allocation", () => {
  beforeEach(resetDatabase);

  async function fixture(qty = 2, price = 150, discount = 30) {
    const f = await seedBase({ plan: "ENTERPRISE", allowNegativeStock: true });
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: price } });
    const register = await prisma.posRegister.create({
      data: {
        organizationId: f.org.id,
        storeId: f.store.id,
        name: "Preview QA",
        code: "PREVIEW",
      },
    });
    const caller = createTestCaller({ ...f.cashierUser, organizationId: f.org.id });
    const shift = await caller.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: "preview-open-shift",
    });
    const sale = await caller.pos.sales.createDraft({
      registerId: register.id,
      lines: [{ productId: f.product.id, qty }],
    });
    await caller.pos.sales.updateDiscount({ saleId: sale.id, discountKgs: discount });
    const total = Math.round((qty * price - discount) * 100) / 100;
    await caller.pos.sales.complete({
      saleId: sale.id,
      idempotencyKey: "preview-complete-sale",
      payments: total ? [{ method: "CASH", amountKgs: total }] : [],
    });
    const receipt = await caller.pos.sales.get({ saleId: sale.id });
    return { ...f, caller, shift, register, sale, line: receipt!.lines[0] };
  }

  it("quotes a discounted partial refund without creating drafts, payments or stock movements", async () => {
    const f = await fixture();
    const counts = async () =>
      Promise.all([
        prisma.saleReturn.count(),
        prisma.salePayment.count(),
        prisma.stockMovement.count(),
        prisma.auditLog.count(),
      ]);
    const before = await counts();
    const quote = await f.caller.pos.returns.preview({
      originalSaleId: f.sale.id,
      lines: [{ customerOrderLineId: f.line.id, qty: 1 }],
    });
    expect(quote).toMatchObject({
      originalSaleId: f.sale.id,
      totalKgs: 135,
      lines: [{ customerOrderLineId: f.line.id, qty: 1, lineTotalKgs: 135 }],
    });
    expect(await counts()).toEqual(before);
    await expect(
      f.caller.pos.returns.preview({
        originalSaleId: f.sale.id,
        lines: [{ customerOrderLineId: f.line.id, qty: 3 }],
      }),
    ).rejects.toMatchObject({ message: "posReturnQtyExceeded" });
  });

  it("matches posting through cumulative cent rounding and a zero-value return", async () => {
    const f = await fixture(3, 0.01, 0.01);
    for (const [index, expected] of [0.01, 0, 0.01].entries()) {
      const quote = await f.caller.pos.returns.preview({
        originalSaleId: f.sale.id,
        lines: [{ customerOrderLineId: f.line.id, qty: 1 }],
      });
      expect(quote.totalKgs).toBe(expected);
      const draft = await f.caller.pos.returns.createDraft({
        shiftId: f.shift.id,
        originalSaleId: f.sale.id,
      });
      await f.caller.pos.returns.addLine({
        saleReturnId: draft.id,
        customerOrderLineId: f.line.id,
        qty: 1,
      });
      expect((await f.caller.pos.returns.get({ saleReturnId: draft.id }))?.totalKgs).toBe(
        quote.totalKgs,
      );
      await f.caller.pos.returns.complete({
        saleReturnId: draft.id,
        idempotencyKey: `preview-refund-${index}`,
        payments: expected ? [{ method: "CASH", amountKgs: expected }] : [],
      });
    }
    const refunded = await prisma.salePayment.aggregate({
      where: { customerOrderId: f.sale.id, isRefund: true },
      _sum: { amountKgs: true },
    });
    expect(Number(refunded._sum.amountKgs)).toBe(0.02);
    await expect(
      f.caller.pos.returns.preview({
        originalSaleId: f.sale.id,
        lines: [{ customerOrderLineId: f.line.id, qty: 1 }],
      }),
    ).rejects.toMatchObject({ message: "posReturnQtyExceeded" });
  });

  it("rejects duplicate, foreign-receipt and non-whole selections", async () => {
    const f = await fixture();
    const selection = { customerOrderLineId: f.line.id, qty: 1 };
    await expect(
      f.caller.pos.returns.preview({ originalSaleId: f.sale.id, lines: [selection, selection] }),
    ).rejects.toMatchObject({ message: "invalidInput" });
    await expect(
      f.caller.pos.returns.preview({
        originalSaleId: f.sale.id,
        lines: [{ ...selection, qty: 0.5 }],
      }),
    ).rejects.toMatchObject({ message: "wholeQuantityRequired" });
    const other = await f.caller.pos.sales.createDraft({
      registerId: f.register.id,
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    const otherReceipt = await f.caller.pos.sales.get({ saleId: other.id });
    await expect(
      f.caller.pos.returns.preview({
        originalSaleId: f.sale.id,
        lines: [{ customerOrderLineId: otherReceipt!.lines[0].id, qty: 1 }],
      }),
    ).rejects.toMatchObject({ message: "posSaleLineNotFound" });
    await expect(
      f.caller.pos.returns.preview({
        originalSaleId: other.id,
        lines: [{ customerOrderLineId: otherReceipt!.lines[0].id, qty: 1 }],
      }),
    ).rejects.toMatchObject({ message: "posReturnSourceNotCompleted" });
  });

  it("enforces organization and assigned-store access before exposing a quote", async () => {
    const f = await fixture();
    const selection = {
      originalSaleId: f.sale.id,
      lines: [{ customerOrderLineId: f.line.id, qty: 1 }],
    };
    const unassigned = await prisma.user.create({
      data: {
        organizationId: f.org.id,
        email: "preview-unassigned@example.invalid",
        name: "Unassigned",
        role: "CASHIER",
        passwordHash: "unused",
        emailVerifiedAt: new Date(),
      },
    });
    await expect(createTestCaller({ ...unassigned, organizationId: f.org.id }).pos.returns.preview(selection)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    const otherOrg = await prisma.organization.create({
      data: { name: "Preview other org", plan: "ENTERPRISE" },
    });
    const foreign = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        email: "preview-foreign@example.invalid",
        name: "Foreign",
        role: "CASHIER",
        passwordHash: "unused",
        emailVerifiedAt: new Date(),
      },
    });
    await expect(createTestCaller({ ...foreign, organizationId: otherOrg.id }).pos.returns.preview(selection)).rejects.toMatchObject({
      message: "posSaleNotFound",
    });
  });
});
