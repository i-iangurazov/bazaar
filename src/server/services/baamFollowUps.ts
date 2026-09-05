type Locale = "en" | "ru" | "kg";
const questions = {
  en: {
    payments: "Do payments and refunds reconcile?",
    returns: "Compare returns with the previous period",
    changes: "What changed compared with the previous period?",
    top: "Which products sold the most?",
    bottom: "Which products sold the least?",
    zero: "Which products had no sales in this period?",
    scope: "Summarize sales for the last two months",
    diagnostics: "What needs attention in sales?",
    details: "Tell me about this product",
    performance: "How much did this product sell?",
    productReturns: "What are its returns?",
  },
  ru: {
    payments: "Сходятся ли платежи и возвраты?",
    returns: "Сравни возвраты с предыдущим периодом",
    changes: "Что изменилось по сравнению с предыдущим периодом?",
    top: "Какие товары продавались лучше всего?",
    bottom: "Какие товары продавались меньше всего?",
    zero: "Какие товары не продавались в этом периоде?",
    scope: "Подведи итоги продаж за последние два месяца",
    diagnostics: "Что нужно проверить в продажах?",
    details: "Расскажи об этом товаре",
    performance: "Сколько продали этого товара?",
    productReturns: "А какие у него возвраты?",
  },
  kg: {
    payments: "Төлөмдөр менен кайтаруулар дал келеби?",
    returns: "Кайтарууларды мурунку мезгил менен салыштыр",
    changes: "Мурунку мезгилге салыштырмалуу эмне өзгөрдү?",
    top: "Кайсы товарлар эң көп сатылган?",
    bottom: "Кайсы товарлар эң аз сатылган?",
    zero: "Бул мезгилде кайсы товарлар сатылган жок?",
    scope: "Акыркы эки айдагы сатууну жыйынтыкта",
    diagnostics: "Сатууда эмнени текшериш керек?",
    details: "Бул товар жөнүндө айтып бер",
    performance: "Бул товардан канча сатылды?",
    productReturns: "Анын кайтаруулары кандай?",
  },
} as const;
export const baamSalesFollowUps = (
  locale: Locale,
  input: {
    intent: string;
    receipts: number;
    returns: number;
    previousReturns: number;
    paymentMismatch: boolean;
  },
) => {
  const q = questions[locale];
  if (!input.receipts && !input.returns) return [q.scope, q.zero, q.payments];
  const next = [
    ...(input.paymentMismatch && input.intent !== "payments" ? [q.payments] : []),
    ...(input.returns > input.previousReturns && input.intent !== "returns" ? [q.returns] : []),
    ...(input.intent === "diagnostics" || input.intent === "comparison"
      ? [q.bottom, q.top]
      : [q.changes, q.diagnostics]),
    q.top,
  ];
  return [...new Set(next)].slice(0, 3);
};
export const baamProductFollowUps = (locale: Locale, single: boolean) => {
  const q = questions[locale];
  return single ? [q.performance, q.productReturns, q.details] : [q.top, q.bottom, q.zero];
};
export const baamDiagnosticNote = (locale: Locale) =>
  ({
    en: "These are observed changes in receipts, average receipt and returns, not proof of what caused the result. Check the linked records before drawing a conclusion.",
    ru: "Это наблюдаемые изменения количества чеков, среднего чека и возвратов, а не доказательство причин результата. Проверьте связанные записи, прежде чем делать вывод.",
    kg: "Бул чектердин санынын, орточо чектин жана кайтаруулардын байкалган өзгөрүүлөрү; натыйжанын себебине далил эмес. Жыйынтык чыгардан мурун тиешелүү жазууларды текшериңиз.",
  })[locale];
