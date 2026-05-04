import type { Metadata, Viewport } from "next";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";

import "./globals.css";
import { Providers } from "./providers";
import { defaultLocale } from "@/lib/locales";
import { defaultTimeZone } from "@/lib/timezone";
import { resolveThemePreference, themeClassName, themeCookieName } from "@/lib/theme";

const catalogFontsStylesheetHref =
  "https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&family=Montserrat:wght@400;600;700&family=Lato:wght@400;700&family=PT+Sans:wght@400;700&family=Source+Sans+3:wght@400;600;700&family=Manrope:wght@400;600;700&display=swap&subset=cyrillic";

export const viewport: Viewport = {
  themeColor: "#2563eb",
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
    <html lang={locale} className={htmlClassName} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={catalogFontsStylesheetHref} />
      </head>
      <body className="font-sans min-h-screen bg-gradient-to-br from-background via-background to-secondary/40">
        <Providers locale={locale} messages={messages} timeZone={defaultTimeZone}>
          {children}
        </Providers>
      </body>
    </html>
  );
};

export default RootLayout;
