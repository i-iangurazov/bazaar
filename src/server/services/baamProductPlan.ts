import { z } from "zod";

export const productActions = ["search", "details", "performance", "ranking", "zero_sales"] as const;
export const productPlanSchema = z.object({
  intent: z.literal("products"),
  productAction: z.enum(productActions),
  query: z.string().trim().min(1).max(160).nullable(),
  direction: z.enum(["top", "bottom"]).nullable(),
  metric: z.enum(["revenue", "units"]).nullable(),
  limit: z.number().int().min(1).max(10),
}).strict();
export type BaamProductPlan = z.infer<typeof productPlanSchema>;
export const productPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["products"] },
    productAction: { type: "string", enum: [...productActions] },
    query: { type: ["string", "null"], minLength: 1, maxLength: 160 },
    direction: { type: ["string", "null"], enum: ["top", "bottom", null] },
    metric: { type: ["string", "null"], enum: ["revenue", "units", null] },
    limit: { type: "integer", minimum: 1, maximum: 10 },
  },
  required: ["intent", "productAction", "query", "direction", "metric", "limit"],
} as const;

const plan = (value: Partial<BaamProductPlan>): BaamProductPlan => ({
  intent: "products", productAction: "search", query: null, direction: null, metric: null, limit: 5,
  ...value,
});

// Only obvious read requests use the local path. Unknown/causal/mutation wording
// is left to the shared planner; this parser never supplies facts or product IDs.
export const parseLocalBaamProductPlan = (question: string, pageProductId?: string): BaamProductPlan | null => {
  const text = question.trim().replace(/[?!.]+$/u, "").trim();
  if (!text || /\b(why|forecast|predict|profit|delete|edit|create|archive|restore|never|ever|lifetime|all[ -]time)\b|почему|причин|прогноз|прибыл|удал|измени|создай|никогда|за всё время|за все время|эмне үчүн|себеп|божомол|пайда|өчүр|өзгөрт|эч качан|бардык убакыт/iu.test(text)) return null;
  if (pageProductId && /^(?:how (?:much|many(?: units)?) (?:did (?:it|this product) sell|(?:has it|have we) sold)|what are (?:its|this product's) returns|(?:show|summarize) (?:its|this product's) (?:sales|returns)|(?:а\s+)?сколько (?:его|этого товара) (?:продали|продано)|сколько продали этого товара|(?:а\s+)?какие у него возвраты|покажи (?:его продажи|его возвраты|продажи этого товара)|(?:бул товардан|андан) канча сатылды|канча даана сатылды|анын кайтаруулары (?:кандай|канча))$/iu.test(text)) {
    return plan({ productAction: "performance" });
  }
  const limitMatch = text.match(/(?:\btop\s*|\bfirst\s*|топ\s*|первые\s*|биринчи\s*)(\d{1,2})\b/iu);
  const limit = limitMatch ? Math.min(10, Math.max(1, Number(limitMatch[1]))) : 5;
  if (/\b(zero[ -]sales|no sales|unsold|not sold)\b|без продаж|не прода(?:вались|ются|лся)|нулев.*продаж|сатылбаган|сатылбай|сатылган жок/iu.test(text)) {
    return plan({ productAction: "zero_sales", limit });
  }
  const productWord = /\b(products?|items?|sellers?|selling|bestsellers?)\b|товар|продаваем|сатылган|сатылуучу|товарлар/iu.test(text);
  const top = /\b(top|best|bestsellers?|most sold)\b|лучше|лучшие|популяр|топ|эң көп/iu.test(text);
  const bottom = /\b(bottom|lowest|worst|least|slow[ -]moving)\b|худше|хуже|меньше всего|наименее|эң аз/iu.test(text);
  if (productWord && (top || bottom)) {
    return plan({ productAction: "ranking", direction: bottom ? "bottom" : "top", metric: /\b(units?|quantity|quantities|pieces)\b|количеств|штук|саны|даана/iu.test(text) ? "units" : "revenue", limit });
  }
  if (pageProductId && /^(?:tell me about (?:this|the) product|(?:show )?(?:this|the) product(?: details)?|расскажи (?:мне )?об этом товаре|об этом товаре|этот товар|бул товар(?: жөнүндө(?: айтып бер)?)?)$/iu.test(text)) {
    return plan({ productAction: "details" });
  }
  const lookup = text.match(/^(?:(?:find|search|look up|show)(?: me)?\s+(?:products?|items?)(?:\s+(?:named|called|matching|for))?|(?:найди|покажи|поиск)\s+товар(?:ы|ов|а)?|(?:товар(?:ды|ларды)?\s+тап))\s*[:—-]?\s+(.+)$/iu);
  if (lookup) {
    const query = lookup[1].replace(/^["«“']|["»”']$/gu, "").trim();
    if (query.length > 0 && query.length <= 160) return plan({ productAction: "search", query, limit });
  }
  if (/^(?:show (?:me )?(?:the )?products|list products|products|покажи товары|список товаров|товары|товарларды көрсөт|товарлар)$/iu.test(text)) return plan({ limit });
  return null;
};
