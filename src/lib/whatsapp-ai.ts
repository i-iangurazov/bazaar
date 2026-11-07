import { z } from "zod";

export const WHATSAPP_INCLUDED_MESSAGES = 1000;
export const WHATSAPP_OFFER_VERSION = "2026-11-07-kg-v1";
// Never remove sold offer versions: delayed callbacks must honor their purchase snapshot.
const WHATSAPP_OFFERS = { "2026-11-07-kg-v1": { messages: 1000, priceMinor: 349000 } } as const;
export const WHATSAPP_PACK_MESSAGES = WHATSAPP_OFFERS[WHATSAPP_OFFER_VERSION].messages;
export const WHATSAPP_PACK_PRICE_MINOR = WHATSAPP_OFFERS[WHATSAPP_OFFER_VERSION].priceMinor;
export const whatsappOffer = (version: string) =>
  Object.hasOwn(WHATSAPP_OFFERS, version)
    ? WHATSAPP_OFFERS[version as keyof typeof WHATSAPP_OFFERS]
    : null;
export const WHATSAPP_STYLES = [
  "friendly",
  "professional",
  "premium",
  "casual",
  "concise",
  "custom",
] as const;
export const whatsappProfileSchema = z.object({
  style: z.enum(WHATSAPP_STYLES).default("professional"),
  language: z.enum(["auto", "ru", "kg", "en"]).default("auto"),
  addressForm: z.enum(["formal", "informal"]).default("formal"),
  emoji: z.boolean().default(false),
  length: z.enum(["short", "normal", "detailed"]).default("normal"),
  assistantName: z.string().trim().min(1).max(60).default("Bazaar"),
  instructions: z.string().trim().max(1000).default(""),
  greeting: z.string().trim().max(300).default(""),
  farewell: z.string().trim().max(200).default(""),
});
export const whatsappKnowledgeSchema = z.object({
  storeName: z.string().trim().min(1).max(120),
  address: z.string().trim().max(500).default(""),
  hours: z.string().trim().max(500).default(""),
  contacts: z.string().trim().max(500).default(""),
  payments: z.string().trim().max(600).default(""),
  delivery: z.string().trim().max(800).default(""),
  returns: z.string().trim().max(800).default(""),
  faq: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(200),
        answer: z.string().trim().min(1).max(800),
      }),
    )
    .max(20)
    .default([]),
});
export type WhatsAppProfile = z.infer<typeof whatsappProfileSchema>;
export type WhatsAppKnowledge = z.infer<typeof whatsappKnowledgeSchema>;

/** Customer units are messages, not tokens, model requests or webhook retries. */
export function whatsappPeriod(now = new Date()) {
  const local = new Date(now.getTime() + 6 * 3600_000);
  const year = local.getUTCFullYear(),
    month = local.getUTCMonth();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    startsAt: new Date(Date.UTC(year, month, 1) - 6 * 3600_000),
    endsAt: new Date(Date.UTC(year, month + 1, 1) - 6 * 3600_000),
  };
}

export function whatsappWindowOpen(lastInboundAt: Date | null, now = new Date()) {
  return Boolean(
    lastInboundAt && lastInboundAt <= now && now.getTime() - lastInboundAt.getTime() < 86400_000,
  );
}

export function whatsappRecipientCountry(
  phone: string | null | undefined,
  country?: string | null,
) {
  const normalized = phone?.replace(/^\+/, "") ?? "";
  if (/^996\d{9}$/.test(normalized)) return "KG";
  // A BSUID can have no telephone. Never infer the buyer's country from the store.
  if (!normalized && country?.toUpperCase() === "KG") return "KG";
  return null;
}

export function whatsappPackExpiresAt(paidAt: Date) {
  const expiry = new Date(paidAt);
  const day = expiry.getUTCDate();
  expiry.setUTCDate(1);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  const lastDay = new Date(
    Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0),
  ).getUTCDate();
  expiry.setUTCDate(Math.min(day, lastDay));
  return expiry;
}

export const whatsappPackSelectionSchema = z.object({
  quantity: z.number().int().min(1).max(10),
  offerVersion: z.literal(WHATSAPP_OFFER_VERSION),
  termsAccepted: z.literal(true),
  termsVersion: z.string().min(1).max(100),
  expectedAmountMinor: z.number().int().positive().max(2147483647),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/),
  locale: z.enum(["ru", "kg", "en"]).default("ru"),
});
