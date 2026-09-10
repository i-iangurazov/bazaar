import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { baamRouter } from "@/server/trpc/routers/baam";
import { businessCaller } from "@/server/services/baamBusiness";
import {
  createBaamConversation,
  claimBaamTurn,
  readBaamConversation,
  changeBaamConversation,
  ownBaamConversation,
  baamAccess,
} from "@/server/services/baamConversations";
import { proposeBaamAction, executeBaamAction } from "@/server/services/baamActions";
import { sendBaamMessage } from "@/server/services/baamCompanion";
import { baamSearch, baamInspect } from "@/server/services/baamReadTools";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";

const context = (user: User) => ({
  prisma,
  user: {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId!,
    isOrgOwner: user.isOrgOwner,
    isPlatformOwner: false,
  },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("baam-integration"),
});
describe.skipIf(!shouldRunDbTests)("BAAM companion domain integration", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const seed = await seedBase({ plan: "ENTERPRISE" });
    await prisma.product.update({ where: { id: seed.product.id }, data: { basePriceKgs: 100 } });
    const ctx = context(seed.adminUser);
    const api = businessCaller(ctx);
    const conversation = await createBaamConversation(ctx, {
      locale: "en",
      storeId: seed.store.id,
    });
    async function propose(
      tool: string,
      args: unknown,
      actor = ctx,
      conversationId = conversation.id,
    ) {
      const current = await ownBaamConversation(actor, conversationId);
      const { turn } = await claimBaamTurn(actor, {
        conversationId,
        clientRequestId: randomUUID(),
        text: `Isolated test: ${tool}`,
        locale: "en",
        revision: current.conversation.revision,
        attachmentIds: [],
      });
      const action = await proposeBaamAction(actor, turn.id, tool, args);
      await prisma.baamTurn.update({
        where: { id: turn.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await prisma.baamConversation.update({
        where: { id: conversationId },
        data: { activeTurnId: null },
      });
      return action;
    }
    async function run(tool: string, args: unknown) {
      const action = await propose(tool, args);
      const result = await executeBaamAction(ctx, action.id);
      expect(result.status).toBe("COMPLETED");
      return result;
    }
    const stock = async (storeId = seed.store.id) =>
      (
        await prisma.inventorySnapshot.findFirst({
          where: { storeId, productId: seed.product.id, variantKey: "BASE" },
        })
      )?.onHand ?? 0;
    return { ...seed, ctx, api, conversation, propose, run, stock };
  }
  it("isolates roles, tenants, individual histories, object reads, and revoked grants", async () => {
    const f = await fixture();
    for (const user of [f.staffUser, f.cashierUser]) {
      await expect(baamAccess(context(user))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        baamRouter.createCaller(context(user)).conversation({ id: f.conversation.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      readBaamConversation(context(f.managerUser), f.conversation.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const foreign = await prisma.organization.create({
      data: { name: "Foreign tenant", plan: "ENTERPRISE" },
    });
    const foreignStore = await prisma.store.create({
      data: { organizationId: foreign.id, name: "Foreign", code: "F" },
    });
    await expect(
      baamSearch(f.ctx, { kind: "products", storeId: foreignStore.id, offset: 0 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreignUnit = await prisma.unit.create({
      data: { organizationId: foreign.id, code: "each", labelRu: "each", labelKg: "each" },
    });
    const otherProduct = await prisma.product.create({
      data: {
        organizationId: foreign.id,
        sku: "FOREIGN",
        name: "Foreign secret",
        unit: "each",
        baseUnitId: foreignUnit.id,
      },
    });
    await expect(
      baamInspect(f.ctx, { kind: "product", id: otherProduct.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const managerConversation = await createBaamConversation(context(f.managerUser), {
      locale: "en",
      storeId: f.store.id,
    });
    await prisma.userStoreAccess.deleteMany({ where: { userId: f.managerUser.id } });
    await expect(
      readBaamConversation(context(f.managerUser), managerConversation.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("persists paging, title changes, request idempotence and conversation context revisions", async () => {
    const f = await fixture();
    const input = {
      conversationId: f.conversation.id,
      clientRequestId: randomUUID(),
      text: "Hello",
      locale: "en" as const,
      revision: 0,
      attachmentIds: [],
    };
    const first = await claimBaamTurn(f.ctx, input);
    expect((await claimBaamTurn(f.ctx, input)).fresh).toBe(false);
    await expect(claimBaamTurn(f.ctx, { ...input, text: "Different" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      claimBaamTurn(f.ctx, { ...input, clientRequestId: randomUUID() }),
    ).rejects.toMatchObject({ message: "baamBusy" });
    await prisma.baamTurn.update({ where: { id: first.turn.id }, data: { status: "COMPLETED" } });
    await prisma.baamConversation.update({
      where: { id: f.conversation.id },
      data: { activeTurnId: null },
    });
    const changed = await changeBaamConversation(f.ctx, {
      id: f.conversation.id,
      title: "Restored history",
      revision: 0,
    });
    expect((await readBaamConversation(f.ctx, f.conversation.id)).conversation.title).toBe(
      changed.title,
    );
    await changeBaamConversation(f.ctx, { id: f.conversation.id, storeId: null, revision: 0 });
    await expect(
      claimBaamTurn(f.ctx, { ...input, clientRequestId: randomUUID() }),
    ).rejects.toMatchObject({ message: "baamScopeChanged" });
    const fresh = await createBaamConversation(f.ctx, { locale: "en" });
    expect((await readBaamConversation(f.ctx, fresh.id)).messages).toEqual([]);
  });
  it("creates a complete real product once, preserving zero cost and normal store/unit assignment", async () => {
    const f = await fixture();
    const action = await f.propose("product_create", {
      name: "BAAM product",
      baseUnitId: f.baseUnit.id,
      storeId: f.store.id,
      basePriceKgs: 75,
      purchasePriceKgs: 0,
      initialOnHand: 0,
      imageChoice: "without_photo",
    });
    const [one, two] = await Promise.all([
      executeBaamAction(f.ctx, action.id),
      executeBaamAction(f.ctx, action.id),
    ]);
    expect([one.status, two.status]).toContain("COMPLETED");
    expect((await executeBaamAction(f.ctx, action.id)).status).toBe("COMPLETED");
    const products = await prisma.product.findMany({
      where: { name: "BAAM product" },
      include: { storeProducts: true },
    });
    expect(products).toHaveLength(1);
    expect(products[0].baseUnitId).toBe(f.baseUnit.id);
    expect(products[0].storeProducts.map((s) => s.storeId)).toContain(f.store.id);
    expect(
      await prisma.auditLog.count({
        where: { action: "PRODUCT_CREATE", entityId: products[0].id },
      }),
    ).toBe(1);
    const manager = context(f.managerUser);
    const dialog = await createBaamConversation(manager, { locale: "en", storeId: f.store.id });
    await expect(
      f.propose(
        "product_create",
        {
          name: "Forbidden initial stock",
          baseUnitId: f.baseUnit.id,
          storeId: f.store.id,
          initialOnHand: 2,
          imageChoice: "without_photo",
        },
        manager,
        dialog.id,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("receives all lines atomically, transfers once, and rejects stale absolute stock after another operation", async () => {
    const f = await fixture();
    const second = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "SECOND",
        name: "Second",
        unit: "each",
        baseUnitId: f.baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: second.id },
    });
    const receiving = await f.run("stock_receive", {
      storeId: f.store.id,
      lines: [
        { productId: f.product.id, quantity: 20, unitCost: 0 },
        { productId: second.id, quantity: 3, unitCost: 5 },
      ],
    });
    expect(await f.stock()).toBe(20);
    await executeBaamAction(f.ctx, receiving.id);
    expect(await f.stock()).toBe(20);
    const stale = await f.propose("stock_set", {
      storeId: f.store.id,
      productId: f.product.id,
      targetOnHand: 30,
      reason: "Counted stock",
    });
    await f.api.inventory.adjust({
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: -2,
      reason: "Concurrent change",
      idempotencyKey: randomUUID(),
    });
    await expect(executeBaamAction(f.ctx, stale.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await f.stock()).toBe(18);
    const target = await prisma.store.create({
      data: { organizationId: f.org.id, code: "SECOND", name: "Second store" },
    });
    await f.run("stock_transfer", {
      fromStoreId: f.store.id,
      toStoreId: target.id,
      lines: [{ productId: f.product.id, qty: 5 }],
    });
    expect(await f.stock()).toBe(13);
    expect(await f.stock(target.id)).toBe(5);
    await f.run("stock_write_off", {
      storeId: f.store.id,
      reason: "Брак",
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    expect(await f.stock()).toBe(11);
  });
  it("prepares a POS cart and completes a sale below zero without duplicating payment or stock", async () => {
    const f = await fixture();
    const register = await f.api.pos.registers.create({
      storeId: f.store.id,
      name: "BAAM register",
      code: "BAAM",
    });
    await f.api.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    await f.run("pos_create_draft", {
      registerId: register.id,
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    const sale = await f.api.pos.sales.activeDraft({ registerId: register.id });
    expect(sale).toBeTruthy();
    const action = await f.propose("pos_complete", {
      saleId: sale!.id,
      payments: [{ method: "CASH", amountKgs: 200 }],
    });
    const completed = await executeBaamAction(f.ctx, action.id);
    expect(completed.status).toBe("COMPLETED");
    await executeBaamAction(f.ctx, action.id);
    expect(await f.stock()).toBe(-2);
    expect(await prisma.salePayment.count({ where: { customerOrderId: sale!.id } })).toBe(1);
    const sold = await f.api.pos.sales.get({ saleId: sale!.id });
    const shift = await f.api.pos.shifts.current({ registerId: register.id });
    await f.run("return_create_draft", {
      shiftId: shift!.id,
      originalSaleId: sale!.id,
      lines: [{ customerOrderLineId: sold!.lines[0].id, qty: 1 }],
    });
    const returned = await prisma.saleReturn.findFirstOrThrow({
      where: { originalSaleId: sale!.id },
    });
    const refund = await f.run("return_complete", {
      saleReturnId: returned.id,
      payments: [{ method: "CASH", amountKgs: 100 }],
    });
    await executeBaamAction(f.ctx, refund.id);
    expect(await f.stock()).toBe(-1);
    expect((await prisma.saleReturn.findUniqueOrThrow({ where: { id: returned.id } })).status).toBe(
      "COMPLETED",
    );
  });
  it("refuses a modified cart even when another equal-price product leaves the total unchanged", async () => {
    const f = await fixture();
    const register = await f.api.pos.registers.create({
      storeId: f.store.id,
      name: "BAAM register",
      code: "BAAM",
    });
    await f.api.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    await f.run("pos_create_draft", {
      registerId: register.id,
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    const sale = await f.api.pos.sales.activeDraft({ registerId: register.id });
    const action = await f.propose("pos_complete", {
      saleId: sale!.id,
      payments: [{ method: "CASH", amountKgs: 200 }],
    });
    const other = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "OTHER",
        name: "Other",
        unit: "each",
        baseUnitId: f.baseUnit.id,
        basePriceKgs: 100,
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: other.id },
    });
    const details = await f.api.pos.sales.get({ saleId: sale!.id });
    await f.api.pos.sales.removeLine({ lineId: details!.lines[0].id });
    await f.api.pos.sales.addLine({ saleId: sale!.id, productId: other.id, qty: 2 });
    await expect(executeBaamAction(f.ctx, action.id)).rejects.toMatchObject({
      message: "baamCartChanged",
    });
    expect(await prisma.salePayment.count({ where: { customerOrderId: sale!.id } })).toBe(0);
    expect(await f.stock()).toBe(0);
  });
  it("supports manager creation, variants, store assignment, signed adjustments and absolute quantities", async () => {
    const f = await fixture();
    const manager = context(f.managerUser);
    const dialog = await createBaamConversation(manager, { locale: "en", storeId: f.store.id });
    const action = await f.propose(
      "product_create",
      {
        name: "Manager tea",
        storeId: f.store.id,
        baseUnitId: f.baseUnit.id,
        imageChoice: "without_photo",
        basePriceKgs: 100,
        variants: [{ name: "Large", sku: "TEA-LARGE" }],
      },
      manager,
      dialog.id,
    );
    const created = await executeBaamAction(manager, action.id);
    expect(created.status).toBe("COMPLETED");
    const product = await prisma.product.findFirstOrThrow({
      where: { name: "Manager tea" },
      include: { variants: true },
    });
    expect(product.variants).toHaveLength(1);
    await f.run("product_update", {
      productId: product.id,
      addVariants: [{ name: "Small", sku: "TEA-SMALL" }],
    });
    expect(await prisma.productVariant.count({ where: { productId: product.id } })).toBe(2);
    const store = await prisma.store.create({
      data: { organizationId: f.org.id, name: "Other", code: "OTHER" },
    });
    await f.run("product_assign_store", { storeId: store.id, productIds: [product.id] });
    expect(
      await prisma.storeProduct.count({
        where: { storeId: store.id, productId: product.id, isActive: true },
      }),
    ).toBe(1);
    await f.run("stock_adjust", {
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 4,
      reason: "Test adjustment",
    });
    await f.run("stock_set", {
      storeId: f.store.id,
      productId: f.product.id,
      targetOnHand: 7,
      reason: "Test physical count",
    });
    expect(await f.stock()).toBe(7);
    await expect(
      f.propose("stock_set", {
        storeId: f.store.id,
        productId: f.product.id,
        targetOnHand: 7,
        reason: "No change",
      }),
    ).rejects.toMatchObject({ message: "baamAlreadyCurrent" });
  });
  it("removes and cancels count lines without changing stock", async () => {
    const f = await fixture();
    const created = await f.run("count_create", { storeId: f.store.id });
    const stockCountId = (created.result as { resourceId: string }).resourceId;
    await f.run("count_set_quantity", { stockCountId, productId: f.product.id, countedQty: 8 });
    const count = await f.api.counts.get({ stockCountId });
    await f.run("count_remove_line", { stockCountId, lineId: count!.lines[0].id });
    await f.run("count_cancel", { stockCountId });
    expect(await f.stock()).toBe(0);
    expect((await f.api.counts.get({ stockCountId }))?.status).toBe("CANCELLED");
  });
  it("edits and cancels a return draft without refunding or restoring stock", async () => {
    const f = await fixture();
    const register = await f.api.pos.registers.create({
      storeId: f.store.id,
      name: "Return test",
      code: "RETURN",
    });
    const shift = await f.api.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    await f.run("pos_create_draft", {
      registerId: register.id,
      lines: [{ productId: f.product.id, qty: 3 }],
    });
    const sale = await f.api.pos.sales.activeDraft({ registerId: register.id });
    await f.run("pos_complete", {
      saleId: sale!.id,
      payments: [{ method: "CARD", amountKgs: 300 }],
    });
    const sold = await f.api.pos.sales.get({ saleId: sale!.id });
    const returned = await f.run("return_create_draft", {
      shiftId: shift.id,
      originalSaleId: sale!.id,
      lines: [{ customerOrderLineId: sold!.lines[0].id, qty: 1 }],
    });
    const saleReturnId = (returned.result as { resourceId: string }).resourceId;
    let draft = await f.api.pos.returns.get({ saleReturnId });
    await f.run("return_update_line", { saleReturnId, returnLineId: draft!.lines[0].id, qty: 2 });
    draft = await f.api.pos.returns.get({ saleReturnId });
    expect(draft!.lines[0].qty).toBe(2);
    await f.run("return_remove_line", { saleReturnId, returnLineId: draft!.lines[0].id });
    await f.run("return_add_line", {
      saleReturnId,
      customerOrderLineId: sold!.lines[0].id,
      qty: 1,
    });
    await f.run("return_cancel", { saleReturnId });
    expect(await f.stock()).toBe(-3);
    expect((await f.api.pos.returns.get({ saleReturnId }))?.status).toBe("CANCELED");
  });
  it("preserves a provider failure and never invents a successful operation", async () => {
    const f = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network disconnected")));
    try {
      const request = {
        conversationId: f.conversation.id,
        clientRequestId: randomUUID(),
        text: "Create a product",
        locale: "en" as const,
        revision: 0,
        attachmentIds: [],
      };
      expect((await sendBaamMessage(f.ctx, request)).status).toBe("FAILED");
      expect((await sendBaamMessage(f.ctx, request)).replayed).toBe(true);
      const saved = await readBaamConversation(f.ctx, f.conversation.id);
      expect(saved.messages.map((m) => m.role)).toEqual(["user", "error"]);
      expect(saved.actions).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
  it("updates a product without dropping photos, barcodes, supplier, categories or price, and detects a changed review", async () => {
    const f = await fixture();
    await prisma.product.update({
      where: { id: f.product.id },
      data: { categories: ["Tea"], description: "Original description" },
    });
    await prisma.productBarcode.create({
      data: { organizationId: f.org.id, productId: f.product.id, value: "1234567890128" },
    });
    const action = await f.propose("product_update", {
      productId: f.product.id,
      name: "New product name",
    });
    expect((await executeBaamAction(f.ctx, action.id)).status).toBe("COMPLETED");
    const saved = await prisma.product.findUniqueOrThrow({
      where: { id: f.product.id },
      include: { barcodes: true },
    });
    expect(saved.name).toBe("New product name");
    expect(saved.categories).toEqual(["Tea"]);
    expect(Number(saved.basePriceKgs)).toBe(100);
    expect(saved.description).toBe("Original description");
    expect(saved.supplierId).toBe(f.supplier.id);
    expect(saved.barcodes[0].value).toBe("1234567890128");
    const stale = await f.propose("product_update", {
      productId: f.product.id,
      name: "Stale name",
    });
    await prisma.product.update({ where: { id: f.product.id }, data: { name: "Concurrent name" } });
    await expect(executeBaamAction(f.ctx, stale.id)).rejects.toMatchObject({
      message: "baamRecordChanged",
    });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } })).name).toBe(
      "Concurrent name",
    );
  });
  it("runs inventory counting through normal documents and retains an intervening receipt", async () => {
    const f = await fixture();
    await f.run("stock_receive", {
      storeId: f.store.id,
      lines: [{ productId: f.product.id, quantity: 10, unitCost: 0 }],
    });
    await f.run("count_create", { storeId: f.store.id, notes: "BAAM count" });
    const count = await prisma.stockCount.findFirstOrThrow({ where: { storeId: f.store.id } });
    await f.run("count_set_quantity", {
      stockCountId: count.id,
      productId: f.product.id,
      countedQty: 8,
    });
    await f.api.inventory.receive({
      storeId: f.store.id,
      productId: f.product.id,
      qtyReceived: 3,
      unitCost: 0,
      idempotencyKey: randomUUID(),
    });
    const applied = await f.run("count_applyCount", { stockCountId: count.id });
    await executeBaamAction(f.ctx, applied.id);
    expect(await f.stock()).toBe(11); // 10 + 3 + (8 - 10)
    expect(
      await prisma.auditLog.count({
        where: { entityId: count.id, action: "STOCK_COUNT_DOCUMENT_APPLY" },
      }),
    ).toBe(1);
  });
  it("executes the purchase lifecycle, edits draft lines, receives partially and cancels outstanding orders", async () => {
    const f = await fixture();
    const created = await f.run("purchase_create", {
      storeId: f.store.id,
      supplierId: f.supplier.id,
      lines: [{ productId: f.product.id, qtyOrdered: 5, unitCost: 0 }],
    });
    const purchaseOrderId = (created.result as { resourceId: string }).resourceId;
    const second = await prisma.product.create({
      data: {
        organizationId: f.org.id,
        sku: "PO-SECOND",
        name: "Second product",
        unit: "pcs",
        baseUnitId: f.baseUnit.id,
      },
    });
    await prisma.storeProduct.create({
      data: { organizationId: f.org.id, storeId: f.store.id, productId: second.id },
    });
    await f.run("purchase_add_line", {
      purchaseOrderId,
      productId: second.id,
      qtyOrdered: 2,
      unitCost: 10,
    });
    let po = await f.api.purchases.getById({ id: purchaseOrderId });
    const first = po!.lines.find((l) => l.productId === f.product.id)!;
    await f.run("purchase_update_line", { purchaseOrderId, lineId: first.id, qtyOrdered: 6 });
    await f.run("purchase_remove_line", {
      purchaseOrderId,
      lineId: po!.lines.find((l) => l.productId === second.id)!.id,
    });
    await f.run("purchase_submit", { purchaseOrderId });
    await f.run("purchase_approve", { purchaseOrderId });
    const received = await f.run("purchase_receive_lines", {
      purchaseOrderId,
      lines: [{ lineId: first.id, qtyReceived: 2 }],
    });
    await executeBaamAction(f.ctx, received.id);
    expect(await f.stock()).toBe(2);
    await f.run("purchase_receive", { purchaseOrderId });
    expect(await f.stock()).toBe(6);
    po = await f.api.purchases.getById({ id: purchaseOrderId });
    expect(po!.lines[0].unitCost).toBe(0);
    expect(po!.lines[0].qtyReceived).toBe(6);
    const cancelled = await f.run("purchase_create", {
      storeId: f.store.id,
      submit: true,
      lines: [{ productId: f.product.id, qtyOrdered: 2, unitCost: 0 }],
    });
    await f.run("purchase_cancel", {
      purchaseOrderId: (cancelled.result as { resourceId: string }).resourceId,
    });
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: f.store.id, productId: f.product.id },
        })
      ).onOrder,
    ).toBe(0);
  });
  it("executes customer orders and their editable line and status workflows", async () => {
    const f = await fixture();
    await f.run("stock_receive", {
      storeId: f.store.id,
      lines: [{ productId: f.product.id, quantity: 10, unitCost: 0 }],
    });
    const created = await f.run("order_create", {
      storeId: f.store.id,
      customerName: "Synthetic customer",
      lines: [{ productId: f.product.id, qty: 3 }],
    });
    const customerOrderId = (created.result as { resourceId: string }).resourceId;
    let order = await f.api.orders.getById({ customerOrderId });
    await f.run("order_update_line", { customerOrderId, lineId: order!.lines[0].id, qty: 2 });
    await f.run("order_remove_line", { customerOrderId, lineId: order!.lines[0].id });
    await f.run("order_add_line", { customerOrderId, productId: f.product.id, qty: 2 });
    await f.run("order_confirm", { customerOrderId });
    await f.run("order_markReady", { customerOrderId });
    const completed = await f.run("order_complete", { customerOrderId });
    await executeBaamAction(f.ctx, completed.id);
    order = await f.api.orders.getById({ customerOrderId });
    expect(order!.status).toBe("COMPLETED");
    expect(await f.stock()).toBe(8);
    const cancelled = await f.run("order_create", {
      storeId: f.store.id,
      lines: [{ productId: f.product.id, qty: 1 }],
    });
    await f.run("order_cancel", {
      customerOrderId: (cancelled.result as { resourceId: string }).resourceId,
    });
    expect(await f.stock()).toBe(8);
  });
  it("opens shifts, edits carts, holds/resumes and cancels without an actual sale or payment", async () => {
    const f = await fixture();
    const register = await f.api.pos.registers.create({
      storeId: f.store.id,
      name: "BAAM",
      code: "BAAM",
    });
    const opened = await f.run("pos_open_shift", { registerId: register.id, openingCashKgs: 0 });
    await executeBaamAction(f.ctx, opened.id);
    await f.run("pos_create_draft", {
      registerId: register.id,
      lines: [{ productId: f.product.id, qty: 2 }],
    });
    const active = await f.api.pos.sales.activeDraft({ registerId: register.id });
    const saleId = active!.id;
    const sale = await f.api.pos.sales.get({ saleId });
    await f.run("pos_update_line", { saleId, lineId: sale!.lines[0].id, qty: 1 });
    const added = await f.run("pos_add_line", { saleId, productId: f.product.id, qty: 2 });
    await executeBaamAction(f.ctx, added.id);
    expect((await f.api.pos.sales.get({ saleId }))!.lines[0].qty).toBe(3);
    await f.run("pos_holdDraft", { saleId });
    await f.run("pos_resumeHeldDraft", { saleId });
    await f.run("pos_remove_line", { saleId, lineId: sale!.lines[0].id });
    await f.run("pos_cancelDraft", { saleId });
    expect(await f.stock()).toBe(0);
    expect(await prisma.salePayment.count()).toBe(0);
  });
  it("creates and updates contacts with field preservation and catches concurrent edits", async () => {
    const f = await fixture();
    const created = await f.run("supplier_create", {
      name: "BAAM supplier",
      phone: "+996555123456",
    });
    const supplierId = (created.result as { resourceId: string }).resourceId;
    await f.run("supplier_update", { supplierId, name: "Supplier renamed" });
    expect((await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } })).phone).toBe(
      "+996555123456",
    );
    const customer = await f.run("customer_create", {
      storeId: f.store.id,
      name: "BAAM customer",
      phone: "+996555123457",
    });
    const customerId = (customer.result as { resourceId: string }).resourceId;
    await f.run("customer_update", { customerId, address: "Synthetic address" });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).name).toBe(
      "BAAM customer",
    );
    const stale = await f.propose("customer_update", { customerId, name: "Old review" });
    await prisma.customer.update({
      where: { id: customerId },
      data: { name: "Changed elsewhere" },
    });
    await expect(executeBaamAction(f.ctx, stale.id)).rejects.toMatchObject({
      message: "baamRecordChanged",
    });
  });
  it("recovers a committed action after its result response is lost without duplicating its product", async () => {
    const f = await fixture();
    const action = await f.run("product_create", {
      name: "Recover product",
      storeId: f.store.id,
      baseUnitId: f.baseUnit.id,
      imageChoice: "without_photo",
    });
    await prisma.baamAction.update({
      where: { id: action.id },
      data: {
        status: "RUNNING",
        result: (await import("@prisma/client")).Prisma.DbNull,
        updatedAt: new Date(Date.now() - 100000),
      },
    });
    await prisma.baamExecution.updateMany({
      where: { actionId: action.id },
      data: { output: (await import("@prisma/client")).Prisma.DbNull },
    });
    expect(
      (await readBaamConversation(f.ctx, f.conversation.id)).actions.find((a) => a.id === action.id)
        ?.canRecover,
    ).toBe(true);
    const recovered = await executeBaamAction(f.ctx, action.id);
    expect(recovered.status).toBe("COMPLETED");
    expect((recovered.result as { resourceId: string }).resourceId).toBe(
      (action.result as { resourceId: string }).resourceId,
    );
    expect(await prisma.product.count({ where: { name: "Recover product" } })).toBe(1);
  });
});
