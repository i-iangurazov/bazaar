// Conservative preflight only: never resolve natural-language dates or expand
// an authorized scope. Recognized date/store requests must use the UI controls.
// Unrecognized wording still goes through the strict model intent contract.
const word = (source: string) =>
  new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${source})(?=$|[^\\p{L}\\p{N}])`, "u");
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replaceAll("ё", "е");
const words = (text: string) =>
  normalize(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const explicitDatePatterns = [
  word(
    "today|yesterday|tomorrow|tonight|сегодня\\p{L}*|вчера\\p{L}*|позавчера\\p{L}*|завтра\\p{L}*|послезавтра\\p{L}*|бүгүн\\p{L}*|кечээ\\p{L}*|эртең\\p{L}*|бүрсүгүн\\p{L}*",
  ),
  word(
    "(?:this|last|next|previous|current|past)\\s+(?:\\d+\\s*)?(?:day|week|month|quarter|year)s?",
  ),
  word(
    "(?:эт|прошл|предыдущ|следующ|текущ|последн)\\p{L}*\\s+(?:\\d+\\s*)?(?:день|дня|дней|недел\\p{L}*|месяц\\p{L}*|квартал\\p{L}*|год\\p{L}*|лет)",
  ),
  word(
    "(?:бул|өткөн\\p{L}*|мурдагы|кийинки|акыркы|ушул)\\s+(?:\\d+\\s*)?(?:күн|апта|жума|ай|жыл|чейрек)\\p{L}*",
  ),
  word(
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday|понедельник\\p{L}*|вторник\\p{L}*|сред[ауыое]|четверг\\p{L}*|пятниц\\p{L}*|суббот\\p{L}*|воскресень\\p{L}*|дүйшөмбү\\p{L}*|шейшемби\\p{L}*|шаршемби\\p{L}*|бейшемби\\p{L}*|жума(?:дагы|да|нын)|ишемби\\p{L}*|жекшемби\\p{L}*",
  ),
  // "May I see sales?" is not a date. The ambiguous English month is handled
  // only with calendar context below; Russian/Kyrgyz month morphology is explicit.
  word(
    "jan(?:uary)?|feb(?:ruary)?|march|apr(?:il)?|june|july|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|январ\\p{L}*|феврал\\p{L}*|март\\p{L}*|апрел\\p{L}*|ма[йяею]\\p{L}*|июн\\p{L}*|июл\\p{L}*|август\\p{L}*|сентябр\\p{L}*|октябр\\p{L}*|ноябр\\p{L}*|декабр\\p{L}*",
  ),
  word(
    "(?:in|during|for|of)\\s+may|may\\s+(?:\\d+|sales|returns|payments|receipts|totals)|\\d+\\s+may",
  ),
  /(?:^|[^\d])(?:\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|\d{4}\.\d{1,2}\.\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})(?=$|[^\d])/u,
];

const genericStoreWords = new Set([
  "sales",
  "returns",
  "payments",
  "refunds",
  "receipts",
  "performance",
  "totals",
  "revenue",
  "results",
  "discounts",
  "income",
  "profit",
  "selected",
  "all",
  "my",
  "our",
  "the",
  "these",
  "those",
  "this",
  "scope",
  "filters",
  "in",
  "for",
  "of",
  "выбранный",
  "выбранном",
  "выбранные",
  "выбранных",
  "все",
  "всех",
  "наш",
  "нашего",
  "наши",
  "моего",
  "этот",
  "этом",
  "тандалган",
  "бардык",
  "баардык",
  "менин",
  "биздин",
  "бул",
  "ушул",
  "боюнча",
  "үчүн",
]);
const genericMetric = /^(?:продаж|возврат|платеж|чек|скид|сатуу|кайтаруу|төлөм|чек)\p{L}*$/u;
const isGenericStoreWord = (value: string) =>
  genericStoreWords.has(value) || genericMetric.test(value);

export const hasExplicitBaamScope = (question: string, authorizedStoreNames: readonly string[]) => {
  const normalized = normalize(question);
  if (explicitDatePatterns.some((pattern) => pattern.test(normalized))) return true;
  const normalizedWords = words(question);
  const padded = ` ${normalizedWords} `;
  // Match literal token sequences, not a regex made from business-controlled text.
  // Very short/generic store names need named-store syntax to avoid matching an article.
  if (
    authorizedStoreNames.some((name) => {
      const normalizedName = words(name);
      return (
        normalizedName.length >= 3 &&
        !isGenericStoreWord(normalizedName) &&
        padded.includes(` ${normalizedName} `)
      );
    })
  )
    return true;
  if (
    word(
      "compare(?:\\s+the)?\\s+(?:stores|shops)|сравн\\p{L}*\\s+магазин\\p{L}*|дүкөндөр\\p{L}*\\s+салыштыр\\p{L}*",
    ).test(normalizedWords)
  )
    return true;

  const tokens = normalizedWords.split(" ");
  return tokens.some((token, index) => {
    const isKyrgyzStore = /^дүкөн\p{L}*$/u.test(token);
    if (!isKyrgyzStore && !/^(?:store|shop|магазин(?:е|а|у|ом|ы|ов|ам|ами|ах)?)$/u.test(token))
      return false;
    const next = tokens[index + 1];
    if (next && !isGenericStoreWord(next)) return true;
    // Kyrgyz typically places the proper name before "дүкөн".
    const previous = tokens[index - 1];
    return Boolean(isKyrgyzStore && previous && !isGenericStoreWord(previous));
  });
};
