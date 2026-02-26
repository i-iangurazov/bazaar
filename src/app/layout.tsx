import type { Metadata } from "next";
import localFont from "next/font/local";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";

import "./globals.css";
import { Providers } from "./providers";
import { defaultLocale } from "@/lib/locales";
import { defaultTimeZone } from "@/lib/timezone";
import { resolveThemePreference, themeClassName, themeCookieName } from "@/lib/theme";

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

const catalogFontsStylesheetHref =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&family=Montserrat:wght@400;600;700&family=Lato:wght@400;700&family=PT+Sans:wght@400;700&family=Source+Sans+3:wght@400;600;700&family=Manrope:wght@400;600;700&display=swap&subset=cyrillic";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("meta");
  return {
    title: t("title"),
    description: t("description"),
    icons: {
      icon: [
        { url: "/brand/icon.png", type: "image/png" },
        { url: "/brand/icon.png", sizes: "32x32", type: "image/png" },
        { url: "/brand/icon.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/brand/icon.png", type: "image/png" }],
      shortcut: ["/brand/icon.png"],
    },
  };
};

const RootLayout = async ({ children }: { children: React.ReactNode }) => {
  const locale = (await getLocale()) ?? defaultLocale;
  const messages = await getMessages();
  const theme = resolveThemePreference(cookies().get(themeCookieName)?.value);
  const htmlClassName = themeClassName(theme);

  return (
    <html lang={locale} className={htmlClassName} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={catalogFontsStylesheetHref} />
      </head>
      <body
        className={`${notoSans.variable} font-sans min-h-screen bg-gradient-to-br from-background via-background to-secondary/40`}
      >
        <Providers locale={locale} messages={messages} timeZone={defaultTimeZone}>
          {children}
        </Providers>
      </body>
    </html>
  );
};

export default RootLayout;
