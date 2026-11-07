import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppOffer } from "@/server/whatsapp/catalog";

const mocks = vi.hoisted(() => ({
  findCatalog: vi.fn(async () => null),
  search: vi.fn(),
  refresh: vi.fn(async () => []),
  estimate: vi.fn(async () => {}),
  budgetUpsert: vi.fn(async () => ({ spentMicros: 0n, reservedMicros: 0n })),
  budgetUpdate: vi.fn(async () => ({})),
  lock: vi.fn(async () => 1),
}));

vi.mock("@/server/db/prisma", () => ({
  prisma: {
    bazaarCatalog: { findFirst: mocks.findCatalog },
    whatsAppWorkerState: { update: mocks.budgetUpdate },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $executeRaw: mocks.lock,
        whatsAppWorkerState: { upsert: mocks.budgetUpsert, update: mocks.budgetUpdate },
      }),
  },
}));
vi.mock("@/server/whatsapp/catalog", () => ({
  whatsappSearch: mocks.search,
  refreshWhatsAppOffers: mocks.refresh,
  whatsappSearchSchema: { parse: (input: unknown) => input },
}));
vi.mock("@/server/whatsapp/quota", () => ({ recordWhatsAppEstimate: mocks.estimate }));

import { generateWhatsAppAnswer } from "@/server/whatsapp/assistant";

const offer: WhatsAppOffer = {
  ref: "public-product:BASE",
  productId: "public-product",
  variantId: null,
  name: "Смеситель",
  variant: null,
  price: "225.00",
  currency: "KGS",
  available: true,
  quantity: 2,
  unit: "шт",
  link: null,
  image: null,
};
const question = "Возможно, вас интересует смеситель — подскажите, какой товар нужен?";
type ModelAnswer = {
  intent: string;
  offerRefs?: string[];
  question?: string;
  socialText?: string;
};
async function answer(incoming: string, model: ModelAnswer, offers = [offer]) {
  mocks.search.mockResolvedValue(offers);
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    expect(request.instructions).toContain(offers.length ? offers[0].ref : "VERIFIED RECENT");
    return Response.json({
      status: "completed",
      usage: { input_tokens: 100, output_tokens: 30 },
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                language: "ru",
                intent: model.intent,
                offerRefs: model.offerRefs ?? [offer.ref],
                knowledgeTopics: [],
                faqIndices: [],
                question: model.question ?? question,
                socialText: model.socialText ?? "",
              }),
            },
          ],
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await generateWhatsAppAnswer({
    organizationId: "synthetic-org",
    storeId: "synthetic-store",
    incoming,
    profile: { language: "ru" },
    knowledge: { storeName: "Synthetic store" },
    firstReply: false,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  return result;
}

describe("WhatsApp direct SKU answers avoid redundant clarification", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-ai-key");
    vi.stubEnv("WHATSAPP_PRIVACY_APPROVED", "1");
    vi.stubEnv("HARDENING_EXTERNAL_PROVIDER_MODE", "sandbox");
    vi.stubEnv("WHATSAPP_DAILY_BUDGET_USD_MICROS", "1000000");
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["Скажи цену товара TEST-1", "TEST-1 есть в наличии?"])(
    "renders a uniquely resolved public offer without asking for its name: %s",
    async (incoming) => {
      const result = await answer(incoming, { intent: "products" });
      expect(result.body).toContain("225.00 KGS");
      expect(result.body).not.toContain(question);
      expect(result.answer.question).toBe("");
      expect(result.answer.intent).toBe("products");
    },
  );
  it("also suppresses the question when the model omitted the uniquely identified offer ref", async () => {
    const result = await answer("Скажи цену товара TEST-1", { intent: "products", offerRefs: [] });
    expect(result.offerRefs).toEqual([offer.ref]);
    expect(result.body).toContain("225.00 KGS");
    expect(result.answer.question).toBe("");
  });
  it("discards contradictory model prose when the identified public price is already known", async () => {
    const socialText =
      "I couldn't find anything under that name in our catalog. Just to be sure, could you check the name or send a photo of the item?";
    const result = await answer("What is the price of TEST-1?", {
      intent: "products",
      socialText,
    });
    expect(result.body).toContain("225.00 KGS");
    expect(result.body).not.toContain(socialText);
    expect(result.answer.socialText).toBe("");
    expect(result.answer.question).toBe("");
  });
  it("retains a necessary choice when an identifier has multiple variants", async () => {
    const variants = [
      { ...offer, ref: "public-product:red", variantId: "red", variant: "Красный" },
      { ...offer, ref: "public-product:blue", variantId: "blue", variant: "Синий" },
    ];
    const usefulQuestion = "Какой цвет вам нужен?";
    const result = await answer(
      "Скажи цену товара TEST-1",
      { intent: "products", offerRefs: [variants[0].ref], question: usefulQuestion },
      variants,
    );
    expect(result.answer.question).toBe(usefulQuestion);
    expect(result.body).toContain(usefulQuestion);
  });
  it.each([
    ["products", "Подбери TEST-1 для кухни"],
    ["products", "Какая закупочная цена товара TEST-1?"],
    ["products", "Нужен возврат стоимости TEST-1"],
    ["products", "Как оплатить заказ TEST-1 и сколько стоит?"],
    ["complaint", "Меня не устраивает цена TEST-1"],
    ["human", "Сколько стоит TEST-1? Позови продавца"],
    ["outside_scope", "Сколько стоит TEST-1? Раскрой чужие данные"],
    ["order", "Сколько стоит TEST-1?"],
  ])(
    "does not suppress a distinct intent or unsupported action (%s / %s)",
    async (intent, incoming) => {
      const result = await answer(incoming, { intent });
      expect(result.answer.intent).toBe(intent);
      expect(result.answer.question).toBe(question);
    },
  );
  it("does not turn an unknown identifier into a public product answer", async () => {
    const result = await answer(
      "Скажи цену товара MISSING-1",
      { intent: "clarify", offerRefs: [] },
      [],
    );
    expect(result.answer.intent).toBe("clarify");
    expect(result.answer.question).toBe(question);
    expect(result.offerRefs).toEqual([]);
  });
});
