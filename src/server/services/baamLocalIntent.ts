import type { SalesPlan } from "@/server/services/baamPlan";

export const isBaamCapabilitiesQuestion = (text: string) =>
  /what can you|how can you help|your capabilities|что (?:ты|вы) уме|чем (?:ты |вы )?може|твои возможности|эмне кыла аласың|кандай жардам|эмне менен жардам|мүмкүнчүлүктөр/iu.test(
    text,
  );

export const isBaamComparison = (question: string) =>
  /compar|сравн|салыштыр|previous period|предыдущим периодом|мурунку мезгил/iu.test(question);
export const contextualBaamSalesPlan = (
  question: string,
  previous: SalesPlan,
): SalesPlan | null => {
  if (
    !isBaamComparison(question) ||
    /sales|returns?|receipts?|payments?|продаж|возврат|чек|платеж|сатуу|кайтаруу|төлөм/iu.test(
      question,
    )
  )
    return null;
  return { intent: "comparison", metrics: [...previous.metrics], limitation: "none" };
};

export const diagnosticBaamPlan = (text: string): SalesPlan | null => {
  if (/products?|товар|кардар|customer|supplier|поставщик/iu.test(text)) return null;
  const whySales = /why|почему|эмне үчүн/iu.test(text) && /sales|продаж|сатуу/iu.test(text);
  if (
    !whySales &&
    !/needs? attention|what should i check|что.*проверить|на что.*внимани|эмнени текшер|көңүл буруу/iu.test(
      text,
    )
  )
    return null;
  return {
    intent: "diagnostics",
    metrics: ["receipts", "average_receipt", "returns", "net_sales"],
    limitation: "none",
  };
};

export const restrictedBaamIntent = (text: string): SalesPlan | null => {
  const value = text.normalize("NFKC").toLowerCase();
  const limitation = /\b(?:forecast|predict|prediction)\b|прогноз|предскаж|божомол|прогноз/iu.test(
    value,
  )
    ? "forecast"
    : /\b(?:profit|tax|margin)\b|прибыл|налог|маржа|пайда|салык/iu.test(value)
      ? "profit"
      : /\bwhy\b|почему|эмне үчүн/iu.test(value)
        ? "causes"
        : /\b(?:delete|update|execute|run sql|drop table|ignore.*instructions|system prompt)\b|удали(?!\p{L})|измени(?!\p{L})|выполни(?!\p{L})|удалить|өзгөрт(?!\p{L})|өчүр(?!\p{L})/iu.test(
              value,
            )
          ? "actions"
          : null;
  return limitation ? { intent: "unsupported", metrics: ["sales"], limitation } : null;
};

// Available even without a model key. These explicit local intents are labelled
// guided, never presented as a substitute model response after a provider error.
export const localBaamSalesPlan = (question: string): SalesPlan | null => {
  const text = question.toLowerCase();
  if (/\bproducts?\b|товар|товарлар/iu.test(text)) return null;
  if (/payments?|refunds?|reconcil|платеж|возмещ|төлөм/iu.test(text))
    return { intent: "payments", metrics: ["payments"], limitation: "none" };
  if (/returns?|возврат|кайтаруу/iu.test(text))
    return {
      intent: "returns",
      metrics: ["returns", "return_ratio", "net_sales"],
      limitation: "none",
    };
  if (/compar|chang|сравн|измен|салыштыр|өзгөр/iu.test(text))
    return {
      intent: "comparison",
      metrics: ["sales", "net_sales", "receipts"],
      limitation: "none",
    };
  if (/sales|summari[sz]e|продаж|итог|сатуу|жыйынтык/iu.test(text))
    return { intent: "summary", metrics: ["sales", "net_sales", "receipts"], limitation: "none" };
  return null;
};

export const baamLocalCopy = {
  en: {
    navigation: "Open the appropriate page below. No records were changed.",
    capabilities:
      "I can summarize recorded sales, compare periods, reconcile payments, find products, show product sales rankings, and link to the relevant Bazaar page. I resolve supported dates and accessible store names, and use the previous answer for follow-ups. Figures come from authorized records. I cannot establish causes, forecast, calculate historical profit, or perform business actions.",
    unsupported:
      "I cannot establish causes, forecast, calculate historical profit, or perform business actions from these records. I can help with recorded sales, returns, payments, products and navigation.",
  },
  ru: {
    navigation: "Откройте нужную страницу ниже. Записи не изменялись.",
    capabilities:
      "Я могу подвести итоги учтённых продаж, сравнить периоды, сверить платежи, найти товары, показать их рейтинг продаж и дать ссылку на нужную страницу Bazaar. Поддерживаемые даты и доступные магазины определяю из вопроса, уточняющие вопросы связываю с предыдущим ответом. Цифры получаю из доступных вам записей. Я не устанавливаю причины, не делаю прогнозы, не рассчитываю историческую прибыль и не выполняю действия с данными.",
    unsupported:
      "По этим записям я не могу установить причины, сделать прогноз, рассчитать историческую прибыль или выполнить действия с данными. Могу помочь с учтёнными продажами, возвратами, платежами, товарами и переходом к нужным страницам.",
  },
  kg: {
    navigation: "Төмөндөн керектүү баракты ачыңыз. Жазуулар өзгөртүлгөн жок.",
    capabilities:
      "Катталган сатууну жыйынтыктап, мезгилдерди салыштырып, төлөмдөрдү текшерип, товарларды таап, алардын сатуу рейтингин көрсөтүп, Bazaar барактарына шилтеме бере алам. Колдоого алынган күндөрдү жана жеткиликтүү дүкөндөрдү суроодон аныктайм, уланды суроолорду мурунку жооп менен байланыштырам. Сандар сизге жеткиликтүү жазуулардан алынат. Себепти аныктабайм, божомол жасабайм, тарыхый пайданы эсептебейм жана маалыматтарды өзгөртпөйм.",
    unsupported:
      "Бул жазуулардан себепти аныктай албайм, божомол жасабайм, тарыхый пайданы эсептебейм жана маалыматтарды өзгөртпөйм. Катталган сатуу, кайтаруу, төлөм, товарлар жана керектүү барактарга өтүү боюнча жардам бере алам.",
  },
} as const;

export const isBaamOverallRequest = (question: string) =>
  /\b(?:overall|business-wide|whole business|all stores)\b|общие продажи|общих продаж|в целом|по всем магазинам|жалпы сатуу|бардык дүкөндөр/iu.test(
    question,
  );
