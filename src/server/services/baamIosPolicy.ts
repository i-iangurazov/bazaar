import { baamText, type BaamSend } from "@/lib/baam/companion";
import { appleNativeOriginAllowed } from "@/server/billing/appleNativeOrigin";
import { asksBaamAboutPersonalHealth } from "./baamOperationalHelp";

// The signed WebView appends this marker to ordinary tRPC requests. This
// identifies the product surface only. Authentication stays cookie-based.
export function isBaamIosRequest(request: Request) {
  const agent = request.headers.get("user-agent") ?? "";
  if (!/\bBazaarNativeIOS\/\d+\.\d+\.\d+\b/.test(agent)) return false;
  const origin = new URL(request.url).origin;
  const caller = request.headers.get("origin");
  return appleNativeOriginAllowed(origin) && (!caller || caller === origin);
}

const businessQuestion = /(?:^|\s)(?:товар\p{L}*|касс\p{L}*|остат\p{L}*|продаж\p{L}*|накладн\p{L}*|чек\p{L}*|прайс\p{L}*|баа\p{L}*|сатуу\p{L}*|калдык\p{L}*|эсеп-фактура|\b(?:products?|inventory|stock|sales|invoice|receipt|price list|sku)\b)/iu;
const medicalTopic = /(?:медицин\p{L}*|болезн\p{L}*|диабет\p{L}*|гипертон\p{L}*|астм\p{L}*|перелом\p{L}*|лекарств\p{L}*|антибиотик\p{L}*|дозиров\p{L}*|вакцин\p{L}*|анализ\p{L}* кров\p{L}*|оорунун|оорулар|кант диабети|дарыны|\b(?:medical|medications?|antibiotics?|dosage|diabetes|asthma|fractures?|diarrhea|diseases?|vaccines?|blood tests?)\b)/iu;
const medicalRequest = /(?:симптом\p{L}*|лечени\p{L}*|диагноз\p{L}*|что такое|как лечить|как приним\p{L}*|можно ли принимать|расшифру\p{L}*|дарылоо|белгилери|кантип ич\p{L}*|деген эмне|\b(?:symptoms?|treat(?:ment)?|diagnos\w*|what is|how to take|interpret)\b)/iu;
const explicitMedicalQuestion = /(?:что (?:делать|принять) (?:от|при) [^.?!]{0,32}(?:бол[иеь]|кашл|тошнот|температур|понос)|когда обратиться к врачу|у меня болит|башым ооруйт|ичим ооруйт|дене табым|\b(?:what dose|when should I see a doctor)\b)/iu;
const independentHealthQuestion = /(?:симптом\p{L}*|диагноз\p{L}*|как лечить|как приним\p{L}*|можно ли принимать|дарылоо|белгилери|кантип ич\p{L}*|\b(?:symptoms?|diagnos\w*|how to take|how to treat)\b)/iu;

export function baamIosHealthQuestion(text: string) {
  const question = text.normalize("NFKC");
  const business = businessQuestion.test(question);
  return explicitMedicalQuestion.test(question) ||
    (asksBaamAboutPersonalHealth(question) &&
      (!business || /(?:болит|у меня|как лечить|\bmy\b)/iu.test(question))) ||
    (medicalTopic.test(question) && (business ? independentHealthQuestion : medicalRequest).test(question));
}

export function baamIosHealthAnswer(text: string) {
  return baamIosHealthQuestion(text) ||
    /(?:обратитесь к врачу|проконсультируйтесь с врачом|медицинск\p{L}* (?:специалист\p{L}*|помощ\p{L}*)|дарыгерге кайрыл\p{L}*|\b(?:contact a healthcare professional|seek medical (?:advice|attention)|consult (?:your|a) doctor)\b)/iu.test(text);
}

export function baamIosNeedsLocalHelp(input: Pick<BaamSend, "text">, transcription?: string | null) {
  return baamIosHealthQuestion(input.text) || Boolean(transcription && baamIosHealthQuestion(transcription));
}

export const baamIosHelpText = (locale: string) => baamText(locale,
  "Баам поможет с товарами, кассой, остатками и настройками Bazaar. Задайте вопрос о работе магазина.",
  "Baam can help with products, checkout, stock and Bazaar settings. Ask a question about running your store.",
  "Баам товарлар, касса, калдыктар жана Bazaar жөндөөлөрү боюнча жардам берет. Дүкөндүн иши жөнүндө суроо бериңиз.",
);

export function baamIosHasHealthPrompt(message: { text: string; parts: unknown }) {
  return baamIosHealthQuestion(message.text) ||
    Array.isArray(message.parts) && message.parts.some((part) =>
      part?.type === "transcription" && typeof part.text === "string" && baamIosHealthQuestion(part.text));
}
