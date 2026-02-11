"use client";

import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LanguageIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import { defaultLocale, locales, normalizeLocale, type Locale } from "@/lib/locales";
import { cn } from "@/lib/utils";

export const LanguageSwitcher = () => {
  const t = useTranslations("common");
  const router = useRouter();
  const locale = normalizeLocale(useLocale()) ?? defaultLocale;
  const { data: session } = useSession();

  const updateLocale = trpc.users.updateLocale.useMutation();
  const localeLabels: Record<Locale, string> = {
    ru: t("locales.ru"),
    kg: t("locales.kg"),
  };

  const handleSwitch = async (nextLocale: Locale) => {
    if (nextLocale === locale) {
      return;
    }
    const response = await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ locale: nextLocale }),
    });
    if (!response.ok) {
      return;
    }
    if (session?.user) {
      updateLocale.mutate({ locale: nextLocale });
    }
    router.refresh();
  };

  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border border-input bg-secondary p-1 text-secondary-foreground shadow-sm"
      role="group"
      aria-label={t("language")}
    >
      <span
        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground"
        aria-hidden
      >
        {updateLocale.isLoading ? <Spinner className="h-3.5 w-3.5" /> : <LanguageIcon className="h-4 w-4" />}
      </span>
      {locales.map((availableLocale) => (
        <Button
          key={availableLocale}
          type="button"
          variant={locale === availableLocale ? "primary" : "ghost"}
          size="sm"
          className={cn(
            "h-7 px-2 text-xs font-semibold",
            locale === availableLocale ? "shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          aria-label={t("switchLocale", { locale: localeLabels[availableLocale] })}
          aria-pressed={locale === availableLocale}
          disabled={updateLocale.isLoading}
          onClick={() => handleSwitch(availableLocale)}
        >
          {localeLabels[availableLocale]}
        </Button>
      ))}
    </div>
  );
};
