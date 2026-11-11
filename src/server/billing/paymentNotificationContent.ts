import { defaultLocale, normalizeLocale } from "@/lib/locales";
import { formatCurrencyKGS, formatDateTime } from "@/lib/i18nFormat";
import type { PlanCode } from "@/lib/billing/plans";
import type { SubscriptionPaymentNotificationKind } from "./paymentNotificationPolicy";
import {
  escapeEmailHtml,
  renderBrandedEmail,
  renderEmailButton,
} from "@/server/services/emailTemplate";

const content = {
  ru: {
    confirmed: "Bazaar: оплата подписки подтверждена",
    restored: "Bazaar: оплата подтверждена, доступ восстановлен",
    body: "Оплата {amount} за подписку организации «{organization}» подтверждена.",
    active: "Тариф «{plan}» действует с {start} до {end} (время Бишкека).",
    future:
      "Тариф «{plan}» оплачен на период с {start} до {end} (время Бишкека). До начала этого периода сохраняются текущие условия доступа.",
    access:
      "Создание и изменение записей снова доступны. Ваши товары, остатки и история сохранены.",
    action: "Посмотреть подписку и платёж",
    footer:
      "Автоматических списаний нет. Срок и состав подписки, включая оплаченные дополнения, указаны в кабинете. Это служебное подтверждение Bazaar, а не фискальный чек.",
    plans: { STARTER: "Новичок", BUSINESS: "Бизнесмен", ENTERPRISE: "Монополист" },
  },
  kg: {
    confirmed: "Bazaar: жазылуу төлөмү ырасталды",
    restored: "Bazaar: төлөм ырасталды, жеткилик калыбына келди",
    body: "«{organization}» уюмунун жазылуусу үчүн {amount} төлөм ырасталды.",
    active: "«{plan}» тарифи {start} баштап {end} чейин иштейт (Бишкек убактысы).",
    future:
      "«{plan}» тарифи {start} баштап {end} чейинки мөөнөткө төлөндү (Бишкек убактысы). Бул мөөнөт башталганга чейин учурдагы жеткилик шарттары сакталат.",
    access:
      "Жазууларды түзүү жана өзгөртүү кайра жеткиликтүү. Товарларыңыз, калдыктарыңыз жана тарыхыңыз сакталды.",
    action: "Жазылууну жана төлөмдү көрүү",
    footer:
      "Автоматтык түрдө акча алынбайт. Жазылуунун мөөнөтү жана курамы, анын ичинде төлөнгөн кошумчалар, кабинетте көрсөтүлгөн. Бул Bazaar кызматтык ырастоосу, фискалдык чек эмес.",
    plans: { STARTER: "Новичок", BUSINESS: "Бизнесмен", ENTERPRISE: "Монополист" },
  },
  en: {
    confirmed: "Bazaar: subscription payment confirmed",
    restored: "Bazaar: payment confirmed, access restored",
    body: "The {amount} subscription payment for “{organization}” is confirmed.",
    active: "The {plan} plan runs from {start} until {end} (Bishkek time).",
    future:
      "The {plan} plan is paid for the period from {start} until {end} (Bishkek time). Your current access conditions remain in effect until that period starts.",
    access:
      "You can create and edit records again. Your products, stock and history are preserved.",
    action: "View subscription and payment",
    footer:
      "There are no automatic charges. Your subscription period and configuration, including paid extras, are shown in your account. This is a service confirmation from Bazaar, not a fiscal receipt.",
    plans: { STARTER: "Новичок", BUSINESS: "Бизнесмен", ENTERPRISE: "Монополист" },
  },
};
export function subscriptionPaymentNotificationContent(input: {
  kind: SubscriptionPaymentNotificationKind;
  organizationName: string;
  language: string;
  amountMinor: number;
  plan: PlanCode;
  startsAt: Date;
  endsAt: Date;
  confirmedAt: Date;
}) {
  const locale = normalizeLocale(input.language) ?? defaultLocale;
  const copy = content[locale];
  const restoredNow = input.kind === "ACCESS_RESTORED" && input.startsAt <= input.confirmedAt;
  const subject = restoredNow ? copy.restored : copy.confirmed;
  const values = {
    amount: formatCurrencyKGS(input.amountMinor / 100, locale),
    organization: input.organizationName,
    plan: copy.plans[input.plan],
    start: formatDateTime(input.startsAt, locale),
    end: formatDateTime(input.endsAt, locale),
  };
  const fill = (template: string) =>
    template.replace(
      /\{(amount|organization|plan|start|end)\}/g,
      (_, key: keyof typeof values) => values[key],
    );
  const paragraphs = [
    fill(copy.body),
    fill(input.startsAt > input.confirmedAt ? copy.future : copy.active),
  ];
  if (restoredNow) paragraphs.push(copy.access);
  const url = "https://bazaar.kg/billing";
  return {
    locale,
    subject,
    text: [...paragraphs, `${copy.action}: ${url}`, copy.footer].join("\n\n"),
    html: renderBrandedEmail({
      locale,
      title: subject,
      preheader: paragraphs[0],
      contentHtml: `${paragraphs
        .map(
          (paragraph) =>
            `<p style="margin:0 0 16px;line-height:1.6">${escapeEmailHtml(paragraph)}</p>`,
        )
        .join(
          "",
        )}<div style="margin:24px 0 0">${renderEmailButton({ href: url, label: copy.action })}</div>`,
      footerHtml: escapeEmailHtml(copy.footer),
    }),
  };
}
