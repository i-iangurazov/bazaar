import { z } from "zod";
import type { WhatsAppKnowledge, WhatsAppProfile } from "@/lib/whatsapp-ai";
import type { WhatsAppOffer } from "./catalog";

/** Facts are references to server data, never amounts or stock chosen by a model. */
export const whatsappAnswerSchema = z
  .object({
    language: z.preprocess((value) => (value === "ky" ? "kg" : value), z.enum(["ru", "kg", "en"])),
    intent: z.enum([
      "greeting",
      "products",
      "knowledge",
      "clarify",
      "order",
      "human",
      "complaint",
      "unavailable",
      "outside_scope",
      "farewell",
    ]),
    offerRefs: z.array(z.string().max(180)).max(3).default([]),
    knowledgeTopics: z
      .array(z.enum(["address", "hours", "contacts", "payments", "delivery", "returns"]))
      .max(3)
      .default([]),
    faqIndices: z.array(z.number().int().min(0).max(19)).max(3).default([]),
    socialText: z.string().trim().max(240).default(""),
    question: z.string().trim().max(350).default(""),
  })
  .strict();
export type WhatsAppAnswer = z.infer<typeof whatsappAnswerSchema>;

const copy = {
  ru: {
    intro: "Я виртуальный помощник магазина",
    bye: "Спасибо за обращение! Всего доброго.",
    greet: "Здравствуйте!",
    casual: "Привет!",
    help: "Чем могу помочь?",
    available: "В наличии",
    unavailable: "Сейчас нет в наличии",
    priceMissing: "Цену уточнит сотрудник",
    unit: "Остаток",
    human: "Передаю ваш вопрос сотруднику магазина.",
    complaint:
      "Мне жаль, что возникла проблема. Передаю обращение сотруднику, чтобы он помог разобраться.",
    missing: "Эта информация пока не подтверждена. Уточню у сотрудника.",
    outside: "Я помогаю с товарами и вопросами этого магазина.",
    order:
      "Оформить заказ можно по ссылке магазина ниже или через сотрудника. Товар пока не зарезервирован, оплата не подтверждена.",
    more: "Подскажите, какой вариант вам подходит?",
    missingProduct:
      "Подходящий товар не найден. Уточните название или нужные характеристики — либо я передам вопрос сотруднику.",
  },
  kg: {
    intro: "Мен дүкөндүн виртуалдык жардамчысымын",
    bye: "Кайрылганыңыз үчүн рахмат! Жакшы калыңыз.",
    greet: "Саламатсызбы!",
    casual: "Салам!",
    help: "Кандай жардам бере алам?",
    available: "Кампада бар",
    unavailable: "Азыр кампада жок",
    priceMissing: "Баасын кызматкер тактайт",
    unit: "Калдыгы",
    human: "Сурооңузду дүкөндүн кызматкерине өткөрүп берем.",
    complaint:
      "Көйгөй жаралганына өкүнөм. Маселени чечүүгө жардам бериши үчүн кайрылууңузду кызматкерге өткөрүп берем.",
    missing: "Бул маалымат азырынча ырастала элек. Кызматкерден тактайм.",
    outside: "Мен ушул дүкөндүн товарлары жана кызматтары боюнча жардам берем.",
    order:
      "Буйрутманы төмөнкү дүкөндүн шилтемеси аркылуу же кызматкер менен берсеңиз болот. Товар резервделген эмес, төлөм ырасталган эмес.",
    more: "Кайсы вариант сизге ылайыктуу?",
    missingProduct:
      "Ылайыктуу товар табылган жок. Атын же керектүү мүнөздөмөлөрүн тактаңыз же суроону кызматкерге өткөрүп берем.",
  },
  en: {
    intro: "I am the store's virtual assistant",
    bye: "Thank you for getting in touch. Have a good day!",
    greet: "Hello!",
    casual: "Hi!",
    help: "How can I help?",
    available: "In stock",
    unavailable: "Currently out of stock",
    priceMissing: "A staff member will confirm the price",
    unit: "Available",
    human: "I am passing your question to a store employee.",
    complaint:
      "I am sorry there is a problem. I am passing your message to a staff member who can help resolve it.",
    missing: "This information has not been confirmed yet. A staff member will help.",
    outside: "I help with this store's products and services.",
    order:
      "You can place an order through the store link below or with a staff member. No stock has been reserved and no payment has been confirmed.",
    more: "Which option would you prefer?",
    missingProduct:
      "No matching product was found. Please clarify the name or required features, or I can pass your question to a staff member.",
  },
};

export function renderWhatsAppAnswer(input: {
  answer: WhatsAppAnswer;
  profile: WhatsAppProfile;
  knowledge: WhatsAppKnowledge;
  offers: WhatsAppOffer[];
  firstReply: boolean;
  origin: string;
  catalogLink?: string | null;
}) {
  const { answer: a, profile: p, knowledge: k } = input,
    t = copy[a.language];
  const parts: string[] = [];
  if (input.firstReply && a.intent !== "farewell") {
    const greeting =
      p.greeting || (p.style === "casual" && p.addressForm === "informal" ? t.casual : t.greet);
    parts.push(`${greeting} ${t.intro} «${k.storeName}» · ${p.assistantName}.`);
  }
  const introductoryParts = parts.length;
  let needsHuman = ["human", "complaint", "unavailable"].includes(a.intent);
  // Natural wording is allowed for social language, not for product/financial facts.
  if (a.socialText && !needsHuman && a.intent !== "greeting" && a.intent !== "farewell") {
    if (
      !/\d|https?:|www\.|[%₽$€]|сом|kgs|руб|цен|стоим|скид|бесплат|достав|налич|остат|резерв|оплат|возврат|час|завтра|сегодня|price|cost|discount|free|deliver|stock|available|we have|we can|we will|reserv|paid|refund|hour|tomorrow|today|баа|кампа|калдык|бекер|жеткир|төлөм|кайтар|(?<!\p{L})(?:есть|имеется|бар)(?!\p{L})/iu.test(
        a.socialText,
      )
    )
      parts.push(a.socialText);
  }
  if (a.intent === "complaint") parts.push(t.complaint);
  else if (a.intent === "human" || a.intent === "unavailable") parts.push(t.human);
  else if (a.intent === "outside_scope") parts.push(t.outside);
  else if (a.intent === "greeting") parts.push(t.help);
  else if (a.intent === "farewell") parts.push(p.farewell || t.bye);
  const selected = a.offerRefs.map((ref) => input.offers.find((offer) => offer.ref === ref));
  if (selected.some((offer) => !offer)) throw new Error("Unverified WhatsApp offer reference");
  for (const offer of selected) {
    if (!offer) continue;
    const details = [
      `${offer.name}${offer.variant ? ` · ${offer.variant}` : ""}`,
      offer.price === null ? t.priceMissing : `${offer.price} KGS`,
      offer.available ? t.available : t.unavailable,
    ];
    if (p.length === "detailed" && offer.quantity !== null)
      details.push(`${t.unit}: ${offer.quantity} ${offer.unit}`);
    if (offer.link) details.push(new URL(offer.link, input.origin).toString());
    parts.push(details.join("\n"));
    if (offer.price === null) needsHuman = true;
  }
  for (const topic of a.knowledgeTopics) {
    if (k[topic]) parts.push(k[topic]);
    else {
      parts.push(t.missing);
      needsHuman = true;
    }
  }
  for (const index of a.faqIndices) {
    if (!k.faq[index]) throw new Error("Unverified WhatsApp FAQ reference");
    parts.push(k.faq[index].answer);
  }
  if (a.intent === "order") {
    parts.push(t.order);
    if (input.catalogLink) parts.push(new URL(input.catalogLink, input.origin).toString());
    else {
      parts.push(t.human);
      needsHuman = true;
    }
  }
  if (a.intent === "products" && !selected.length) parts.push(t.missingProduct);
  if (a.question && !needsHuman && a.intent !== "greeting" && a.intent !== "farewell") {
    // A model may ask a question, but may not hide prices, URLs or factual claims in it.
    if (
      /[?？]\s*$/.test(a.question) &&
      !/\d|https?:|www\.|скид|бесплат|достав|налич|резерв|оплат|возврат|оформлю|price|cost|free|discount|stock|reserv|refund|payment|deliver|confirm|баа|кампа|калдык|бекер|жеткир|төлөм|кайтар/iu.test(
        a.question,
      )
    )
      parts.push(a.question);
    else if (a.intent === "clarify") parts.push(t.more);
  } else if (a.intent === "clarify") parts.push(t.more);
  if (parts.length === introductoryParts) {
    parts.push(t.missing);
    needsHuman = true;
  }
  if (p.style === "friendly" && p.emoji && !needsHuman) parts[parts.length - 1] += " 🙂";
  const body = [...new Set(parts)].join("\n\n");
  if (body.length > 4096) throw new Error("WhatsApp answer is too long");
  return { body, needsHuman };
}
