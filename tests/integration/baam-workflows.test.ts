import { randomUUID } from "node:crypto";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { sendBaamMessage } from "@/server/services/baamCompanion";
import {
  createBaamConversation,
  readBaamConversation,
  changeBaamConversation,
} from "@/server/services/baamConversations";
import {
  saveBaamWorkflow,
  submitBaamWorkflow,
  recoverBaamWorkflow,
} from "@/server/services/baamWorkflows";
import { lookupWorkflow, resolveWorkflowValues } from "@/server/services/baamWorkflowRecords";
import { AppError } from "@/server/services/errors";
import { businessCaller, baamActions } from "@/server/services/baamBusiness";
import type {
  WorkflowAction,
  WorkflowValues,
  WorkflowOperation,
  WorkflowPresentation,
} from "@/lib/baam/workflows";
import { resetDatabase, seedBase, shouldRunDbTests } from "../helpers/db";
const context = (u: User) => ({
  prisma,
  user: {
    id: u.id,
    email: u.email,
    role: u.role,
    organizationId: u.organizationId!,
    isOrgOwner: u.isOrgOwner,
    isPlatformOwner: false,
  },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("baam-workflows-test"),
});
describe.skipIf(!shouldRunDbTests)("BAAM forms execute the real domain services", () => {
  beforeEach(resetDatabase);
  async function fixture() {
    const f = await seedBase({ plan: "ENTERPRISE" });
    const ctx = context(f.adminUser),
      api = businessCaller(ctx);
    await prisma.product.update({ where: { id: f.product.id }, data: { basePriceKgs: 100 } });
    return { ...f, ctx, api };
  }
  async function start(
    f: Awaited<ReturnType<typeof fixture>>,
    action: WorkflowAction,
    actor = f.ctx,
  ) {
    const c = await createBaamConversation(actor, { locale: "en", storeId: f.store.id });
    const sent = await sendBaamMessage(actor, {
      conversationId: c.id,
      clientRequestId: randomUUID(),
      text: action,
      command: { kind: "action", action },
      locale: "en",
      revision: 0,
      attachmentIds: [],
    });
    expect(sent.status).toBe("COMPLETED");
    return sent.data.workflows[0];
  }
  const request = (
    w: { id: string; revision: number },
    parameters: WorkflowValues,
    operation: WorkflowOperation = "execute",
  ) => ({ id: w.id, revision: w.revision, parameters, operation, clientRequestId: randomUUID() });
  it("resolves barcodes and variant names and lists variants from the scoped product", async () => {
    const f = await fixture();
    const variant = await prisma.productVariant.create({
      data: {
        productId: f.product.id,
        name: "Large",
        sku: "LARGE-QA",
        attributes: {},
      },
    });
    await prisma.productBarcode.create({
      data: {
        organizationId: f.ctx.user.organizationId,
        productId: f.product.id,
        value: "123456789QA",
      },
    });
    const w = await start(f, "stock_receive");
    const resolved = await resolveWorkflowValues(f.ctx, {
      conversationId: w.conversationId,
      fields: (w.presentation as unknown as WorkflowPresentation).fields,
      locale: "en",
      parameters: {
        storeId: f.store.id,
        lines: [{ productId: "123456789QA", variantId: "Large", qty: 2, unitCost: 0 }],
      },
    });
    expect(resolved.parameters).toMatchObject({
      lines: [{ productId: f.product.id, variantId: variant.id }],
    });
    const choices = await lookupWorkflow(f.ctx, {
      id: w.id,
      path: "lines.0.variantId",
      parameters: resolved.parameters,
    });
    expect(choices).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: variant.id, label: "Large" })]),
    );
  });
  it("opens a form, persists invalid input, corrects fields and creates exactly one product without the provider", async () => {
    const f = await fixture();
    const fetch = vi.fn(() => {
      throw Error("No model calls allowed");
    });
    vi.stubGlobal("fetch", fetch);
    try {
      let w = await start(f, "product_create");
      w = await saveBaamWorkflow(f.ctx, {
        id: w.id,
        revision: w.revision,
        parameters: { name: "X", baseUnitId: f.baseUnit.id, storeId: f.store.id },
      });
      expect(
        (await readBaamConversation(f.ctx, w.conversationId)).workflows[0].parameters,
      ).toMatchObject({ name: "X" });
      w = await submitBaamWorkflow(f.ctx, request(w, w.parameters as WorkflowValues));
      expect(w.status).toBe("FAILED");
      expect(w.presentation).toMatchObject({ errors: { name: "baamInvalidField" } });
      const input = request(w, {
        name: "Coffee",
        baseUnitId: f.baseUnit.id,
        storeId: f.store.id,
        basePriceKgs: 99,
        avgCostKgs: 0,
      });
      const [first] = await Promise.all([
        submitBaamWorkflow(f.ctx, input),
        submitBaamWorkflow(f.ctx, input),
      ]);
      const replay = await submitBaamWorkflow(f.ctx, input);
      expect(replay.status).toBe("COMPLETED");
      expect(
        await prisma.product.count({ where: { name: "Coffee", organizationId: f.org.id } }),
      ).toBe(1);
      expect(first.id).toBe(replay.id);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects stale tabs, another user, revoked roles, foreign units and superseded cards", async () => {
    const f = await fixture();
    const w = await start(f, "product_create");
    const input = { id: w.id, revision: 0, parameters: { name: "Unsaved" } };
    await saveBaamWorkflow(f.ctx, input);
    await expect(saveBaamWorkflow(f.ctx, input)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(saveBaamWorkflow(context(f.managerUser), input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    for (const user of [f.staffUser, f.cashierUser])
      await expect(
        lookupWorkflow(context(user), { id: w.id, path: "baseUnitId" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = await prisma.organization.create({ data: { name: "Foreign" } });
    const unit = await prisma.unit.create({
      data: { organizationId: foreign.id, code: "x", labelRu: "x", labelKg: "x" },
    });
    const failed = await submitBaamWorkflow(
      f.ctx,
      request({ ...w, revision: 1 }, { name: "Foreign attempt", baseUnitId: unit.id }),
    );
    expect(failed.status).toBe("FAILED");
    expect(await prisma.product.count({ where: { name: "Foreign attempt" } })).toBe(0);
    await sendBaamMessage(f.ctx, {
      conversationId: w.conversationId,
      clientRequestId: randomUUID(),
      text: "Создай товар",
      locale: "ru",
      revision: 0,
      attachmentIds: [],
    });
    await expect(
      submitBaamWorkflow(f.ctx, request(failed, { name: "Old card", baseUnitId: f.baseUnit.id })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("receives several lines with zero cost and transfers through normal stock services", async () => {
    const f = await fixture();
    const other = await f.api.products.create({
      name: "Second",
      baseUnitId: f.baseUnit.id,
      storeId: f.store.id,
      idempotencyKey: randomUUID(),
    });
    const secondId =
      "id" in other ? String(other.id) : String((other as { productId: string }).productId);
    const w = await start(f, "stock_receive");
    const params = {
      storeId: f.store.id,
      lines: [
        { productId: f.product.id, quantity: 3, unitCost: 0 },
        { productId: secondId, quantity: 2, unitCost: 25 },
      ],
    };
    const out = await submitBaamWorkflow(f.ctx, request(w, params));
    expect(out.status).toBe("COMPLETED");
    expect(
      await prisma.inventorySnapshot.findFirst({
        where: { productId: f.product.id, storeId: f.store.id },
      }),
    ).toMatchObject({ onHand: 3 });
    expect(
      await prisma.inventorySnapshot.findFirst({
        where: { productId: secondId, storeId: f.store.id },
      }),
    ).toMatchObject({ onHand: 2 });
  });
  it("prepares, holds, resumes and cancels the same real receipt, then completes a new sale", async () => {
    const f = await fixture();
    const register = await f.api.pos.registers.create({
      storeId: f.store.id,
      name: "BAAM test",
      code: "B",
    });
    await f.api.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    let w = await start(f, "pos_create_draft");
    w = await submitBaamWorkflow(
      f.ctx,
      request(w, {
        storeId: f.store.id,
        registerId: register.id,
        lines: [{ productId: f.product.id, qty: 2 }],
      }),
    );
    expect(w.status).toBe("RECEIPT");
    const id = w.resourceId!;
    expect((await f.api.pos.sales.get({ saleId: id }))?.status).toBe("DRAFT");
    for (const [operation, held] of [
      ["hold", true],
      ["resume", false],
    ] as const) {
      w = await submitBaamWorkflow(f.ctx, request(w, w.parameters as WorkflowValues, operation));
      expect(w.status).toBe("RECEIPT");
      expect((await f.api.pos.sales.get({ saleId: id }))?.isHeld).toBe(held);
    }
    w = await submitBaamWorkflow(
      f.ctx,
      request(w, w.parameters as WorkflowValues, "cancelReceipt"),
    );
    expect(w.status).toBe("COMPLETED");
    expect((await f.api.pos.sales.get({ saleId: id }))?.status).toBe("CANCELED");
    w = await start(f, "pos_create_draft");
    w = await submitBaamWorkflow(
      f.ctx,
      request(w, { registerId: register.id, lines: [{ productId: f.product.id, qty: 2 }] }),
    );
    const done = request(
      w,
      { ...(w.parameters as WorkflowValues), payments: [{ method: "CASH", amountKgs: 200 }] },
      "complete",
    );
    w = await submitBaamWorkflow(f.ctx, done);
    expect(w.status).toBe("COMPLETED");
    expect((await f.api.pos.sales.get({ saleId: w.resourceId! }))?.status).toBe("COMPLETED");
    await submitBaamWorkflow(f.ctx, done);
    expect(
      await prisma.inventorySnapshot.findFirst({
        where: { storeId: f.store.id, productId: f.product.id },
      }),
    ).toMatchObject({ onHand: -2 });
  });
  it("prevents completion against an altered receipt and provides an explicit refresh", async () => {
    const f = await fixture();
    const register = await f.api.pos.registers.create({
      storeId: f.store.id,
      name: "BAAM test",
      code: "B",
    });
    await f.api.pos.shifts.open({
      registerId: register.id,
      openingCashKgs: 0,
      idempotencyKey: randomUUID(),
    });
    let w = await start(f, "pos_create_draft");
    w = await submitBaamWorkflow(
      f.ctx,
      request(w, { registerId: register.id, lines: [{ productId: f.product.id, qty: 2 }] }),
    );
    const sale = await f.api.pos.sales.get({ saleId: w.resourceId! });
    await f.api.pos.sales.updateLine({ lineId: sale!.lines[0].id, qty: 3 });
    w = await submitBaamWorkflow(
      f.ctx,
      request(
        w,
        { ...(w.parameters as WorkflowValues), payments: [{ method: "CASH", amountKgs: 200 }] },
        "complete",
      ),
    );
    expect(w.status).toBe("FAILED");
    expect(w.presentation).toMatchObject({ errors: { _form: "baamReceiptChanged" } });
    w = await submitBaamWorkflow(f.ctx, request(w, w.parameters as WorkflowValues, "refresh"));
    expect(w.presentation).toMatchObject({ totalKgs: 300 });
    expect(w.status).toBe("RECEIPT");
  });
  it("does not change active context while an operation is uncertain", async () => {
    const f = await fixture();
    const w = await start(f, "stock_receive");
    await prisma.baamWorkflow.update({ where: { id: w.id }, data: { status: "RUNNING" } });
    await expect(
      changeBaamConversation(f.ctx, { id: w.conversationId, revision: 0, storeId: null }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("retains the selected stock version across form edits and requires refresh after another adjustment", async () => {
    const f = await fixture();
    let w = await start(f, "stock_set");
    const parameters = {
      storeId: f.store.id,
      productId: f.product.id,
      targetOnHand: 7,
      reason: "Counted physically",
    };
    w = await saveBaamWorkflow(f.ctx, { id: w.id, revision: w.revision, parameters });
    await f.api.inventory.adjust({
      storeId: f.store.id,
      productId: f.product.id,
      qtyDelta: 2,
      reason: "Another operator",
      idempotencyKey: randomUUID(),
    });
    w = await submitBaamWorkflow(f.ctx, request(w, parameters));
    expect(w.status).toBe("FAILED");
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: f.store.id, productId: f.product.id },
        })
      ).onHand,
    ).toBe(2);
    w = await submitBaamWorkflow(f.ctx, request(w, parameters, "refresh"));
    w = await submitBaamWorkflow(f.ctx, request(w, parameters));
    expect(w.status).toBe("COMPLETED");
    expect(
      (
        await prisma.inventorySnapshot.findFirstOrThrow({
          where: { storeId: f.store.id, productId: f.product.id },
        })
      ).onHand,
    ).toBe(7);
  });
  it("recovers a committed action after the workflow response was lost without another creation", async () => {
    const f = await fixture();
    let w = await start(f, "product_create");
    const input = request(w, {
      name: "Recover only once",
      baseUnitId: f.baseUnit.id,
      storeId: f.store.id,
    });
    w = await submitBaamWorkflow(f.ctx, input);
    const productId = w.resourceId;
    await prisma.baamWorkflowRequest.update({
      where: { id: input.clientRequestId },
      data: { status: "RUNNING", leaseUntil: new Date(Date.now() - 1000) },
    });
    await prisma.baamWorkflow.update({
      where: { id: w.id },
      data: {
        status: "RUNNING",
        revision: input.revision,
        pendingRequestId: input.clientRequestId,
        resourceId: null,
      },
    });
    w = await recoverBaamWorkflow(f.ctx, w.id);
    expect(w.status).toBe("COMPLETED");
    expect(w.resourceId).toBe(productId);
    expect(
      await prisma.product.count({
        where: { organizationId: f.org.id, name: "Recover only once" },
      }),
    ).toBe(1);
  });
  it("keeps committed partial work visible and recovers the same immutable action", async () => {
    const f = await fixture();
    let w = await start(f, "product_create");
    const original = baamActions.product_create.execute;
    const fail = vi
      .spyOn(baamActions.product_create, "execute")
      .mockImplementation(async (c, p) => {
        await original(c, p);
        throw new AppError("baamActionFailed", "CONFLICT", 409);
      });
    try {
      w = await submitBaamWorkflow(
        f.ctx,
        request(w, { name: "Partial once", baseUnitId: f.baseUnit.id, storeId: f.store.id }),
      );
      expect(w.status).toBe("FAILED");
      expect(w.pendingRequestId).toBeTruthy();
      expect(w.result).toMatchObject({ title: "Partially completed" });
      expect(
        await prisma.product.count({ where: { name: "Partial once", organizationId: f.org.id } }),
      ).toBe(1);
    } finally {
      fail.mockRestore();
    }
    w = await recoverBaamWorkflow(f.ctx, w.id);
    expect(w.status).toBe("COMPLETED");
    expect(w.pendingRequestId).toBeNull();
    expect(
      await prisma.product.count({ where: { name: "Partial once", organizationId: f.org.id } }),
    ).toBe(1);
  });
});
