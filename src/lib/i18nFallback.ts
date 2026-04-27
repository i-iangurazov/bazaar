import type { AbstractIntlMessages } from "next-intl";

import ruMessages from "../../messages/ru.json";

type MessageValue = AbstractIntlMessages | string | undefined;

const loggedMissing = new Set<string>();
const isProd = process.env.NODE_ENV === "production";

const getMessageValue = (messages: AbstractIntlMessages, path: string): MessageValue => {
  const parts = path.split(".");
  let current: MessageValue = messages;
  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, MessageValue>)[part];
  }
  return current;
};

const logMissingKey = (locale: string, key: string) => {
  if (isProd) {
    return;
  }
  const fingerprint = `${locale}:${key}`;
  if (loggedMissing.has(fingerprint)) {
    return;
  }
  loggedMissing.add(fingerprint);
  console.warn(`[i18n] Missing ${locale} translation: ${key}`);
};

export const createMessageFallback =
  (locale: string) =>
  ({ namespace, key }: { namespace?: string; key: string }) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    logMissingKey(locale, fullKey);
    if (locale === "kg" || locale === "en") {
      const fallback = getMessageValue(ruMessages as unknown as AbstractIntlMessages, fullKey);
      if (typeof fallback === "string") {
        return fallback;
      }
    }
    return isProd ? "" : `[[missing:${fullKey}]]`;
  };

export const getMessageFromFallback = (key: string) => {
  const fallback = getMessageValue(ruMessages as unknown as AbstractIntlMessages, key);
  return typeof fallback === "string" ? fallback : undefined;
};
