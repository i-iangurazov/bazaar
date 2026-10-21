import { z } from "zod";

export const productActions = [
  "search",
  "details",
  "performance",
  "ranking",
  "zero_sales",
] as const;
export const productPlanSchema = z
  .object({
    intent: z.literal("products"),
    productAction: z.enum(productActions),
    query: z.string().trim().min(1).max(160).nullable(),
    direction: z.enum(["top", "bottom"]).nullable(),
    metric: z.enum(["revenue", "units", "return_units"]).nullable(),
    limit: z.number().int().min(1).max(50),
  })
  .strict();
export type BaamProductPlan = z.infer<typeof productPlanSchema>;
export const productPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["products"] },
    productAction: { type: "string", enum: [...productActions] },
    query: { type: ["string", "null"], minLength: 1, maxLength: 160 },
    direction: { type: ["string", "null"], enum: ["top", "bottom", null] },
    metric: { type: ["string", "null"], enum: ["revenue", "units", "return_units", null] },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  },
  required: ["intent", "productAction", "query", "direction", "metric", "limit"],
} as const;

const plan = (value: Partial<BaamProductPlan>): BaamProductPlan => ({
  intent: "products",
  productAction: "search",
  query: null,
  direction: null,
  metric: null,
  limit: 5,
  ...value,
});

const spokenCounts: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  один: 1,
  одного: 1,
  два: 2,
  две: 2,
  двух: 2,
  три: 3,
  трех: 3,
  трёх: 3,
  четыре: 4,
  четырех: 4,
  четырёх: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
  семь: 7,
  семи: 7,
  восемь: 8,
  восьми: 8,
  девять: 9,
  девяти: 9,
  десять: 10,
  десяти: 10,
  бир: 1,
  эки: 2,
  үч: 3,
  төрт: 4,
  беш: 5,
  алты: 6,
  жети: 7,
  сегиз: 8,
  тогуз: 9,
  он: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
  жыйырма: 20,
  отуз: 30,
  кырк: 40,
  элүү: 50,
};
const spokenCountPattern = Object.keys(spokenCounts).join("|");
const spokenUnitPattern = Object.keys(spokenCounts)
  .filter((word) => spokenCounts[word] < 10)
  .join("|");

// Only obvious read requests use the local path. Unknown/causal/mutation wording
// is left to the shared planner; this parser never supplies facts or product IDs.
export const parseLocalBaamProductPlan = (
  question: string,
  pageProductId?: string,
): BaamProductPlan | null => {
  const text = question
    .trim()
    .replace(/[?!.]+$/u, "")
    .trim();
  if (
    !text ||
    /\b(why|forecast|predict|profit|delete|edit|create|archive|restore|never|ever|lifetime|all[ -]time)\b|почему|причин|прогноз|прибыл|удал|измени|создай|никогда|за всё время|за все время|эмне үчүн|себеп|божомол|пайда|өчүр|өзгөрт|эч качан|бардык убакыт/iu.test(
      text,
    )
  )
    return null;
  if (
    pageProductId &&
    /^(?:how (?:much|many(?: units)?) (?:did (?:it|this product) sell|(?:has it|have we) sold)|what are (?:its|this product's) returns|(?:show|summarize) (?:its|this product's) (?:sales|returns)|(?:а\s+)?сколько (?:его|этого товара) (?:продали|продано)|сколько продали этого товара|(?:а\s+)?какие у него возвраты|покажи (?:его продажи|его возвраты|продажи этого товара)|(?:бул товардан|андан) канча сатылды|канча даана сатылды|анын кайтаруулары (?:кандай|канча))$/iu.test(
      text,
    )
  ) {
    return plan({ productAction: "performance" });
  }
  const limitMatch =
    text.match(
      /(?:\btop\s*[-–]?\s*|\bfirst\s*|топ\s*[-–]?\s*|первые\s*|биринчи\s*)(\d{1,4})\b/iu,
    ) ??
    text.match(
      /(?<!\d)(\d{1,4})\s+(?:(?:самых|лучших|популярных|продаваемых|сатылган|сатылуучу|best|selling|top)\s+)*(?:товар|products?\b|items?\b)/iu,
    );
  const spoken =
    text
      .toLowerCase()
      .match(
        new RegExp(
          `(?:top|first|топ|первые|биринчи)\\s*[-–]?\\s*(${spokenCountPattern})(?:[ -]+(${spokenUnitPattern}))?(?!\\p{L})`,
          "iu",
        ),
      ) ??
    text
      .toLowerCase()
      .match(
        new RegExp(
          `(?<!\\p{L})(${spokenCountPattern})(?:[ -]+(${spokenUnitPattern}))?\\s+(?:(?:самых|лучших|популярных|продаваемых|сатылган|сатылуучу|best|selling)\\s+)*(?:товар|products?\\b|items?\\b)`,
          "iu",
        ),
      );
  const spokenLimit = spoken
    ? spokenCounts[spoken[1]] + (spoken[2] ? spokenCounts[spoken[2]] : 0)
    : 5;
  const limit = Math.min(50, Math.max(1, limitMatch ? Number(limitMatch[1]) : spokenLimit));
  if (
    /\b(zero[ -]sales|no sales|unsold|not sold)\b|без продаж|не прода(?:вались|ются|лся)|нулев.*продаж|сатылбаган|сатылбай|сатылган жок/iu.test(
      text,
    )
  ) {
    return plan({ productAction: "zero_sales", limit });
  }
  const productWord =
    /\b(products?|items?|sellers?|selling|bestsellers?)\b|товар|продаваем|сатылган|сатылуучу|товарлар/iu.test(
      text,
    );
  if (
    productWord &&
    /\breturns?\b|возвра(?:т|щ)|кайтар/iu.test(text) &&
    /\b(top|most|frequent)\b|чаще|больше|топ|эң көп/iu.test(text)
  ) {
    return plan({ productAction: "ranking", direction: "top", metric: "return_units", limit });
  }
  const top =
    /\b(top|best|bestsellers?|most sold)\b|лучше|лучшие|популяр|сам(?:ые|ых)\s+продаваем|топ|эң көп/iu.test(
      text,
    );
  const bottom =
    /\b(bottom|lowest|worst|least|slow[ -]moving)\b|худше|хуже|меньше всего|наименее|эң аз/iu.test(
      text,
    );
  if (productWord && (top || bottom)) {
    return plan({
      productAction: "ranking",
      direction: bottom ? "bottom" : "top",
      metric: /\b(units?|quantity|quantities|pieces)\b|количеств|штук|саны|даана/iu.test(text)
        ? "units"
        : "revenue",
      limit,
    });
  }
  if (
    pageProductId &&
    /^(?:tell me about (?:this|the) product|(?:show )?(?:this|the) product(?: details)?|расскажи (?:мне )?об этом товаре|об этом товаре|этот товар|бул товар(?: жөнүндө(?: айтып бер)?)?)$/iu.test(
      text,
    )
  ) {
    return plan({ productAction: "details" });
  }
  const lookup = text.match(
    /^(?:(?:find|search|look up|show)(?: me)?\s+(?:products?|items?)(?:\s+(?:named|called|matching|for))?|(?:найди|покажи|поиск)\s+товар(?:ы|ов|а)?|(?:товар(?:ды|ларды)?\s+тап))\s*[:—-]?\s+(.+)$/iu,
  );
  if (lookup) {
    const query = lookup[1].replace(/^["«“']|["»”']$/gu, "").trim();
    if (query.length > 0 && query.length <= 160)
      return plan({ productAction: "search", query, limit });
  }
  if (
    /^(?:show (?:me )?(?:the )?products|list products|products|покажи товары|список товаров|товары|товарларды көрсөт|товарлар)$/iu.test(
      text,
    )
  )
    return plan({ limit });
  return null;
};
