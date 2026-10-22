import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { getLogger } from "@/server/logging";
import { businessCaller } from "@/server/services/baamBusiness";
import { createBaamConversation } from "@/server/services/baamConversations";
import { sendBaamMessage } from "@/server/services/baamCompanion";
import { getSalesAnalyticsOverview } from "@/server/services/salesAnalytics";
import { executeBaamProductPlan } from "@/server/services/baamProducts";
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
  logger: getLogger("baam-intelligence-test"),
});
const intent = (values = {}) => ({
  kind: "analytics",
  action: null,
  confidence: "high",
  fields: [],
  query: null,
  dateFrom: null,
  dateTo: null,
  period: null,
  reply: null,
  recordKind: null,
  ...values,
});
const provider = (value: unknown) =>
  Response.json({
    status: "completed",
    output: [
      { type: "function_call", name: "understand_request", arguments: JSON.stringify(value) },
    ],
  });

describe.skipIf(!shouldRunDbTests)(
  "Baam unified chat with real authorized business records",
  () => {
    beforeEach(async () => {
      await resetDatabase();
      vi.stubEnv("AI_PROVIDER", "deepseek");
      vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-only");
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });
    async function fixture() {
      const f = await seedBase({ plan: "ENTERPRISE" });
      const ctx = context(f.adminUser),
        api = businessCaller(ctx);
      const products = [];
      for (let i = 1; i <= 8; i++) {
        const p = await prisma.product.create({
          data: {
            organizationId: f.org.id,
            name: `Rank product ${i}`,
            sku: `RANK-${i}`,
            unit: "each",
            baseUnitId: f.baseUnit.id,
            basePriceKgs: 100,
            storeProducts: { create: { organizationId: f.org.id, storeId: f.store.id } },
          },
        });
        products.push(p);
      }
      const register = await api.pos.registers.create({
        storeId: f.store.id,
        name: "Intelligence test",
        code: "AI",
      });
      const shift = await api.pos.shifts.open({
        registerId: register.id,
        openingCashKgs: 0,
        idempotencyKey: randomUUID(),
      });
      const draft = await api.pos.sales.createDraft({
        registerId: register.id,
        lines: products.map((p, i) => ({ productId: p.id, qty: i + 1 })),
      });
      const sale = await api.pos.sales.get({ saleId: draft.id });
      await api.pos.sales.complete({
        saleId: draft.id,
        idempotencyKey: randomUUID(),
        payments: [{ method: "CASH", amountKgs: Number(sale!.totalKgs) }],
        clientState: {
          visibleCartLineCount: sale!.lines.length,
          visibleCartTotalKgs: Number(sale!.totalKgs),
          reviewedLines: sale!.lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            qty: l.qty,
            unitPriceKgs: Number(l.unitPriceKgs),
          })),
        },
      });
      const conversation = await createBaamConversation(ctx, { locale: "ru", storeId: f.store.id });
      const send = (text: string, locale: "ru" | "en" | "kg" = "ru") =>
        sendBaamMessage(ctx, {
          text,
          locale,
          conversationId: conversation.id,
          revision: 0,
          clientRequestId: randomUUID(),
          attachmentIds: [],
        });
      return { ...f, ctx, api, products, conversation, send, saleId: draft.id, shift };
    }
    it.each([
      ["Покажи топ-7 товаров за сегодня", "ru", 7],
      ["Бул айдагы эң көп сатылган 6 товарды көрсөт", "kg", 6],
    ] as const)(
      "answers %s from the current chat and respects its requested count",
      async (text, locale, count) => {
        const f = await fixture();
        const network = vi.fn();
        vi.stubGlobal("fetch", network);
        const result = await f.send(text, locale);
        expect(result.status).toBe("COMPLETED");
        const answer = result.data.messages.filter((m) => m.role === "assistant").at(-1)!;
        const parts = answer.parts as Array<{
          type: string;
          title?: string;
          displayFields?: unknown;
        }>;
        const cards = parts.filter((p) => p.type === "record");
        expect(cards, JSON.stringify(answer)).toHaveLength(count);
        expect(cards[0].title).toBe("Rank product 8");
        expect(JSON.stringify(cards[0].displayFields)).toContain("800");
        expect(parts.some((p) => p.type === "analysisContext")).toBe(true);
        expect(network).not.toHaveBeenCalled();
      },
    );
    it("answers a general how-to without changing business records", async () => {
      const f = await fixture();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            provider(
              intent({ kind: "answer", reply: "Откройте товары и добавьте варианты размеров." }),
            ),
          ),
      );
      const before = await prisma.product.count();
      const result = await f.send("Не создавай товар, объясни как добавить размеры");
      expect(result.status).toBe("COMPLETED");
      expect(result.data.messages.at(-1)?.text).toContain("варианты");
      expect(await prisma.product.count()).toBe(before);
      expect(result.data.workflows).toHaveLength(0);
    });
    it("keeps a simple sales summary fast and renders server-derived metric cards", async () => {
      const f = await fixture();
      const network = vi.fn();
      vi.stubGlobal("fetch", network);
      const result = await f.send("Продажи за сегодня");
      expect(result.status).toBe("COMPLETED");
      const part = (
        result.data.messages.at(-1)?.parts as Array<{
          type: string;
          cards?: Array<{ value: string }>;
        }>
      ).find((item) => item.type === "metrics")!;
      expect(part.cards?.map((card) => card.value)).toContain("3 600 KGS");
      expect(network).not.toHaveBeenCalled();
    });
    it("preserves basic catalog search without granting a locked analytics feature", async () => {
      const f = await fixture();
      await prisma.organization.update({ where: { id: f.org.id }, data: { plan: "STARTER" } });
      vi.stubGlobal("fetch", vi.fn());
      const found = await f.send("Найди товар RANK-3");
      expect(found.status).toBe("COMPLETED");
      expect(JSON.stringify(found.data.messages.at(-1)?.parts)).toContain(f.products[2].id);
      const ranking = await f.send("Покажи топ-7 товаров за сегодня");
      expect(ranking.status).toBe("FAILED");
      expect(ranking.data.messages.at(-1)?.text).toBe("featureLockedAnalytics");
    });
    it("searches only customers visible to the manager and never sends their records to the provider", async () => {
      const f = await fixture();
      const hidden = await prisma.store.create({
        data: { organizationId: f.org.id, name: "Hidden", code: "HIDDEN" },
      });
      await prisma.customer.createMany({
        data: [
          {
            organizationId: f.org.id,
            storeId: f.store.id,
            name: "Visible customer",
            phone: "+996555000001",
          },
          {
            organizationId: f.org.id,
            storeId: hidden.id,
            name: "Hidden private customer",
            phone: "+996555000002",
          },
        ],
      });
      const ctx = context(f.managerUser),
        c = await createBaamConversation(ctx, { locale: "en" });
      const network = vi
        .fn()
        .mockResolvedValue(provider(intent({ kind: "records", recordKind: "customers" })));
      vi.stubGlobal("fetch", network);
      const result = await sendBaamMessage(ctx, {
        conversationId: c.id,
        revision: 0,
        text: "Show customers",
        locale: "en",
        clientRequestId: randomUUID(),
        attachmentIds: [],
      });
      expect(result.status).toBe("COMPLETED");
      expect(JSON.stringify(result.data.messages)).toContain("Visible customer");
      expect(JSON.stringify(result.data.messages)).not.toContain("Hidden private customer");
      expect(String(network.mock.calls[0][1].body)).not.toContain("+996555000001");
    });
    it("refuses unsupported parallel plans before any mutation", async () => {
      const f = await fixture();
      const item = {
        type: "function_call",
        name: "understand_request",
        arguments: JSON.stringify(intent({ kind: "action", action: "customer_create" })),
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ status: "completed", output: [item, item] })),
      );
      const before = await prisma.customer.count();
      const result = await f.send("Добавь нового покупателя");
      expect(result.status).toBe("FAILED");
      expect(await prisma.customer.count()).toBe(before);
      expect(result.data.workflows).toHaveLength(0);
    });
    it("keeps exact Bishkek day boundaries independent of the PostgreSQL session timezone", async () => {
      const f = await fixture();
      for (const [completedAt, expected] of [
        ["2026-10-21T17:59:59.999Z", 0],
        ["2026-10-21T18:00:00.000Z", 3600],
        ["2026-10-22T17:59:59.999Z", 3600],
        ["2026-10-22T18:00:00.000Z", 0],
      ] as const) {
        await prisma.customerOrder.update({
          where: { id: f.saleId },
          data: { completedAt: new Date(completedAt) },
        });
        for (const timezone of ["UTC", "Asia/Bishkek"]) {
          const report = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
            return getSalesAnalyticsOverview(
              {
                organizationId: f.org.id,
                storeId: f.store.id,
                dateFrom: "2026-10-22",
                dateTo: "2026-10-22",
              },
              tx,
            );
          });
          expect(report.totals.grossSalesKgs, `${completedAt} / ${timezone}`).toBe(expected);
          expect(report.totals.paymentBreakdown.CASH).toBe(expected);
        }
        const product = await executeBaamProductPlan({
          actorId: f.adminUser.id,
          storeId: f.store.id,
          locale: "en",
          range: { dateFrom: "2026-10-22", dateTo: "2026-10-22" },
          plan: {
            intent: "products",
            productAction: "ranking",
            query: null,
            direction: "top",
            metric: "revenue",
            limit: 1,
          },
        });
        expect(product.cards[0].displayFields[0].value).toBe(`${expected ? "800" : "0"} KGS`);
      }
    });
    it("opens the exact authorized customer and order instead of an unrelated directory", async () => {
      const f = await fixture();
      const customer = await prisma.customer.create({
        data: { organizationId: f.org.id, storeId: f.store.id, name: "Aibek" },
      });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            provider(intent({ kind: "records", recordKind: "customers", query: "Aibek" })),
          ),
      );
      const result = await f.send("Найди клиента Айбека");
      const record = (
        result.data.messages.at(-1)?.parts as Array<{ type: string; href: string }>
      ).find((part) => part.type === "record")!;
      expect(record.href).toBe(`/customers?customerId=${customer.id}&storeId=${f.store.id}`);
    });
    it("ranks actual returned quantities independently of sales ranking", async () => {
      const f = await fixture();
      const sale = await f.api.pos.sales.get({ saleId: f.saleId });
      const returnedLine = sale!.lines.find((line) => line.productId === f.products[1].id)!;
      const draft = await f.api.pos.returns.createDraft({
        originalSaleId: f.saleId,
        shiftId: f.shift.id,
      });
      await f.api.pos.returns.addLine({
        saleReturnId: draft.id,
        customerOrderLineId: returnedLine.id,
        qty: 2,
      });
      await f.api.pos.returns.complete({
        saleReturnId: draft.id,
        idempotencyKey: randomUUID(),
        payments: [{ method: "CASH", amountKgs: 200 }],
      });
      const result = await f.send("Какие товары чаще всего возвращают за месяц?");
      expect(result.status).toBe("COMPLETED");
      const cards = (
        result.data.messages.at(-1)?.parts as Array<{
          type: string;
          title?: string;
          displayFields?: Array<{ label: string; value: string }>;
        }>
      ).filter((part) => part.type === "record");
      expect(cards[0].title).toBe("Rank product 2");
      expect(cards).toHaveLength(1);
      expect(
        cards[0].displayFields?.find((field) => field.label === "Возвращённое количество")?.value,
      ).toBe("2 each");
    });
    it("executes a filled form by explicit voice/text confirmation once and retains incomplete forms", async () => {
      const f = await fixture();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          provider(
            intent({
              kind: "action",
              action: "stock_receive",
              fields: [
                { path: "storeId", value: f.store.id },
                { path: "lines.0.productId", value: f.products[0].id },
                { path: "lines.0.quantity", value: "3" },
                { path: "lines.0.unitCost", value: "0" },
              ],
            }),
          ),
        ),
      );
      const prepared = await f.send("Прими три штуки чая с нулевой себестоимостью");
      expect(prepared.data.workflows[0].status).toBe("EDITING");
      const network = vi.fn();
      vi.stubGlobal("fetch", network);
      const input = {
        text: "Подтверждаю выполнение",
        locale: "ru" as const,
        conversationId: f.conversation.id,
        revision: 0,
        clientRequestId: randomUUID(),
        attachmentIds: [],
      };
      const done = await sendBaamMessage(f.ctx, input);
      expect(done.data.workflows[0].status, JSON.stringify(done.data.messages)).toBe("COMPLETED");
      expect((await sendBaamMessage(f.ctx, input)).replayed).toBe(true);
      expect(
        await prisma.stockMovement.count({
          where: { productId: f.products[0].id, type: "RECEIVE" },
        }),
      ).toBe(1);
      expect(network).not.toHaveBeenCalled();
      const pending = await f.send("Оприходование");
      expect(pending.status).toBe("COMPLETED");
      expect(
        pending.data.workflows.find((w) => w.id === pending.data.conversation.activeWorkflowId)
          ?.status,
      ).toBe("EDITING");
      const confirm = await f.send("Подтверждаю выполнение");
      expect(
        confirm.data.workflows.find((w) => w.id === confirm.data.conversation.activeWorkflowId)
          ?.status,
      ).toBe("EDITING");
      expect(
        await prisma.stockMovement.count({
          where: { productId: f.products[0].id, type: "RECEIVE" },
        }),
      ).toBe(1);
    });
    it("keeps a customer without phone/email in review instead of attempting a known-invalid creation", async () => {
      const f = await fixture();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          provider(
            intent({
              kind: "action",
              action: "customer_create",
              fields: [
                { path: "name", value: "Needs contact" },
                { path: "storeId", value: f.store.id },
              ],
            }),
          ),
        ),
      );
      const before = await prisma.customer.count();
      const proposed = await f.send("Создай клиента без контакта");
      expect(proposed.data.workflows[0].status).toBe("EDITING");
      expect((await f.send("Подтверждаю выполнение")).data.workflows[0].status).toBe("EDITING");
      expect(await prisma.customer.count()).toBe(before);
    });
  },
);
