"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  analyticsPrivacyOptOut, interceptPrivateMarketingLink, marketingMeasurementId, publicMarketingPage,
  readAnalyticsConsent, synchronizeMarketingAnalytics, trackMarketingEvent,
  writeAnalyticsConsent, type AnalyticsConsent,
} from "@/lib/marketingAnalytics";

export function MarketingAnalytics() {
  const pathname = usePathname();
  const t = useTranslations("analyticsConsent");
  const [ready, setReady] = useState(false);
  const [choice, setChoice] = useState<AnalyticsConsent | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const configured = Boolean(marketingMeasurementId());

  useEffect(() => {
    const sync = () => {
      setChoice(readAnalyticsConsent());
      setBlocked(analyticsPrivacyOptOut());
      synchronizeMarketingAnalytics(pathname);
      setReady(true);
    };
    sync();
    window.addEventListener("bazaar:analytics-consent", sync);
    window.addEventListener("storage", sync);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync(); // Back/Forward cache restores without remounting React.
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("bazaar:analytics-consent", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pathname]);

  useEffect(() => {
    if (!configured) return;
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (publicMarketingPage(window.location.pathname) && anchor.protocol === "https:" &&
        anchor.hostname === "wa.me" && anchor.pathname === "/996709911300")
        trackMarketingEvent("contact_whatsapp_click");
      interceptPrivateMarketingLink(event);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [configured]);

  if (!configured || !ready || !publicMarketingPage(pathname)) return null;

  const choose = (next: AnalyticsConsent) => {
    writeAnalyticsConsent(next);
    setEditing(false);
  };

  if (blocked) {
    return pathname === "/privacy" ? (
      <p className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-lg">
        {t("browserChoice")}
      </p>
    ) : null;
  }

  if (choice && !editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="fixed bottom-4 right-4 z-40 min-h-11 rounded-lg border border-border bg-card px-4 text-sm text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("settings")}
      </button>
    );
  }

  return (
    <aside aria-label={t("title")}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border border-border bg-card p-5 text-foreground shadow-xl sm:p-6">
      <p className="text-base font-semibold">{t("title")}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("description")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" className="min-h-11" onClick={() => choose("granted")}>{t("allow")}</Button>
        <Button type="button" className="min-h-11" variant="secondary" onClick={() => choose("denied")}>{t("decline")}</Button>
        <Link href="/privacy" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t("privacy")}</Link>
      </div>
    </aside>
  );
}
