// Opt-in, real-provider acceptance of complete user flows in the owned local
// synthetic organization. This is deliberately separate from automated CI.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd(), true);
assert.equal(process.env.BAAM_LIVE_PROVIDER, "1", "Real-provider acceptance is explicitly opt-in");
const keys = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};
assert(keys.DEEPSEEK_API_KEY);
Object.assign(process.env, baamTestEnvironment(), keys, { AI_PROVIDER: "deepseek" });
assertBaamTestDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { getLogger } = await import("../../src/server/logging");
const { createBaamConversation } = await import("../../src/server/services/baamConversations");
const { sendBaamMessage } = await import("../../src/server/services/baamCompanion");
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.adminId } });
assert.equal(
  (await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } })).name,
  "BAAM Test Organization",
);
const ctx = {
  prisma,
  user: { ...user, isPlatformOwner: false },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("baam-full-recheck"),
};
const directory = "artifacts/baam-companion/recheck";
await mkdir(directory, { recursive: true });
const voice = process.argv.includes("--voice");
const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice(7)
  .split(",");
const actions = process.argv.includes("--actions");
const mode = actions ? (voice ? "voice-actions" : "actions") : voice ? "voice" : "reads";
const results: Array<Record<string, unknown>> = [];
const turns: Array<Record<string, unknown>> = [];
const persist = () =>
  writeFile(
    `${directory}/${mode}.json`,
    JSON.stringify(
      { at: new Date().toISOString(), synthetic: true, provider: "deepseek", results, turns },
      null,
      2,
    ),
  );
type Answer = Awaited<ReturnType<typeof ask>>;
async function ask(
  text: string,
  conversationId?: string,
  locale: "ru" | "en" | "kg" = "ru",
  page?: string,
  forceText = false,
) {
  const id = conversationId ?? (await createBaamConversation(ctx, { locale })).id;
  // Say Latin SKUs letter by letter. A Russian TTS voice otherwise pronounces
  // AI-QA as a different word ("айко"), which does not represent the intended SKU.
  const spokenText = text.replace(
    /AI-QA-(\d+)/g,
    (_, n: string) => `эй ай дефис кью эй дефис ${n}`,
  );
  let transcript: { text?: string | null; id: string } | undefined;
  if (voice && !forceText) {
    assert(locale !== "kg", "Kyrgyz voice uses the separately recorded acceptance sample");
    const stem = `${directory}/voice-${results.length}-${randomUUID()}`;
    await promisify(execFile)("/usr/bin/say", [
      "-v",
      locale === "ru" ? "Milena" : "Samantha",
      "-r",
      String(175 + (turns.length % 13)),
      "-o",
      `${stem}.aiff`,
      spokenText,
    ]);
    await promisify(execFile)("/usr/bin/afconvert", [
      "-f",
      "WAVE",
      "-d",
      "LEI16@16000",
      "-c",
      "1",
      `${stem}.aiff`,
      `${stem}.wav`,
    ]);
    // Each recording has its own leading pause. TTS can otherwise emit identical
    // bytes for repeated confirmations, which correctly triggers replay protection.
    const pcm = await readFile(`${stem}.wav`);
    let dataOffset = 12;
    while (pcm.toString("ascii", dataOffset, dataOffset + 4) !== "data") {
      const chunkSize = pcm.readUInt32LE(dataOffset + 4);
      dataOffset += 8 + chunkSize + (chunkSize % 2);
      assert(dataOffset + 8 <= pcm.length, "TTS fixture must contain a PCM data chunk");
    }
    const silence = Buffer.alloc(320 * (turns.length + 1));
    const recording = Buffer.concat([
      pcm.subarray(0, dataOffset + 8),
      silence,
      pcm.subarray(dataOffset + 8),
    ]);
    recording.writeUInt32LE(pcm.readUInt32LE(dataOffset + 4) + silence.length, dataOffset + 4);
    recording.writeUInt32LE(recording.length - 8, 4);
    await writeFile(`${stem}.wav`, recording);
    const { transcribeBaamAudio } = await import("../../src/server/services/baamAudio");
    transcript = await transcribeBaamAudio(ctx, id, recording, "audio/wav", locale);
  }
  const result = await sendBaamMessage(ctx, {
    text: transcript?.text ?? text,
    ...(transcript ? { transcriptionId: transcript.id } : {}),
    locale,
    conversationId: id,
    clientRequestId: randomUUID(),
    revision: 0,
    attachmentIds: [],
    ...(page ? { page: { path: page } } : {}),
  });
  const answer = result.data.messages.filter((m) => m.role === "assistant").at(-1)!;
  const parts = (answer.parts ?? []) as Array<Record<string, any>>;
  turns.push({
    request: text,
    spokenText: voice && !forceText ? spokenText : undefined,
    transcript: transcript?.text,
    status: result.status,
    answer: answer.text,
    workflows: result.data.workflows.map((w) => ({
      kind: w.kind,
      status: w.status,
      parameters: w.parameters,
      resourceId: w.resourceId,
    })),
  });
  assert.equal(result.status, "COMPLETED", answer?.text);
  return {
    result,
    answer,
    parts,
    cards: parts.filter((p) => p.type === "record"),
    id,
    transcript: transcript?.text,
    spokenText: voice && !forceText ? spokenText : undefined,
  };
}
const noWorkflow = (a: Answer) => assert.equal(a.result.data.workflows.length, 0, a.answer.text);
const metrics = (a: Answer) => {
  noWorkflow(a);
  assert(
    a.parts.some((p) => p.type === "salesMetrics" || p.type === "metrics"),
    JSON.stringify(a.parts).slice(0, 400),
  );
};
const ranking = (n: number) => (a: Answer) => {
  noWorkflow(a);
  assert.equal(a.cards.length, n, a.answer.text);
  assert.equal(a.cards[0].title, "AI QA Tea 8");
  assert(a.cards.every((p) => p.href?.startsWith("/products/")));
};
const explanation = (a: Answer) => {
  noWorkflow(a);
  assert(a.answer.text.length > 120, a.answer.text);
  assert(!/^Выберите, что нужно сделать/.test(a.answer.text));
};
const cases: Array<{
  name: string;
  text: string;
  check: (a: Answer) => void;
  locale?: "ru" | "en" | "kg";
  page?: string;
}> = [
  {
    name: "explicit-spoken-day",
    text: "Покажи продажи за 22 октября 2026 года",
    check: (a) => {
      metrics(a);
      assert.match(a.answer.text, /3[\s\u00a0\u202f]?600/);
    },
  },
  {
    name: "top-seven-spoken",
    text: "Покажи топ семь товаров по количеству за октябрь 2026",
    check: ranking(7),
  },
  {
    name: "top-three-current-year",
    text: "Покажи три самых продаваемых товара по выручке за октябрь",
    check: ranking(3),
  },
  {
    name: "product-performance-sku-day-confusion",
    text: "Как продавался товар AI-QA-3 за октябрь?",
    check: (a) => {
      noWorkflow(a);
      assert.equal(a.cards.length, 1, a.answer.text);
      assert.equal(a.cards[0].title, "AI QA Tea 3");
      assert.match(JSON.stringify(a.cards), /300/);
    },
  },
  {
    name: "zero-sales",
    text: "Какие товары вообще не продавались за октябрь?",
    check: (a) => {
      noWorkflow(a);
      assert(a.cards.length > 0, a.answer.text);
      assert(a.cards.every((p) => !/^AI QA Tea [1-8]$/.test(p.title)));
    },
  },
  {
    name: "no-returns",
    text: "Какие товары чаще всего возвращают за октябрь?",
    check: (a) => {
      noWorkflow(a);
      assert.equal(a.cards.length, 0, a.answer.text);
    },
  },
  {
    name: "comparison",
    text: "Сравни продажи за эту неделю с предыдущим периодом",
    check: metrics,
  },
  {
    name: "ordinal-range",
    text: "Покажи продажи с первого по пятнадцатое сентября 2026 года",
    check: (a) => {
      metrics(a);
      assert.match(JSON.stringify(a.parts), /2026-09-01/);
      assert.match(JSON.stringify(a.parts), /2026-09-15/);
    },
  },
  { name: "diagnostics-without-causes", text: "Почему изменились продажи?", check: metrics },
  {
    name: "product-search",
    text: "Найди товар AI-QA-3",
    check: (a) => {
      noWorkflow(a);
      assert(
        a.cards.some((p) => p.title === "AI QA Tea 3") ||
          a.parts.some((p) => p.type === "link" && /AI QA Tea 3/.test(p.label)),
        a.answer.text,
      );
    },
  },
  {
    name: "receipt-search",
    text: "Найди кассовый чек S-000001",
    check: (a) => {
      noWorkflow(a);
      assert(
        a.cards.some((p) => p.title === "S-000001" && p.href.includes("saleId=")),
        a.answer.text,
      );
    },
  },
  {
    name: "supplier-search",
    text: "Покажи поставщиков",
    check: (a) => {
      noWorkflow(a);
      assert(
        a.cards.some((p) => p.title === "Test Supplier"),
        a.answer.text,
      );
    },
  },
  {
    name: "stores",
    text: "Покажи мои магазины",
    check: (a) => {
      noWorkflow(a);
      assert(
        a.cards.some((p) => p.title === "Test Store") && a.cards.some((p) => p.title === "Ош"),
        a.answer.text,
      );
    },
  },
  {
    name: "empty-search",
    text: "Найди товар Несуществующий фиолетовый трактор",
    check: (a) => {
      noWorkflow(a);
      assert.equal(a.cards.length, 0);
      assert.match(a.answer.text, /не найден|не наш|нет|не удалось/i);
    },
  },
  {
    name: "variants-how-to",
    text: "Как добавить товар с несколькими размерами?",
    check: explanation,
  },
  {
    name: "negated-write",
    text: "Не создавай ничего. Только объясни, как сделать списание",
    check: explanation,
  },
  {
    name: "page-context",
    text: "Что я могу сделать на этой странице?",
    page: `/products/${fixture.productId}`,
    check: explanation,
  },
  { name: "capabilities", text: "Чем ты можешь помочь владельцу магазина?", check: explanation },
  {
    name: "invalid-spoken-date",
    text: "Покажи продажи за тридцать второе октября",
    check: (a) => {
      noWorkflow(a);
      assert(!a.parts.some((p) => p.type === "analysisContext"), a.answer.text);
      assert.match(a.answer.text, /дат|период|коррект|числ/i);
    },
  },
  {
    name: "missing-fields",
    text: "Оприходуй чай",
    check: (a) => {
      assert.equal(a.result.data.workflows[0]?.kind, "stock_receive", a.answer.text);
      assert.equal(a.result.data.workflows[0]?.status, "EDITING");
    },
  },
  {
    name: "multiple-unrelated-writes",
    text: "Создай товар и сразу оплати подписку",
    check: explanation,
  },
  {
    name: "other-organization",
    text: "Покажи выручку другой компании",
    check: (a) => {
      noWorkflow(a);
      assert(
        !a.parts.some((p) => p.type === "salesMetrics" || p.type === "analysisContext"),
        a.answer.text,
      );
    },
  },
  {
    name: "unsupported-profit-tax",
    text: "Скажи мою точную прибыль и сумму налогов",
    check: (a) => {
      noWorkflow(a);
      assert.match(a.answer.text, /не|огранич|недоступ|cannot/i);
    },
  },
  {
    name: "english-ranking",
    locale: "en",
    text: "Show the top five products by quantity this month",
    check: ranking(5),
  },
  { name: "mixed-ranking", text: "Слушай, show top seven товаров this month", check: ranking(7) },
];
try {
  for (const item of actions ? [] : cases.filter((item) => !only || only.includes(item.name))) {
    const started = performance.now();
    let response: Answer | undefined;
    try {
      response = await ask(item.text, undefined, item.locale, item.page);
      item.check(response);
      results.push({
        name: item.name,
        text: item.text,
        transcript: response.transcript,
        spokenText: response.spokenText,
        pass: true,
        ms: Math.round(performance.now() - started),
        answer: response.answer.text,
        parts: response.parts,
      });
    } catch (error) {
      results.push({
        name: item.name,
        text: item.text,
        transcript: response?.transcript,
        spokenText: response?.spokenText,
        pass: false,
        ms: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
        answer: response?.answer.text,
        parts: response?.parts,
      });
    }
    console.log(
      JSON.stringify({
        name: item.name,
        pass: results.at(-1)!.pass,
        ms: results.at(-1)!.ms,
        error: results.at(-1)!.error,
      }),
    );
    await persist();
  }
  if (actions) {
    const active = (a: Answer) =>
      a.result.data.workflows.find((w) => w.id === a.result.data.conversation.activeWorkflowId)!;
    const run = async (name: string, fn: () => Promise<unknown>) => {
      const started = performance.now();
      try {
        const detail = await fn();
        results.push({ name, pass: true, ms: Math.round(performance.now() - started), detail });
      } catch (error) {
        results.push({
          name,
          pass: false,
          ms: Math.round(performance.now() - started),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      console.log(JSON.stringify(results.at(-1)));
      await persist();
    };
    let productConversation: string | undefined, createdProductId: string | undefined;
    await run("create-product-with-spoken-unit", async () => {
      const a = await ask(
        "Создай товар Голосовой чай в магазине Test Store, единица штука, цена 150 сом, без фотографии",
      );
      productConversation = a.id;
      let wf = active(a);
      assert.equal(wf.kind, "product_create", a.answer.text);
      if (wf.status === "EDITING") wf = active(await ask("Подтверждаю выполнение", a.id));
      assert.equal(wf.status, "COMPLETED", JSON.stringify(wf));
      createdProductId = wf.resourceId!;
      const p = await prisma.product.findUniqueOrThrow({ where: { id: createdProductId } });
      assert.equal(Number(p.basePriceKgs), 150);
      assert.equal(p.baseUnitId, fixture.unitId);
      return { id: p.id, name: p.name, price: Number(p.basePriceKgs), unit: p.baseUnitId };
    });
    await run("follow-up-price-without-repeating-product", async () => {
      assert(createdProductId && productConversation);
      const a = await ask("Теперь измени ему цену на 175 сом", productConversation);
      let wf = active(a);
      assert.equal(wf.kind, "product_update", a.answer.text);
      if (wf.status === "EDITING") wf = active(await ask("Подтверждаю выполнение", a.id));
      assert.equal(wf.status, "COMPLETED", JSON.stringify(wf));
      assert.equal(
        Number(
          (await prisma.product.findUniqueOrThrow({ where: { id: createdProductId } }))
            .basePriceKgs,
        ),
        175,
      );
      return { updatedSameProduct: true, price: 175 };
    });
    await run("create-supplier", async () => {
      const a = await ask("Добавь поставщика Голосовой поставщик");
      let wf = active(a);
      assert.equal(wf.kind, "supplier_create", a.answer.text);
      if (wf.status === "EDITING") wf = active(await ask("Подтверждаю выполнение", a.id));
      assert.equal(wf.status, "COMPLETED", JSON.stringify(wf));
      assert(await prisma.supplier.findUnique({ where: { id: wf.resourceId! } }));
      return { id: wf.resourceId };
    });
    await run("missing-customer-contact-and-follow-up", async () => {
      const a = await ask("Добавь клиента Айбек Голосовой в магазин Test Store");
      assert.equal(active(a).kind, "customer_create", a.answer.text);
      assert.equal(active(a).status, "EDITING");
      const b = await ask(
        "Укажи ему электронную почту aibek.voice@example.invalid",
        a.id,
        "ru",
        undefined,
        true,
      );
      const done = await ask("Подтверждаю выполнение", b.id);
      const wf = active(done);
      assert.equal(wf.status, "COMPLETED", JSON.stringify(wf));
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: wf.resourceId! } });
      assert.equal(customer.email, "aibek.voice@example.invalid");
      return { id: customer.id, requiredContactWasRequested: true };
    });
    await run("receive-correct-confirm-and-no-duplicate", async () => {
      const before = await prisma.stockMovement.count({
        where: { productId: fixture.productId, type: "RECEIVE" },
      });
      const a = await ask(
        "Оприходуй две штуки товара TEST-1 в магазин Test Store, себестоимость ноль сом",
      );
      assert.equal(active(a).kind, "stock_receive", a.answer.text);
      assert.equal(active(a).status, "EDITING");
      const b = await ask("Нет, количество три", a.id);
      assert.equal((active(b).parameters as any).lines[0].quantity, 3);
      const done = await ask("Подтверждаю выполнение", a.id);
      assert.equal(active(done).status, "COMPLETED", JSON.stringify(active(done)));
      const after = await prisma.stockMovement.count({
        where: { productId: fixture.productId, type: "RECEIVE" },
      });
      assert.equal(after, before + 1);
      const movement = await prisma.stockMovement.findFirstOrThrow({
        where: { productId: fixture.productId, type: "RECEIVE" },
        orderBy: { createdAt: "desc" },
      });
      assert.equal(movement.qtyDelta, 3);
      await ask("Подтверждаю выполнение", a.id);
      assert.equal(
        await prisma.stockMovement.count({
          where: { productId: fixture.productId, type: "RECEIVE" },
        }),
        after,
      );
      return { quantity: movement.qtyDelta, duplicateCreated: false };
    });
    await run("stock-count-create", async () => {
      const a = await ask("Создай инвентаризацию магазина Test Store");
      let wf = active(a);
      assert.equal(wf.kind, "count_create", a.answer.text);
      if (wf.status === "EDITING") wf = active(await ask("Подтверждаю выполнение", a.id));
      assert.equal(wf.status, "COMPLETED", JSON.stringify(wf));
      assert.notEqual(
        (await prisma.stockCount.findUniqueOrThrow({ where: { id: wf.resourceId! } })).status,
        "APPLIED",
      );
      return { id: wf.resourceId, applied: false };
    });
    await run("unpaid-receipt-with-register-resolution", async () => {
      // Preserve a previous unpaid cart by explicitly holding it through Baam.
      // Re-running acceptance must not silently erase it or demand a second cart.
      const previous = await prisma.customerOrder.findFirst({
        where: {
          organizationId: fixture.organizationId,
          storeId: fixture.storeId,
          createdById: user.id,
          isPosSale: true,
          status: "DRAFT",
          isHeld: false,
        },
      });
      if (previous) {
        const hold = await ask(`Отложи неоплаченный кассовый чек ${previous.number}`);
        await ask("Подтверждаю выполнение", hold.id);
        assert.equal(
          (await prisma.customerOrder.findUniqueOrThrow({ where: { id: previous.id } })).isHeld,
          true,
        );
      }
      const a = await ask(
        "Подготовь неоплаченный кассовый чек на одну штуку AI-QA-1 в магазине Test Store",
      );
      let wf = active(a);
      assert.equal(wf.kind, "pos_create_draft", a.answer.text);
      if (wf.status === "EDITING") wf = active(await ask("Подтверждаю выполнение", a.id));
      assert.equal(wf.status, "RECEIPT", JSON.stringify(wf));
      const sale = await prisma.customerOrder.findUniqueOrThrow({ where: { id: wf.resourceId! } });
      assert.equal(sale.status, "DRAFT");
      assert.equal(await prisma.salePayment.count({ where: { customerOrderId: sale.id } }), 0);
      return { number: sale.number, paid: false };
    });
    await run("cancel-pending-operation", async () => {
      const a = await ask(
        "Оприходуй две штуки товара TEST-1 в магазин Test Store, себестоимость ноль сом",
      );
      const id = active(a).id;
      await ask("Отмени текущую операцию", a.id);
      assert.equal(
        (await prisma.baamWorkflow.findUniqueOrThrow({ where: { id } })).status,
        "CANCELLED",
      );
      return { cancelled: true };
    });
    await run("comparison-follow-up-context", async () => {
      const a = await ask("Сравни продажи за эту неделю с предыдущим периодом");
      metrics(a);
      const b = await ask("А за вчера?", a.id);
      metrics(b);
      const context = b.parts.find((p) => p.type === "analysisContext");
      assert.equal(context?.dateFrom, "2026-10-21");
      assert.equal(context?.dateTo, "2026-10-21");
      return { comparisonRetained: true, dateFrom: context?.dateFrom, dateTo: context?.dateTo };
    });
  }
  console.log(`${mode}: ${results.filter((r) => r.pass).length}/${results.length}`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
