import { normalizeLocale, defaultLocale } from "@/lib/locales";
import { formatDateTime } from "@/lib/i18nFormat";
import type { ReminderState } from "./reminderPolicy";
import {
  escapeEmailHtml,
  renderBrandedEmail,
  renderEmailButton,
} from "@/server/services/emailTemplate";

const content = {
  ru: {
    subject: "Bazaar: срок доступа и продление",
    trial: "Пробный период",
    paid: "Оплаченный период",
    before:
      "{period} организации «{organization}» завершается {date}. Продлите доступ в кабинете организации.",
    grace:
      "Оплаченный период организации «{organization}» завершился. Работа остаётся доступной до {date}, чтобы вы успели продлить подписку.",
    expired:
      "Срок доступа организации «{organization}» завершился. История сохраняется; доступные просмотр и выгрузка данных остаются. Продлите подписку, чтобы возобновить создание и изменение записей.",
    action: "Открыть подписку",
    footer:
      "Автоматических списаний нет. Если вы уже оплатили, дождитесь подтверждения платежа в кабинете; не оплачивайте повторно. Это служебное уведомление владельцу организации, а не реклама.",
  },
  kg: {
    subject: "Bazaar: жеткилик мөөнөтү жана узартуу",
    trial: "Сыноо мөөнөтү",
    paid: "Төлөнгөн мөөнөт",
    before:
      "«{organization}» уюмунун {period} {date} аяктайт. Уюмдун кабинетинде жеткиликти узартыңыз.",
    grace:
      "«{organization}» уюмунун төлөнгөн мөөнөтү аяктады. Жазылууну узартууга жетишүү үчүн иштөө {date} чейин жеткиликтүү.",
    expired:
      "«{organization}» уюмунун жеткилик мөөнөтү аяктады. Тарых сакталат; жеткиликтүү көрүү жана маалыматтарды жүктөп алуу мүмкүнчүлүгү калат. Жазууларды түзүүнү жана өзгөртүүнү улантуу үчүн жазылууну узартыңыз.",
    action: "Жазылууну ачуу",
    footer:
      "Автоматтык түрдө акча алынбайт. Төлөп койсоңуз, кабинетте төлөмдүн ырасталышын күтүңүз; кайра төлөбөңүз. Бул уюмдун ээсине кызматтык билдирүү, жарнама эмес.",
  },
  en: {
    subject: "Bazaar: access period and renewal",
    trial: "The trial period",
    paid: "The paid period",
    before:
      "{period} for “{organization}” ends on {date}. Renew access in your organization’s account.",
    grace:
      "The paid period for “{organization}” has ended. Work remains available until {date} so you can renew your subscription.",
    expired:
      "Access for “{organization}” has expired. History is preserved; available viewing and data exports remain accessible. Renew to resume creating and changing records.",
    action: "Open subscription",
    footer:
      "There are no automatic charges. If you have already paid, wait for payment confirmation in your account; do not pay again. This is a service notice to an organization owner, not advertising.",
  },
};
export function subscriptionReminderContent(
  state: ReminderState,
  organizationName: string,
  language: string,
) {
  const locale = normalizeLocale(language) ?? defaultLocale;
  const copy = content[locale];
  const template =
    state.kind === "GRACE" ? copy.grace : state.kind === "READ_ONLY" ? copy.expired : copy.before;
  const values = {
    period: state.source === "TRIAL" ? copy.trial : copy.paid,
    organization: organizationName,
    date: formatDateTime(state.kind === "GRACE" ? state.graceEndsAt! : state.accessEndsAt, locale),
  };
  const body = template.replace(
    /\{(period|organization|date)\}/g,
    (_, key: keyof typeof values) => values[key],
  );
  const url = "https://bazaar.kg/billing";
  return {
    locale,
    subject: copy.subject,
    text: `${body}\n\n${copy.action}: ${url}\n\n${copy.footer}`,
    html: renderBrandedEmail({
      locale,
      title: copy.subject,
      preheader: body,
      contentHtml: `<p style="margin:0 0 16px;line-height:1.6">${escapeEmailHtml(body)}</p><div style="margin:24px 0 0">${renderEmailButton({ href: url, label: copy.action })}</div>`,
      footerHtml: escapeEmailHtml(copy.footer),
    }),
  };
}
