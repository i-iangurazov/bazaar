// Opt-in, real-provider acceptance of complete user flows in the owned local
// synthetic organization. This is deliberately separate from automated CI.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
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
const directory = "artifacts/baam-companion/read-quality";
assert.equal(await prisma.organization.count(), 1, "Only the synthetic QA tenant may exist");
for (const product of await prisma.product.findMany({ select: { name: true } }))
  assert(
    /^(AI QA Tea \d+|QA |Test Product|Голосовой чай)/u.test(product.name),
    "Non-fixture product: abort external acceptance",
  );
for (const customer of await prisma.customer.findMany({ select: { name: true } }))
  assert(
    /^(UI QA \d+|Айбек Голосовой)$/u.test(customer.name),
    "Non-fixture customer: abort external acceptance",
  );
for (const supplier of await prisma.supplier.findMany({ select: { name: true } }))
  assert(
    /^(Test Supplier|DeepSeek QA \d+|Голосовой поставщик)$/u.test(supplier.name),
    "Non-fixture supplier: abort external acceptance",
  );
await mkdir(directory, { recursive: true });
type Case = {
  page?: string;
  id: string;
  text: string;
  datasets: string[];
  exact?: number;
  format?: string;
  locale?: "ru" | "en" | "kg";
  chain?: string;
  contains?: string;
  absent?: string;
};
const cases: Case[] = [
  {
    id: "repro-top7",
    chain: "repro",
    text: "Покажи топ-7 товаров за месяц",
    datasets: ["products"],
    exact: 7,
  },
  {
    id: "repro-unsold",
    chain: "repro",
    text: "Какие товары не продавались в этом периоде?",
    datasets: ["products"],
  },
  {
    id: "repro-top12",
    chain: "repro",
    text: "Покажи топ-12 товаров за месяц",
    datasets: ["products"],
    exact: 8,
    absent: "Голосовой чай",
  },
  {
    id: "repro-overview",
    chain: "repro",
    text: "А что у нас вообще происходит в магазине, не подскажешь, пожалуйста?",
    datasets: ["sales_metrics", "inventory", "customers"],
  },
  {
    id: "repro-latest-sale",
    chain: "repro",
    text: "Привет, а не подскажешь ли ты мне последнюю продажу в нашей кассе?",
    datasets: ["sales"],
    exact: 1,
    contains: "S-000001",
    absent: "S-000007",
  },
  {
    id: "repro-latest-receipt",
    chain: "repro",
    text: "Так, а какое у нас было последнее оприходование?",
    datasets: ["stock_movements"],
  },
  {
    id: "repro-new-customers",
    chain: "repro",
    text: "А есть ли у нас какие-то новые клиенты, может быть?",
    datasets: ["customers"],
  },
  {
    id: "table-start",
    chain: "format",
    text: "Дай пять самых продаваемых товаров текущего месяца",
    datasets: ["products"],
    exact: 5,
  },
  {
    id: "table-followup",
    chain: "format",
    text: "Теперь покажи это таблицей со ссылками на товары",
    datasets: ["products"],
    exact: 5,
    format: "table",
  },
  {
    id: "short-followup",
    chain: "format",
    text: "А теперь объясни этот результат коротко, двумя предложениями",
    datasets: ["products"],
    format: "short",
  },
  {
    id: "list-explicit",
    text: "Списком покажи три последние завершённые продажи, если их меньше — покажи сколько есть",
    datasets: ["sales"],
    format: "list",
    exact: 1,
  },
  { id: "today", text: "Что у нас с выручкой сегодня?", datasets: ["sales_metrics"] },
  { id: "yesterday", text: "Были ли вчера продажи и возвраты?", datasets: ["sales_metrics"] },
  {
    id: "payments",
    text: "Сколько получили наличными и сколько по карте за этот месяц?",
    datasets: ["sales_metrics"],
  },
  {
    id: "daily",
    text: "Разложи чистую выручку и число чеков по дням за последние семь дней, в таблице",
    datasets: ["sales_metrics"],
    format: "table",
  },
  {
    id: "compare",
    text: "Сравни продажи этой недели с предыдущим таким же периодом",
    datasets: ["sales_metrics"],
  },
  {
    id: "diagnose",
    text: "Почему у нас изменились продажи, что мне стоит проверить первым делом?",
    datasets: ["sales_metrics"],
  },
  {
    id: "discounts",
    text: "Какие суммы скидок и возвратов у нас за месяц?",
    datasets: ["sales_metrics"],
  },
  {
    id: "top50",
    text: "Хочу топ-50 товаров по продажам за месяц",
    datasets: ["products"],
    exact: 8,
  },
  {
    id: "units-top6",
    text: "Шесть товаров, которые купили больше всего по количеству, за этот месяц",
    datasets: ["products"],
    exact: 6,
  },
  {
    id: "bottom",
    text: "Что продаётся хуже всего в этом месяце? Покажи десять товаров",
    datasets: ["products"],
  },
  {
    id: "zero-table",
    text: "Все товары без продаж в этом месяце, с артикулами, таблицей",
    datasets: ["products"],
    format: "table",
  },
  {
    id: "product-performance",
    text: "Сколько штук AI-QA-3 продали за октябрь 2026 и на какую сумму?",
    datasets: ["products"],
    exact: 1,
  },
  {
    id: "stock-product",
    text: "Какой сейчас остаток у AI-QA-3, по каждому магазину отдельно?",
    datasets: ["inventory"],
  },
  {
    id: "negative-stock",
    text: "Есть ли у нас товары с отрицательными остатками?",
    datasets: ["inventory"],
  },
  {
    id: "empty-stock",
    text: "Покажи товары, которых сейчас ровно ноль на руках",
    datasets: ["inventory"],
  },
  {
    id: "threshold",
    text: "Каких товаров осталось не больше трёх штук? Покажи остатки",
    datasets: ["inventory"],
  },
  {
    id: "stock-receipts",
    text: "Какие последние десять оприходований были у нас?",
    datasets: ["stock_movements"],
  },
  { id: "writeoffs", text: "Были ли списания в этом месяце?", datasets: ["stock_movements"] },
  {
    id: "transfers",
    text: "Какие перемещения между магазинами были за неделю?",
    datasets: ["stock_movements"],
  },
  {
    id: "new-clients-week",
    text: "Кто из клиентов появился за последние семь дней?",
    datasets: ["customers"],
  },
  {
    id: "latest-customer",
    text: "Покажи самого последнего добавленного клиента и дату регистрации",
    datasets: ["customers"],
    exact: 1,
  },
  { id: "suppliers", text: "Какие у нас есть поставщики?", datasets: ["suppliers"] },
  {
    id: "latest-purchase",
    text: "Последний заказ поставщику — какой у него статус?",
    datasets: ["purchases"],
  },
  {
    id: "counts",
    text: "Какая последняя инвентаризация и применена ли она?",
    datasets: ["stock_counts"],
  },
  {
    id: "draft-sales",
    text: "Покажи неоплаченные отложенные чеки в кассе",
    datasets: ["sales"],
    contains: "S-000007",
    absent: "S-000001",
  },
  {
    id: "latest-return",
    text: "Когда у нас был последний возврат? Если нет, так и скажи",
    datasets: ["returns"],
    exact: 0,
  },
  { id: "stores", text: "Какие магазины мне доступны?", datasets: ["stores"] },
  {
    id: "mixed-request",
    text: "Кратко: выручка за сегодня, последний чек и есть ли минусовые остатки",
    datasets: ["sales_metrics", "sales", "inventory"],
    format: "short",
  },
  {
    id: "english-overview",
    text: "What is going on in my business this month? What needs attention?",
    datasets: ["sales_metrics", "inventory"],
    locale: "en",
  },
  {
    id: "english-receipt",
    text: "Show my most recent completed checkout receipt and its amount",
    datasets: ["sales"],
    exact: 1,
    locale: "en",
  },
  {
    id: "kyrgyz-overview",
    text: "Ушул айда дүкөндө эмне болуп жатат? Сатуу жана калдыктар жөнүндө айтып бер",
    datasets: ["sales_metrics", "inventory"],
    locale: "kg",
  },
  {
    id: "kyrgyz-new",
    text: "Бул аптада кошулган жаңы кардарларды көрсөт",
    datasets: ["customers"],
    locale: "kg",
  },
  {
    id: "kyrgyz-receipt",
    text: "Товарларды акыркы жолу качан кабыл алдык?",
    datasets: ["stock_movements"],
    locale: "kg",
  },
  {
    id: "quoted-product",
    text: "Найди товар с артикулом AI-QA-3 и покажи ссылку",
    datasets: ["products"],
    exact: 1,
  },
  {
    id: "unknown-product",
    text: "Есть ли в каталоге товар НЕСУЩЕСТВУЮЩИЙ-XX-999?",
    datasets: ["products"],
    exact: 0,
  },
  { id: "known-sale", text: "Найди чек S 000001", datasets: ["sales"], exact: 1 },
  {
    id: "store-switch",
    chain: "store",
    text: "Продажи за месяц в магазине Test Store",
    datasets: ["sales_metrics"],
  },
  {
    id: "store-followup",
    chain: "store",
    text: "А в Оше за тот же период?",
    datasets: ["sales_metrics"],
  },
  {
    id: "store-reset",
    chain: "store",
    text: "Покажи новых клиентов по всем доступным магазинам за этот месяц",
    datasets: ["customers"],
  },
  {
    id: "date-range",
    text: "Покажи продажи с 20 по 22 октября 2026 года",
    datasets: ["sales_metrics"],
  },
  {
    id: "date-english",
    text: "Show sales from October 20th to October 22nd, 2026",
    datasets: ["sales_metrics"],
    locale: "en",
  },
  { id: "date-empty", text: "Какие продажи были за июль 2026 года?", datasets: ["sales_metrics"] },
  {
    id: "returns-products",
    text: "Какие товары чаще всего возвращали за месяц?",
    datasets: ["products"],
    exact: 0,
  },
  {
    id: "customer-and-sale",
    text: "Покажи последнего добавленного клиента и последнюю завершённую продажу",
    datasets: ["customers", "sales"],
  },
  {
    id: "greeting-read",
    text: "Привет, дорогой, будь добр, расскажи пожалуйста сколько сегодня наторговали",
    datasets: ["sales_metrics"],
  },
  {
    id: "comparison-context-start",
    chain: "comparison",
    text: "Покажи продажи за эту неделю",
    datasets: ["sales_metrics"],
  },
  {
    id: "comparison-context-next",
    chain: "comparison",
    text: "А что изменилось относительно предыдущего периода?",
    datasets: ["sales_metrics"],
  },
  {
    id: "context-topic-reset",
    chain: "comparison",
    text: "Теперь другая тема: покажи последний приход товара",
    datasets: ["stock_movements"],
  },
  {
    id: "inventory-table",
    text: "Таблица с текущими остатками AI-QA-1 и названиями магазинов",
    datasets: ["inventory"],
    format: "table",
  },
];
cases.push(
  {
    id: "stock-spoken-sku",
    text: "Сколько сейчас на остатке у товара тест один?",
    datasets: ["inventory"],
    exact: 1,
    contains: "Test Product",
  },
  {
    id: "customer-orders-list",
    text: "Какие клиентские заказы у нас есть, кроме кассовых чеков?",
    datasets: ["orders"],
  },
  {
    id: "customer-order-latest",
    text: "Покажи последний заказ клиента и его статус",
    datasets: ["orders"],
  },
  {
    id: "customer-orders-drafts",
    text: "Покажи черновики клиентских заказов",
    datasets: ["orders"],
  },
  {
    id: "customer-email-details",
    text: "Покажи электронную почту клиента Айбек Голосовой",
    datasets: ["customers"],
    exact: 1,
    contains: "@example.invalid",
  },
  {
    id: "current-product-details",
    text: "Расскажи об этом товаре: артикул, цена, единица",
    datasets: ["products"],
    exact: 1,
    page: "/products/" + fixture.productId,
  },
);
const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
const reportName =
  process.argv.find((a) => a.startsWith("--report-name="))?.slice(14) ?? "run-" + Date.now();
assert(/^[a-zA-Z0-9_-]+$/.test(reportName));
const reportPath = directory + "/" + reportName + ".json";
console.log("Acceptance report: " + reportPath);
const sourceFiles = [
  "src/server/services/baamReadAgent.ts",
  "src/server/services/baamReadTools.ts",
  "src/server/services/baamWorkflowRecords.ts",
  "src/server/services/baamReadFollowup.ts",
  "src/server/services/baamQuestionScope.ts",
  "src/server/services/baamSpokenSku.ts",
  "src/server/services/baamReadData.ts",
  "src/server/services/baamReadPlan.ts",
  "src/server/services/baamCompanion.ts",
  "src/server/services/baamWorkflowIntent.ts",
  "src/server/services/baamProducts.ts",
  "src/server/services/aiProvider.ts",
  "src/components/use-baam-companion.ts",
  "src/components/baam-message-list.tsx",
  "src/components/baam-answer-text.tsx",
  "src/lib/baam/companion.ts",
  "src/lib/baam/recordStatus.ts",
  "src/lib/baam/copy.ts",
];
const sourceDigest = createHash("sha256");
for (const file of sourceFiles) sourceDigest.update(file).update(await readFile(file));
const sourceHash = sourceDigest.digest("hex");
const shard = process.argv
  .find((a) => a.startsWith("--shard="))
  ?.slice(8)
  .split("/")
  .map(Number);
const groupIndexes = new Map<string, number>();
for (const c of cases)
  if (!groupIndexes.has(c.chain ?? c.id)) groupIndexes.set(c.chain ?? c.id, groupIndexes.size);
if (shard) assert(shard.length === 2 && shard[0] >= 0 && shard[0] < shard[1] && shard[1] <= 4);
if (process.argv.includes("--capture-provider")) {
  const actualFetch = globalThis.fetch;
  let captureIndex = 0;
  globalThis.fetch = async (...args) => {
    const response = await actualFetch(...args);
    if (String(args[0]).startsWith("https://api.deepseek.com/")) {
      const body = await response
        .clone()
        .json()
        .catch(() => null);
      await writeFile(
        directory + "/" + reportName + "-provider-" + ++captureIndex + ".json",
        JSON.stringify(
          {
            status: response.status,
            calls: body?.output?.filter((item: { type?: string }) => item.type === "function_call"),
          },
          null,
          2,
        ),
      );
    }
    return response;
  };
}
const results: Array<Record<string, unknown>> = [];
const conversations = new Map<string, string>();
// A successful HTTP response or plausible prose is insufficient: verify what
// was actually queried, including the operation, metric and explicit scope.
const expectedReads: Record<string, Record<string, unknown>[]> = {
  "repro-top7": [{ dataset: "products", mode: "top", limit: 7 }],
  "repro-unsold": [{ dataset: "products", mode: "zero_sales" }],
  "repro-top12": [{ dataset: "products", mode: "top", limit: 12 }],
  "repro-latest-sale": [{ dataset: "sales", mode: "latest", limit: 1 }],
  "repro-latest-receipt": [{ dataset: "stock_movements", mode: "latest", movementType: "RECEIVE" }],
  "repro-new-customers": [{ dataset: "customers", mode: "new" }],
  "table-followup": [{ dataset: "products", mode: "top", limit: 5 }],
  "short-followup": [{ dataset: "products", mode: "top", limit: 5 }],
  "list-explicit": [{ dataset: "sales", mode: "list", limit: 3 }],
  daily: [{ dataset: "sales_metrics", mode: "daily" }],
  compare: [{ dataset: "sales_metrics", mode: "comparison" }],
  top50: [{ dataset: "products", mode: "top", limit: 50 }],
  "units-top6": [{ dataset: "products", mode: "top", limit: 6, metric: "units" }],
  bottom: [{ dataset: "products", mode: "bottom", limit: 10 }],
  "zero-table": [{ dataset: "products", mode: "zero_sales" }],
  "product-performance": [
    {
      dataset: "products",
      mode: "details",
      query: "AI-QA-3",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    },
  ],
  "negative-stock": [{ dataset: "inventory", mode: "negative_stock" }],
  "empty-stock": [{ dataset: "inventory", mode: "empty_stock" }],
  threshold: [{ dataset: "inventory", mode: "low_stock", stockThreshold: 3 }],
  "stock-receipts": [
    { dataset: "stock_movements", mode: "list", limit: 10, movementType: "RECEIVE" },
  ],
  writeoffs: [{ dataset: "stock_movements", movementType: "WRITE_OFF" }],
  transfers: [{ dataset: "stock_movements", movementType: "TRANSFER_IN" }],
  "new-clients-week": [{ dataset: "customers", mode: "new" }],
  "latest-customer": [{ dataset: "customers", mode: "latest", limit: 1 }],
  "latest-purchase": [{ dataset: "purchases", mode: "latest", limit: 1 }],
  counts: [{ dataset: "stock_counts", mode: "latest", limit: 1 }],
  "draft-sales": [{ dataset: "sales", mode: "drafts" }],
  "latest-return": [{ dataset: "returns", mode: "latest", limit: 1 }],
  "english-receipt": [{ dataset: "sales", mode: "latest", limit: 1 }],
  "kyrgyz-new": [{ dataset: "customers", mode: "new" }],
  "kyrgyz-receipt": [{ dataset: "stock_movements", mode: "latest", movementType: "RECEIVE" }],
  "store-followup": [{ dataset: "sales_metrics", store: "Ош" }],
  "store-reset": [{ dataset: "customers", mode: "new", store: "*" }],
  "date-range": [{ dataset: "sales_metrics", dateFrom: "2026-10-20", dateTo: "2026-10-22" }],
  "date-english": [{ dataset: "sales_metrics", dateFrom: "2026-10-20", dateTo: "2026-10-22" }],
  "date-empty": [{ dataset: "sales_metrics", dateFrom: "2026-07-01", dateTo: "2026-07-31" }],
  "returns-products": [{ dataset: "products", metric: "return_units" }],
  "customer-and-sale": [
    { dataset: "customers", mode: "latest" },
    { dataset: "sales", mode: "latest" },
  ],
  "comparison-context-next": [{ dataset: "sales_metrics", mode: "comparison" }],
  "context-topic-reset": [{ dataset: "stock_movements", mode: "latest", movementType: "RECEIVE" }],
  "customer-orders-list": [{ dataset: "orders", mode: "list" }],
  "customer-order-latest": [{ dataset: "orders", mode: "latest", limit: 1 }],
  "customer-orders-drafts": [{ dataset: "orders", mode: "drafts" }],
  "customer-email-details": [{ dataset: "customers", mode: "details" }],
  "current-product-details": [{ dataset: "products", mode: "catalog_details" }],
};
for (const c of cases.filter(
  (c) =>
    (!only || only.includes(c.id)) &&
    (!shard || groupIndexes.get(c.chain ?? c.id)! % shard[1] === shard[0]),
)) {
  const started = performance.now(),
    locale = c.locale ?? "ru";
  const conversationId =
    (c.chain && conversations.get(c.chain)) || (await createBaamConversation(ctx, { locale })).id;
  if (c.chain) conversations.set(c.chain, conversationId);
  let evidence: Record<string, unknown> = {};
  try {
    const result = await sendBaamMessage(ctx, {
      text: c.text,
      ...(c.page ? { page: { path: c.page } } : {}),
      locale,
      conversationId,
      clientRequestId: randomUUID(),
      revision: 0,
      attachmentIds: [],
    });
    const answer = result.data.messages.filter((m) => m.role === "assistant").at(-1)!;
    const parts = (answer?.parts ?? []) as Array<Record<string, any>>;
    const read = parts.find((p) => p.type === "readContext")?.plan,
      rows = parts.filter((p) => p.type === "record");
    evidence = { answer: answer?.text, plan: read, parts, last: result.data.messages.at(-1) };
    assert.equal(result.status, "COMPLETED", result.data.messages.at(-1)?.text);
    assert(read, "No data read was performed");
    assert.equal(
      parts.find((p) => p.type === "readContext")?.narration,
      "generated",
      "Fresh facts were retrieved, but an AI answer was not generated",
    );
    assert(!answer.text.includes("пояснение сформировать не удалось"), "Provider narration failed");
    assert(!answer.text.includes("{{F"), "Unresolved reference");
    for (const dataset of c.datasets)
      assert(
        read.requests.some((r: any) => r.dataset === dataset),
        "Missing dataset " + dataset,
      );
    for (const expected of expectedReads[c.id] ?? [])
      assert(
        read.requests.some((request: Record<string, unknown>) =>
          Object.entries(expected).every(([field, value]) => request[field] === value),
        ),
        "Wrong read semantics: expected " + JSON.stringify(expected),
      );
    if (c.format) assert.equal(read.format, c.format, "Requested presentation format was lost");
    if (c.exact != null) assert.equal(rows.length, c.exact, "Wrong record count");
    if (c.contains) assert(JSON.stringify(rows).includes(c.contains), "Missing expected record");
    if (c.absent) assert(!JSON.stringify(rows).includes(c.absent), "Unexpected record");
    if (c.format === "table")
      assert(
        /\|[^\n]+\|/.test(answer.text) && /\|\s*:?-{3,}/.test(answer.text),
        "No Markdown table",
      );
    if (c.format === "short")
      assert(answer.text.split(/\s+/).length <= 130, "Short answer too long");
    results.push({
      id: c.id,
      ok: true,
      question: c.text,
      ms: Math.round(performance.now() - started),
      ...evidence,
    });
    console.log("PASS " + c.id + " (" + Math.round(performance.now() - started) + " ms)");
  } catch (error) {
    results.push({
      id: c.id,
      ok: false,
      question: c.text,
      ms: Math.round(performance.now() - started),
      error: String(error),
      ...evidence,
    });
    console.error("FAIL " + c.id + ": " + String(error));
  }
  await writeFile(
    reportPath,
    JSON.stringify(
      { at: new Date().toISOString(), total: cases.length, sourceHash, sourceFiles, results },
      null,
      2,
    ),
  );
}
console.log(
  JSON.stringify({
    checked: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).map((r) => r.id),
  }),
);
await prisma.$disconnect();
process.exitCode = results.some((r) => !r.ok) ? 1 : 0;

process.exit(Number(process.exitCode ?? 0));
