import type { MessageKeys, NestedKeyOf } from "next-intl";
import type messages from "../../../messages/ru.json";

type BillingMessages = typeof messages.billing;
type BillingMessageKey = MessageKeys<BillingMessages, NestedKeyOf<BillingMessages>>;

/** Call-only contract shared by public pricing and the existing add-on cards. */
export type BillingTranslator = (
  key: BillingMessageKey,
  values?: Record<string, string | number>,
) => string;
