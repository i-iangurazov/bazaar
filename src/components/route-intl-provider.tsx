import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { pickClientMessageNamespaces } from "@/lib/clientMessages";
import { defaultTimeZone } from "@/lib/timezone";

export const RouteIntlProvider = async ({
  children,
  namespaces,
}: {
  children: React.ReactNode;
  namespaces?: readonly string[];
}) => {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const clientMessages = namespaces
    ? pickClientMessageNamespaces(messages, namespaces)
    : messages;

  return (
    <NextIntlClientProvider locale={locale} messages={clientMessages} timeZone={defaultTimeZone}>
      {children}
    </NextIntlClientProvider>
  );
};
