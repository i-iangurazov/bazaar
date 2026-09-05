import { addBusinessDays, businessDateKey, businessDateOnlyToUtc } from "@/lib/timezone";

export type BaamRange = { dateFrom: string; dateTo: string };
export type BaamScopeReason =
  | "controls"
  | "context"
  | "today"
  | "yesterday"
  | "complete_days"
  | "complete_weeks"
  | "complete_months"
  | "month_to_date"
  | "calendar_week"
  | "explicit_dates"
  | "named_months";
export type BaamClarification =
  | "date"
  | "store"
  | "context"
  | "range"
  | "product"
  | "product_comparison";
type Store = { id: string; name: string };
type Resolution =
  | {
      status: "resolved";
      range: BaamRange;
      storeId?: string;
      reason: BaamScopeReason;
      question: string;
      explicit: boolean;
      namedStore: boolean;
    }
  | { status: "clarification"; clarification: BaamClarification };
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replaceAll("ё", "е");
const bounded = (source: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "gu");
const terms = (source: string, value: string) => [...value.matchAll(bounded(source))];
const blank = (text: string, start: number, length: number) =>
  text.slice(0, start) + " ".repeat(length) + text.slice(start + length);
const validRange = ({ dateFrom, dateTo }: BaamRange) => {
  try {
    const days =
      (businessDateOnlyToUtc(dateTo).getTime() - businessDateOnlyToUtc(dateFrom).getTime()) /
        86400000 +
      1;
    return days >= 1 && days <= 366;
  } catch {
    return false;
  }
};
const monthStart = (date: string, offset: number) => {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
};
const numbers: Record<string, number> = {
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
  sixty: 60,
  ninety: 90,
  один: 1,
  одну: 1,
  одна: 1,
  два: 2,
  две: 2,
  двух: 2,
  три: 3,
  трех: 3,
  четыре: 4,
  четырех: 4,
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
  одиннадцать: 11,
  двенадцать: 12,
  четырнадцать: 14,
  пятнадцать: 15,
  двадцать: 20,
  тридцать: 30,
  шестьдесят: 60,
  девяносто: 90,
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
  жыйырма: 20,
  отуз: 30,
  алтымыш: 60,
  токсон: 90,
};
const previous =
  "(?:last|previous|последн\\p{L}*|прошл\\p{L}*|предыдущ\\p{L}*|акыркы|өткөн\\p{L}*|мурдагы)";
const unit =
  "(?:days?|weeks?|months?|день|дня|дней|сут\\p{L}*|недел\\p{L}*|месяц\\p{L}*|күн\\p{L}*|апта\\p{L}*|жума\\p{L}*|ай\\p{L}*)";
const normalizeNumbers = (text: string) => {
  const numberWords = Object.keys(numbers).join("|");
  const expression = bounded(
    `${previous}\\s*(?:\\d+|(?:${numberWords})(?:[ -]+(?:${numberWords}))?)\\s*${unit}`,
  );
  return text.replace(expression, (phrase) => {
    let result = phrase
      .replace(/(?<=\p{L})(?=\d)|(?<=\d)(?=\p{L})/gu, " ")
      .replace(bounded(numberWords), (word) => String(numbers[word]));
    result = result.replace(/\b(10|20|30|60|90)[ -]+([1-9])\b/g, (_, tens, units) =>
      String(Number(tens) + Number(units)),
    );
    return result;
  });
};
const monthPatterns = [
  "january|jan|январ\\p{L}*",
  "february|feb|феврал\\p{L}*",
  "march|mar|март\\p{L}*",
  "april|apr|апрел\\p{L}*",
  "may|ма[йяею]\\p{L}*",
  "june|jun|июн\\p{L}*",
  "july|jul|июл\\p{L}*",
  "august|aug|август\\p{L}*",
  "september|sept?|сентябр\\p{L}*",
  "october|oct|октябр\\p{L}*",
  "november|nov|ноябр\\p{L}*",
  "december|dec|декабр\\p{L}*",
];
const monthSource = monthPatterns.map((pattern) => `(?:${pattern})`).join("|");
const genericStore =
  /^(?:sales|returns|payments|refunds|receipts|performance|totals|revenue|results|discounts|income|profit|selected|all|my|our|the|these|those|this|scope|filters|in|for|of|выбран\p{L}*|все|всех|наш\p{L}*|моего|этот|этом|тандалган|бардык|баардык|менин|биздин|бул|ушул|боюнча|үчүн|продаж\p{L}*|возврат\p{L}*|платеж\p{L}*|сатуу\p{L}*|кайтаруу\p{L}*|төлөм\p{L}*)$/u;

// A finite grammar, not a general natural-language parser. Accepted date
// productions resolve locally; remaining date/store cues require clarification.
// No provider can override the resulting scope. Store names never leave here.
export const resolveBaamQuestionScope = (input: {
  question: string;
  selected: BaamRange & { storeId?: string };
  stores: readonly Store[];
  now?: Date;
}): Resolution => {
  let text = normalize(input.question);
  if (
    /(?:\b(?:never|ever|all[ -]time|lifetime)\b|за все время|никогда|эч качан|бардык убакыт)/iu.test(
      text,
    )
  )
    return { status: "clarification", clarification: "range" };
  const hits: Array<{ id: string; start: number; length: number }> = [];
  for (const store of input.stores) {
    const name = normalize(store.name).trim();
    if (!name) continue;
    let from = 0;
    while (from < text.length) {
      const start = text.indexOf(name, from);
      if (start < 0) break;
      from = start + name.length;
      const before = text.slice(0, start).slice(-1),
        after = text.slice(from, from + 1);
      if ((!before || !/[\p{L}\p{N}]/u.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after))) {
        if (name.length < 3 || genericStore.test(name))
          return { status: "clarification", clarification: "store" };
        hits.push({ id: store.id, start, length: name.length });
      }
    }
  }
  // Prefer a longer literal name over its prefix; identical names remain ambiguous.
  const fullHits = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other.length > hit.length &&
          other.start <= hit.start &&
          other.start + other.length >= hit.start + hit.length,
      ),
  );
  const ids = [...new Set(fullHits.map((hit) => hit.id))];
  if (ids.length > 1) return { status: "clarification", clarification: "store" };
  for (const hit of fullHits) text = blank(text, hit.start, hit.length);
  const allStores = terms(
    "(?:all|every)\\s+(?:stores|shops)|вс[еех]+\\s+магазин\\p{L}*|(?:бардык|баардык)\\s+дүкөн\\p{L}*",
    text,
  );
  if (allStores.length && ids.length) return { status: "clarification", clarification: "store" };
  for (const hit of allStores) text = blank(text, hit.index!, hit[0].length);
  if (
    terms(
      "compare(?:\\s+the)?\\s+(?:stores|shops)|сравн\\p{L}*\\s+магазин\\p{L}*|дүкөндөр\\p{L}*\\s+салыштыр\\p{L}*",
      text,
    ).length
  )
    return { status: "clarification", clarification: "store" };
  const storeWords = [...text.matchAll(bounded("store|shop|магазин\\p{L}*|дүкөн\\p{L}*"))];
  for (const hit of storeWords) {
    const next = text
      .slice(hit.index! + hit[0].length)
      .trim()
      .match(/^[\p{L}\p{N}]+/u)?.[0];
    const previous = text
      .slice(0, hit.index)
      .trim()
      .match(/[\p{L}\p{N}]+$/u)?.[0];
    if (
      (next &&
        !genericStore.test(next) &&
        !/^(?:today|yesterday|last|this|за|в|с|на|күн|ай)$/u.test(next)) ||
      (hit[0].startsWith("дүкөн") && previous && !genericStore.test(previous) && !ids.length)
    )
      return { status: "clarification", clarification: "store" };
    text = blank(text, hit.index!, hit[0].length);
  }
  text = normalizeNumbers(text);
  const today = businessDateKey(input.now ?? new Date());
  const candidates: Array<{ range: BaamRange; reason: BaamScopeReason }> = [];
  const consume = (match: RegExpMatchArray, range: BaamRange, reason: BaamScopeReason) => {
    candidates.push({ range, reason });
    text = blank(text, match.index!, match[0].length);
  };
  const iso = [...text.matchAll(/(?<![\d])\d{4}-\d{2}-\d{2}(?![\d])/gu)];
  if (iso.length > 2) return { status: "clarification", clarification: "date" };
  if (iso.length) {
    if (
      iso.length === 2 &&
      !/^(?:\s|to|through|until|по|до|чейин|—|–|-)+$/u.test(
        text.slice(iso[0].index! + iso[0][0].length, iso[1].index!),
      )
    )
      return { status: "clarification", clarification: "date" };
    candidates.push({
      range: { dateFrom: iso[0][0], dateTo: iso.at(-1)![0] },
      reason: "explicit_dates",
    });
    for (const hit of iso) text = blank(text, hit.index!, hit[0].length);
  }
  // Locale-neutral named months require a year. July–August 2026 shares the
  // explicit year; two independently specified years support year boundaries.
  const named = [...text.matchAll(bounded(`(?:${monthSource})(?:\\s+(\\d{4}))?`))].filter(
    (hit) => !(hit[0] === "may" && /^(?:\s+i\b)/u.test(text.slice(hit.index! + 3))),
  );
  if (named.length > 2) return { status: "clarification", clarification: "date" };
  if (named.length) {
    if (
      named.length === 2 &&
      !/^(?:\s|to|through|по|до|—|–|-)+$/u.test(
        text.slice(named[0].index! + named[0][0].length, named[1].index!),
      )
    )
      return { status: "clarification", clarification: "date" };
    const dates = named.map((hit) => {
      const year = hit[1] ?? (named.length === 2 ? named[1][1] : undefined);
      if (!year) return null;
      const month = monthPatterns.findIndex((pattern) => terms(pattern, hit[0]).length) + 1;
      const value = `${year}-${String(month).padStart(2, "0")}-01`;
      return { dateFrom: value, dateTo: addBusinessDays(monthStart(value, 1), -1) };
    });
    if (dates.some((date) => !date)) return { status: "clarification", clarification: "date" };
    candidates.push({
      range: { dateFrom: dates[0]!.dateFrom, dateTo: dates.at(-1)!.dateTo },
      reason: "named_months",
    });
    for (const hit of named) text = blank(text, hit.index!, hit[0].length);
  }
  for (const hit of terms(
    "today|сегодня\\p{L}*|бүгүн\\p{L}*|yesterday|вчера\\p{L}*|кечээ\\p{L}*",
    text,
  )) {
    const isToday = /^(?:today|сегодня|бүгүн)/u.test(hit[0]);
    const date = isToday ? today : addBusinessDays(today, -1);
    consume(hit, { dateFrom: date, dateTo: date }, isToday ? "today" : "yesterday");
  }

  for (const hit of terms(`${previous}\\s+(?:(\\d+)\\s+)?(${unit})`, text)) {
    const count = Number(hit[1] ?? 1);
    if (count < 1 || count > 366) return { status: "clarification", clarification: "range" };
    const isMonth = /^(?:month|месяц|ай)/u.test(hit[2]);
    const isWeek = /^(?:week|недел|апта|жума)/u.test(hit[2]);
    if (isMonth)
      consume(
        hit,
        { dateFrom: monthStart(today, -count), dateTo: addBusinessDays(monthStart(today, 0), -1) },
        "complete_months",
      );
    else if (isWeek && !hit[1]) {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
      const monday = addBusinessDays(today, 1 - weekday);
      consume(
        hit,
        { dateFrom: addBusinessDays(monday, -7), dateTo: addBusinessDays(monday, -1) },
        "calendar_week",
      );
    } else
      consume(
        hit,
        {
          dateFrom: addBusinessDays(today, -count * (isWeek ? 7 : 1)),
          dateTo: addBusinessDays(today, -1),
        },
        isWeek ? "complete_weeks" : "complete_days",
      );
  }
  for (const hit of terms(
    "(?:this|current)\\s+month|(?:этот|текущий|этом)\\s+месяц\\p{L}*|(?:бул|ушул)\\s+ай\\p{L}*",
    text,
  ))
    consume(hit, { dateFrom: monthStart(today, 0), dateTo: today }, "month_to_date");
  // Residual calendar/location cues cannot silently become control-scope facts.
  const suspicious = terms(
    "today|yesterday|tomorrow|tonight|days?|weeks?|months?|quarters?|years?|past|rolling|since|between|before|after|last|previous|сегодня\\p{L}*|вчера\\p{L}*|завтра\\p{L}*|позавчера\\p{L}*|недел\\p{L}*|месяц\\p{L}*|квартал\\p{L}*|год\\p{L}*|дней|дня|день|жыл\\p{L}*|ай(?:да|дагы|дын|га|дан)?|күн(?:дө|дөгү|дүн|гө|дөн)?|эртең\\p{L}*|monday|tuesday|wednesday|thursday|friday|saturday|sunday|понедельник\\p{L}*|вторник\\p{L}*|сред[ауыое]|четверг\\p{L}*|пятниц\\p{L}*|суббот\\p{L}*|воскресень\\p{L}*|дүйшөмбү\\p{L}*|шейшемби\\p{L}*|шаршемби\\p{L}*|бейшемби\\p{L}*|ишемби\\p{L}*|жекшемби\\p{L}*",
    text.replace(/previous\s+(?:equal[- ]length\s+)?period/gu, "selected period"),
  );
  if (
    suspicious.length ||
    /\b\d{1,4}[-/]\d{1,2}(?:[-/]\d{1,4})?\b/u.test(text) ||
    /\b\d{1,2}\.\d{1,2}\.\d{4}\b/u.test(text) ||
    (candidates.length && /\b\d{1,4}\b/u.test(text))
  )
    return { status: "clarification", clarification: "date" };
  if (candidates.length > 1) return { status: "clarification", clarification: "date" };
  const selected = candidates[0];
  const range = selected?.range ?? input.selected;
  if (!validRange(range)) return { status: "clarification", clarification: "range" };
  return {
    status: "resolved",
    range: { dateFrom: range.dateFrom, dateTo: range.dateTo },
    storeId: ids[0] ?? (allStores.length ? undefined : input.selected.storeId),
    reason: selected?.reason ?? "controls",
    explicit: Boolean(selected || ids.length || allStores.length),
    namedStore: Boolean(ids.length || allStores.length),
    question: text.replace(/\s+/gu, " ").trim(),
  };
};

export const isBaamFollowUp = (question: string) => {
  const text = normalize(question);
  return (
    /^(?:and(?:\s|$)|what about(?:\s|$)|compare(?:\s|$)|а(?:\s|$)|сравни\p{L}*(?:\s|$)|ал эми(?:\s|$)|салыштыр\p{L}*)/u.test(
      text,
    ) ||
    terms(
      "that|those|same|it|its|their|them|this product|that product|это|этом|его|ее|их|тот же|этот товар|этого товара|этому товару|ошол|ушул эле|бул товар(?:дан|дын|га)?|анын|алардын|мурунку мезгил|предыдущим периодом|previous period",
      text,
    ).length > 0
  );
};
