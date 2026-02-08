"use client";

import { useState, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import superjson from "superjson";
import { SessionProvider } from "next-auth/react";
import { NextIntlClientProvider } from "next-intl";

import { trpc, getBaseUrl } from "@/lib/trpc";
import { createMessageFallback } from "@/lib/i18nFallback";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

type IntlMessages = ComponentProps<typeof NextIntlClientProvider>["messages"];

export const Providers = ({
  children,
  locale,
  messages,
  timeZone,
}: {
  children: React.ReactNode;
  locale: string;
  messages: IntlMessages;
  timeZone: string;
}) => {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      transformer: superjson,
      links: [
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === "development" ||
            (opts.direction === "down" && opts.result instanceof Error),
        }),
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          fetch(url, options) {
            return fetch(url, { ...options, credentials: "include" });
          },
          headers() {
            return {
              "x-request-id": crypto.randomUUID(),
            };
          },
        }),
      ],
    }),
  );

  return (
    <SessionProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider
            locale={locale}
            messages={messages}
            timeZone={timeZone}
            getMessageFallback={createMessageFallback(locale)}
          >
            <TooltipProvider>
              <ToastProvider>{children}</ToastProvider>
            </TooltipProvider>
          </NextIntlClientProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
};
