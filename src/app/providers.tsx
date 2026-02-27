"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink, loggerLink } from "@trpc/client";
import superjson from "superjson";
import { SessionProvider } from "next-auth/react";
import { NextIntlClientProvider } from "next-intl";
import { z } from "zod";

import { trpc, getBaseUrl } from "@/lib/trpc";
import { createMessageFallback } from "@/lib/i18nFallback";
import { createLocalizedZodErrorMap } from "@/lib/zodErrorMap";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeSync } from "@/components/theme-sync";

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
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 15_000,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      transformer: superjson,
      links: [
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === "development" ||
            (opts.direction === "down" && opts.result instanceof Error),
        }),
        httpLink({
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

  useEffect(() => {
    const previousErrorMap = z.getErrorMap();
    z.setErrorMap(createLocalizedZodErrorMap(locale));
    return () => {
      z.setErrorMap(previousErrorMap);
    };
  }, [locale]);

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
            <ThemeSync />
            <TooltipProvider>
              <ToastProvider>{children}</ToastProvider>
            </TooltipProvider>
          </NextIntlClientProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
};
