import type { Metadata } from "next";
import localFont from "next/font/local";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import "./globals.css";
import { Providers } from "./providers";
import { defaultLocale } from "@/lib/locales";
import { defaultTimeZone } from "@/lib/timezone";

const notoSans = localFont({
  src: [
    {
      path: "../../assets/fonts/NotoSans-Regular.ttf",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-sans",
  display: "swap",
});

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("meta");
  return {
    title: t("title"),
    description: t("description"),
  };
};

const RootLayout = async ({ children }: { children: React.ReactNode }) => {
  const locale = (await getLocale()) ?? defaultLocale;
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body
        className={`${notoSans.variable} font-sans min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100`}
      >
        <Providers locale={locale} messages={messages} timeZone={defaultTimeZone}>
          {children}
        </Providers>
      </body>
    </html>
  );
};

export default RootLayout;
