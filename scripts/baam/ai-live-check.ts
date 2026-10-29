// Explicit, opt-in acceptance against synthetic records in the dedicated local
// BAAM database. Never run this from automated tests or against customer data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { baamTestEnvironment, assertBaamTestDatabase } from "./environment";
const require = createRequire(import.meta.url);
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd(), true);
assert.equal(
  process.env.BAAM_LIVE_PROVIDER,
  "1",
  "Live provider checks require explicit BAAM_LIVE_PROVIDER=1",
);
const keys = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};
assert(keys.DEEPSEEK_API_KEY, "Set the server-only DeepSeek key");
Object.assign(process.env, baamTestEnvironment(), keys, { AI_PROVIDER: "deepseek" });
assertBaamTestDatabase();
const { prisma } = await import("../../src/server/db/prisma");
const { getLogger } = await import("../../src/server/logging");
const { businessCaller } = await import("../../src/server/services/baamBusiness");
const { createBaamConversation } = await import("../../src/server/services/baamConversations");
const { sendBaamMessage } = await import("../../src/server/services/baamCompanion");
const fixture = JSON.parse(await readFile("artifacts/baam-companion/fixture.json", "utf8"));
const user = await prisma.user.findUniqueOrThrow({ where: { id: fixture.adminId } });
assert.equal(user.organizationId, fixture.organizationId);
assert.equal(
  (await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId } })).name,
  "BAAM Test Organization",
);
const ctx = {
  prisma,
  user: { ...user, organizationId: fixture.organizationId, isPlatformOwner: false },
  impersonator: null,
  impersonationSessionId: null,
  ip: "127.0.0.1",
  requestId: randomUUID(),
  logger: getLogger("ai-live-synthetic"),
};
const api = businessCaller(ctx);
await mkdir("tmp/ai-upgrade", { recursive: true });
const results: Array<Record<string, unknown>> = [];
const run = async (name: string, fn: () => Promise<unknown>) => {
  const start = performance.now();
  try {
    const detail = await fn();
    results.push({ name, pass: true, ms: Math.round(performance.now() - start), detail });
  } catch (error) {
    results.push({
      name,
      pass: false,
      ms: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message.slice(0, 600) : "error",
    });
  }
  console.log(JSON.stringify(results.at(-1)));
  await writeFile(
    `tmp/ai-upgrade/live-${process.argv.includes("--voice") ? "voice-command" : process.argv.includes("--actions") ? "actions" : process.argv.includes("--catalog") ? "catalog" : process.argv.includes("--intents") ? "intents" : process.argv.includes("--media") ? "media" : "text"}-acceptance.json`,
    JSON.stringify(results, null, 2),
  );
};
try {
  if (process.argv.includes("--voice")) {
    await run("spoken-business-command-to-report", async () => {
      const { transcribeBaamAudio } = await import("../../src/server/services/baamAudio");
      const c = await createBaamConversation(ctx, { locale: "ru", storeId: fixture.storeId });
      const asr = await transcribeBaamAudio(
        ctx,
        c.id,
        await readFile("tmp/ai-upgrade/ru-command.wav"),
        "audio/wav",
        "ru",
      );
      assert.match(asr.text ?? "", /семь|7/i);
      const answer = await sendBaamMessage(ctx, {
        text: asr.text!,
        transcriptionId: asr.id,
        locale: "ru",
        conversationId: c.id,
        revision: 0,
        clientRequestId: randomUUID(),
        attachmentIds: [],
      });
      assert.equal(answer.status, "COMPLETED");
      const cards = (
        answer.data.messages.at(-1)?.parts as Array<{ type: string; title?: string }>
      ).filter((part) => part.type === "record");
      assert.equal(cards.length, 7);
      assert.equal(cards[0].title, "AI QA Tea 8");
      return {
        transcript: asr.text,
        cards: cards.length,
        first: cards[0].title,
        syntheticAudio: true,
      };
    });
  } else if (process.argv.includes("--catalog")) {
    await run("category-arrangement-vision", async () => {
      const { arrangeClothingCategoriesWithAi } =
        await import("../../src/server/services/products");
      const { default: sharp } = await import("sharp");
      const { uploadProductImageBuffer } =
        await import("../../src/server/services/productImageStorage");
      const source = await uploadProductImageBuffer({
        organizationId: fixture.organizationId,
        buffer: await sharp(
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900"><rect width="800" height="900" fill="white"/><path d="M300 100 Q400 160 500 100 L550 280 475 360 650 800 150 800 325 360 250 280 Z" fill="#ad2255"/><path d="M325 360 L475 360" stroke="#66112d" stroke-width="12"/></svg>',
          ),
        )
          .png()
          .toBuffer(),
        contentType: "image/png",
        sourceFileName: "synthetic-dress.png",
      });
      await prisma.productCategory.upsert({
        where: { organizationId_name: { organizationId: fixture.organizationId, name: "Платья" } },
        update: {},
        create: { organizationId: fixture.organizationId, name: "Платья" },
      });
      const product = await prisma.product.create({
        data: {
          organizationId: fixture.organizationId,
          sku: `AI-CAT-${Date.now()}`,
          name: "QA model",
          description: "Одежда для взрослых, рост 165–175 см.",
          unit: "pcs",
          baseUnitId: fixture.unitId,
          photoUrl: source.url,
        },
      });
      const originalFetch = globalThis.fetch;
      let deepseekCalls = 0;
      globalThis.fetch = async (...args) => {
        if (String(args[0]) === "https://api.deepseek.com/responses") deepseekCalls++;
        return originalFetch(...args);
      };
      let result;
      try {
        result = await arrangeClothingCategoriesWithAi({
          organizationId: fixture.organizationId,
          actorId: user.id,
          requestId: randomUUID(),
          productIds: [product.id],
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(deepseekCalls, 1);
      const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
      // An illustrative silhouette may fall below the existing confidence
      // threshold. Skipping it is correct; never lower the threshold to pass QA.
      if (result.updated) assert(saved.categories.includes("Платья"));
      else {
        assert.equal(result.skipped, 1);
        assert.deepEqual(saved.categories, []);
      }
      return {
        ...result,
        deepseekCalls,
        categories: saved.categories,
        decision: result.updated ? "classified" : "skipped-low-confidence",
      };
    });
  } else if (process.argv.includes("--intents")) {
    const { baamAcceptanceCases, baamActionAcceptanceCases } = await import("./acceptance-cases");
    const { understandBaamIntent } = await import("../../src/server/services/baamWorkflowIntent");
    for (const [index, item] of (process.argv.includes("--actions")
      ? baamActionAcceptanceCases
      : baamAcceptanceCases
    ).entries())
      await run(`intent-${index + 1}`, async () => {
        const data = item as typeof item & {
          previousAnalysis?: unknown;
          active?: { kind: string; parameters: Record<string, unknown> };
          action?: string;
          recordKind?: string;
          explanation?: boolean;
          unclearDate?: boolean;
        };
        const result = await understandBaamIntent({
          text: item.text,
          locale: item.locale,
          history: [],
          previousAnalysis: data.previousAnalysis,
          active: data.active as Parameters<typeof understandBaamIntent>[0]["active"],
          signal: AbortSignal.timeout(30000),
          record: () => {},
        });
        assert(
          (item.kinds as readonly string[]).includes(result.kind),
          `${item.text}: ${result.kind}`,
        );
        if (data.action) assert.equal(result.action, data.action, item.text);
        if (data.recordKind) assert.equal(result.recordKind, data.recordKind, item.text);
        if (data.explanation)
          assert(result.reply && result.reply.length > 40, "Expected a useful explanation");
        if (data.unclearDate)
          assert(
            !result.dateFrom && !result.dateTo && !result.period,
            "An invalid spoken date must not become an invented period",
          );
        return {
          text: item.text,
          kind: result.kind,
          action: result.action,
          recordKind: result.recordKind,
          reply: result.reply,
        };
      });
  } else if (!process.argv.includes("--media")) {
    const products = [];
    for (let i = 1; i <= 8; i++)
      products.push(
        await prisma.product.upsert({
          where: {
            organizationId_sku: { organizationId: fixture.organizationId, sku: `AI-QA-${i}` },
          },
          update: {},
          create: {
            organizationId: fixture.organizationId,
            name: `AI QA Tea ${i}`,
            sku: `AI-QA-${i}`,
            unit: "pcs",
            baseUnitId: fixture.unitId,
            basePriceKgs: 100,
            storeProducts: {
              create: { organizationId: fixture.organizationId, storeId: fixture.storeId },
            },
          },
        }),
      );
    if (
      !(await prisma.customerOrder.findFirst({
        where: { organizationId: fixture.organizationId, notes: "AI synthetic acceptance" },
      }))
    ) {
      const register = await api.pos.registers.create({
        storeId: fixture.storeId,
        name: "AI acceptance",
        code: `AI${Date.now()}`,
      });
      await api.pos.shifts.open({
        registerId: register.id,
        openingCashKgs: 0,
        idempotencyKey: randomUUID(),
      });
      const draft = await api.pos.sales.createDraft({
        registerId: register.id,
        notes: "AI synthetic acceptance",
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
    }
    const ask = async (
      text: string,
      locale: "ru" | "en" | "kg" = "ru",
      conversationId?: string,
    ) => {
      const c =
        conversationId ??
        (await createBaamConversation(ctx, { locale, storeId: fixture.storeId })).id;
      const result = await sendBaamMessage(ctx, {
        text,
        locale,
        conversationId: c,
        clientRequestId: randomUUID(),
        revision: 0,
        attachmentIds: [],
      });
      assert.equal(result.status, "COMPLETED", result.data.messages.at(-1)?.text);
      const answer = result.data.messages.filter((m) => m.role === "assistant").at(-1)!;
      return {
        result,
        answer,
        cards: (answer.parts as Array<{ type: string; title?: string }>).filter(
          (p) => p.type === "record",
        ),
        conversationId: c,
      };
    };
    for (const [text, locale, count] of [
      ["Покажи топ-7 товаров за сегодня", "ru", 7],
      ["Бул айдагы эң көп сатылган алты товарды көрсөт", "kg", 6],
      ["Show top five products this month", "en", 5],
    ] as const)
      await run(`ranking-${locale}`, async () => {
        const a = await ask(text, locale);
        assert.equal(a.cards.length, count, a.answer.text);
        assert.equal(a.cards[0].title, "AI QA Tea 8");
        return { count, first: a.cards[0].title };
      });
    await run("comparison-and-follow-up", async () => {
      const a = await ask("Сравни продажи за сегодня с предыдущим периодом");
      assert.match(a.answer.text, /3[\s\u00a0\u202f]?600/);
      const b = await ask("А за вчера?", "ru", a.conversationId);
      assert.match(b.answer.text, /нет|0|не было/i);
      return { first: a.answer.text, followUp: b.answer.text };
    });
    await run("product-search", async () => {
      const a = await ask("Найди товар AI-QA-4");
      assert.equal(a.cards.length, 1);
      assert.equal(a.cards[0].title, "AI QA Tea 4");
      return { found: a.cards[0].title };
    });
    for (const [locale, text] of [
      ["ru", "Как добавить товар с несколькими размерами?"],
      ["en", "How can I make my small shop more profitable?"],
      ["kg", "Дүкөндө товарларды кантип кириштейм?"],
    ] as const)
      await run(`help-${locale}`, async () => {
        const a = await ask(text, locale);
        assert(a.answer.text.length > 100);
        assert.equal(a.result.data.workflows.length, 0);
        return { answer: a.answer.text };
      });
    await run("negation-without-mutation", async () => {
      const count = await prisma.product.count();
      const a = await ask("Не создавай товар, расскажи как оформить продажу");
      assert.equal(await prisma.product.count(), count);
      assert.equal(a.result.data.workflows.length, 0);
      return { answer: a.answer.text };
    });
    await run("supplier-action-idempotency", async () => {
      const c = await createBaamConversation(ctx, { locale: "ru", storeId: fixture.storeId });
      const name = `DeepSeek QA ${Date.now()}`;
      const input = {
        text: `Создай поставщика «${name}»`,
        locale: "ru" as const,
        conversationId: c.id,
        clientRequestId: randomUUID(),
        revision: 0,
        attachmentIds: [],
      };
      const a = await sendBaamMessage(ctx, input);
      assert.equal(a.status, "COMPLETED");
      const b = await sendBaamMessage(ctx, input);
      assert.equal(b.replayed, true);
      assert.equal(
        await prisma.supplier.count({ where: { organizationId: fixture.organizationId, name } }),
        1,
      );
      return { replayed: b.replayed, created: 1 };
    });
    await run("supplier-search", async () => {
      const a = await ask("Покажи поставщиков");
      assert(a.cards.length >= 1);
      return { count: a.cards.length };
    });
    await run("explicit-confirmation-receiving", async () => {
      const before = await prisma.stockMovement.count({ where: { productId: products[0].id, type: "RECEIVE" } });
      const a = await ask("Оприходуй 2 штуки товара AI-QA-1 в магазин Test Store, себестоимость 0 сом");
      assert.equal(a.result.data.workflows[0].status, "EDITING");
      assert.equal(await prisma.stockMovement.count({ where: { productId: products[0].id, type: "RECEIVE" } }), before);
      const input = { text: "Подтверждаю выполнение", locale: "ru" as const, conversationId: a.conversationId, clientRequestId: randomUUID(), revision: 0, attachmentIds: [] };
      const done = await sendBaamMessage(ctx, input);
      assert.equal(done.data.workflows[0].status, "COMPLETED");
      assert.equal((await sendBaamMessage(ctx, input)).replayed, true);
      assert.equal(await prisma.stockMovement.count({ where: { productId: products[0].id, type: "RECEIVE" } }), before + 1);
      return { status: done.data.workflows[0].status, zeroCost: true, repeatedRequestCreatedNoDuplicate: true };
    });
  } else {
    const { default: sharp } = await import("sharp");
    const { uploadProductImageBuffer } =
      await import("../../src/server/services/productImageStorage");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="#dfd7ce"/><path d="M290 160 L390 125 Q450 185 510 125 L610 160 760 300 650 405 590 340 590 750 310 750 310 340 250 405 140 300 Z" fill="#205cd0" stroke="#173a82" stroke-width="8"/><text x="450" y="420" font-family="Arial" font-size="34" fill="white" text-anchor="middle">BAZAAR QA</text><path d="M390 125 Q450 240 510 125" fill="none" stroke="#173a82" stroke-width="12"/></svg>`;
    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    const uploaded = await uploadProductImageBuffer({
      organizationId: fixture.organizationId,
      buffer: image,
      contentType: "image/png",
      sourceFileName: "ai-synthetic-shirt.png",
    });
    const { generateProductDescriptionFromImages } =
      await import("../../src/server/services/productDescriptions");
    const { suggestProductSpecsFromImages } =
      await import("../../src/server/services/productSpecSuggestions");
    for (const locale of ["ru", "en", "kg"])
      await run(`description-${locale}`, async () => {
        const result = await generateProductDescriptionFromImages({
          name: "Blue QA T-shirt",
          locale,
          imageUrls: [uploaded.url],
        });
        assert(result.description.length >= 150);
        return result;
      });
    await run("vision-specifications", async () => {
      const result = await suggestProductSpecsFromImages({
        imageUrls: [uploaded.url],
        requestedSpecs: [
          { kind: "type", labelRu: "Тип" },
          { kind: "color", labelRu: "Цвет" },
          { kind: "material", labelRu: "Материал" },
        ],
      });
      assert.match(result.suggestions.color ?? "", /син|blue|көк/i);
      return result;
    });
    await run("baam-photo-understanding", async () => {
      const c = await createBaamConversation(ctx, { locale: "ru", storeId: fixture.storeId });
      const attachment = await prisma.baamAttachment.create({
        data: {
          conversationId: c.id,
          contentHash: randomUUID(),
          url: uploaded.url,
          name: "Synthetic QA shirt",
          mimeType: "image/png",
        },
      });
      const a = await sendBaamMessage(ctx, {
        text: "Что изображено на фотографии? Прочитай надпись и укажи цвет. Ничего не создавай.",
        locale: "ru",
        conversationId: c.id,
        clientRequestId: randomUUID(),
        revision: 0,
        attachmentIds: [attachment.id],
      });
      assert.equal(a.status, "COMPLETED");
      const answer = a.data.messages.at(-1)?.text ?? "";
      assert.match(answer, /BAZAAR/i);
      assert.equal(a.data.workflows.length, 0);
      return { answer };
    });
    const { transcribeBaamAudio } = await import("../../src/server/services/baamAudio");
    for (const locale of ["ru", "en", "kg"])
      await run(`voice-${locale}`, async () => {
        const c = await createBaamConversation(ctx, { locale: locale as "ru" | "en" | "kg" });
        const audio = await readFile(`artifacts/baam-companion/voice/${locale}-0.wav`);
        const a = await transcribeBaamAudio(ctx, c.id, audio, "audio/wav", locale);
        assert(a.text?.trim());
        return { text: a.text, needsReview: a.needsReview };
      });
    const studio = await import("../../src/server/services/productImageStudio");
    await run("photo-studio-real-edit", async () => {
      const a = await studio.createProductImageStudioJob({
        organizationId: fixture.organizationId,
        actorId: user.id,
        requestId: randomUUID(),
        sourceImageUrl: uploaded.url,
        backgroundMode: "WHITE",
        outputFormat: "SQUARE",
        centered: true,
        improveVisibility: true,
        softShadow: true,
      });
      await studio.runProductImageStudioJob({ jobId: a.jobId });
      const job = await studio.getProductImageStudioJob(fixture.organizationId, a.jobId);
      assert.equal(job.status, "SUCCEEDED", job.errorMessage ?? "image failed");
      return { jobId: a.jobId, outputImageUrl: job.outputImageUrl };
    });
  }
} finally {
  await prisma.$disconnect();
  console.log(
    JSON.stringify({ passed: results.filter((r) => r.pass).length, total: results.length }),
  );
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
