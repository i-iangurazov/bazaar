import type { Metadata, Viewport } from "next";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";

import "./globals.css";
import { Providers } from "./providers";
import { GlobalNumberInputGuard } from "@/components/global-number-input-guard";
import { bazaarBaseFontStylesheetHref } from "@/lib/catalogFonts";
import { defaultLocale, toIntlLocale } from "@/lib/locales";
import { defaultTimeZone } from "@/lib/timezone";
import { resolveThemePreference, themeClassName, themeCookieName } from "@/lib/theme";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#1d4ed8",
};

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations("meta");
  return {
    title: {
      default: t("title"),
      template: `%s | ${t("title")}`,
    },
    description: t("description"),
    applicationName: "Bazaar",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "Bazaar",
      statusBarStyle: "default",
    },
    other: {
      "mobile-web-app-capable": "yes",
    },
    icons: {
      icon: [
        { url: "/brand/icon.png", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
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
    <html lang={toIntlLocale(locale)} className={htmlClassName} suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/inter/InterVariable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={bazaarBaseFontStylesheetHref} />
      </head>
      <body className="min-h-screen bg-background font-sans">
        <Providers locale={locale} messages={messages} timeZone={defaultTimeZone}>
          <GlobalNumberInputGuard />
          {children}
        </Providers>
      </body>
    </html>
  );
};

export default RootLayout;
