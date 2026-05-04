"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import superjson from "superjson";
import { SessionProvider } from "next-auth/react";
import { NextIntlClientProvider } from "next-intl";
import { z } from "zod";

import { trpc, getBaseUrl } from "@/lib/trpc";
import { createAppQueryClient } from "@/lib/query-client";
import { createMessageFallback } from "@/lib/i18nFallback";
import { createLocalizedZodErrorMap } from "@/lib/zodErrorMap";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeSync } from "@/components/theme-sync";
import { PwaServiceWorkerRegister } from "@/components/pwa-service-worker-register";

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
  const [queryClient] = useState(createAppQueryClient);
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
          maxURLLength: 2_048,
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
            <PwaServiceWorkerRegister />
            <TooltipProvider>
              <ToastProvider>{children}</ToastProvider>
            </TooltipProvider>
          </NextIntlClientProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
};
