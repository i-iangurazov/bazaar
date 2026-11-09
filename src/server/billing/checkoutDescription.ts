import { AppError } from "@/server/services/errors";
import { readPurchaseSnapshot } from "./purchaseSnapshot";

// Both gateways describe the immutable purchase, not mutable form defaults.
export function subscriptionPaymentDescription(input: {
  plan: string;
  locale: string;
  purchaseSnapshot?: unknown;
}) {
  const purchase = readPurchaseSnapshot(input.purchaseSnapshot);
  const months = purchase?.months ?? 1;
  const descriptions = {
    en:
      purchase?.kind === "UPGRADE"
        ? `upgrade, current ${months}-month term`
        : `access for ${months} month${months === 1 ? "" : "s"}`,
    ru:
      purchase?.kind === "UPGRADE"
        ? `повышение тарифа, текущий период ${months} мес.`
        : `доступ на ${months} мес.`,
    kg:
      purchase?.kind === "UPGRADE"
        ? `тарифти жогорулатуу, учурдагы ${months} айлык мөөнөт`
        : `${months} айга жеткилик`,
  };
  return `Bazaar ${input.plan}: ${descriptions[input.locale === "en" || input.locale === "kg" ? input.locale : "ru"]}`;
}

export function whatsAppPaymentDescription(input: { quantity: number; locale: string }) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 10)
    throw new AppError("billingInvalidAmount");
  const count = input.quantity * 1000;
  return input.locale === "en"
    ? `Bazaar WhatsApp: ${count} service messages`
    : input.locale === "kg"
      ? `Bazaar WhatsApp: ${count} тейлөө билдирүүсү`
      : `Bazaar WhatsApp: ${count} сервисных сообщений`;
}
