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
import {
  metaMeasurementId, readMetaConsent, synchronizeMetaMeasurement, writeMetaConsent,
} from "@/lib/metaMarketing";

export function MarketingAnalytics() {
  const pathname = usePathname();
  const t = useTranslations("analyticsConsent");
  const [ready, setReady] = useState(false);
  const [choice, setChoice] = useState<AnalyticsConsent | null>(null);
  const [metaChoice, setMetaChoice] = useState<AnalyticsConsent | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const googleConfigured = Boolean(marketingMeasurementId());
  const metaConfigured = Boolean(metaMeasurementId());
  const configured = googleConfigured || metaConfigured;

  useEffect(() => {
    const sync = () => {
      setChoice(readAnalyticsConsent());
      setMetaChoice(readMetaConsent());
      setBlocked(analyticsPrivacyOptOut());
      synchronizeMarketingAnalytics(pathname);
      synchronizeMetaMeasurement(pathname);
      setReady(true);
    };
    sync();
    window.addEventListener("bazaar:analytics-consent", sync);
    window.addEventListener("bazaar:meta-consent", sync);
    window.addEventListener("storage", sync);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync(); // Back/Forward cache restores without remounting React.
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("bazaar:analytics-consent", sync);
      window.removeEventListener("bazaar:meta-consent", sync);
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

  const choose = (next: AnalyticsConsent, advertising: AnalyticsConsent = "denied") => {
    writeAnalyticsConsent(next, advertising);
    setEditing(false);
  };

  if (blocked) {
    return pathname === "/privacy" ? (
      <p className="fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-lg">
        {t("browserChoice")}
      </p>
    ) : null;
  }

  const googlePending = googleConfigured && !choice;
  const metaPending = metaConfigured && !metaChoice;
  const showGoogle = googleConfigured && (googlePending || editing);
  const showMeta = metaConfigured && (metaPending || editing);
  if (!googlePending && !metaPending && !editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}
        className="fixed bottom-4 right-4 z-40 min-h-11 rounded-lg border border-border bg-card px-4 text-sm text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("settings")}
      </button>
    );
  }

  return (
    <aside aria-label={t(showGoogle ? "title" : "metaTitle")}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-h-[calc(100dvh-1.5rem)] max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl sm:p-6">
      {showGoogle && <div>
        <p className="text-base font-semibold">{t("title")}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("description")}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("advertisingDescription")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-left" variant="secondary" onClick={() => choose("granted")}>{t("allow")}</Button>
          <Button type="button" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-left" variant="secondary" onClick={() => choose("granted", "granted")}>{t("allowAdvertising")}</Button>
          <Button type="button" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-left" variant="secondary" onClick={() => choose("denied")}>{t("decline")}</Button>
        </div>
      </div>}
      {showMeta && <div className={showGoogle ? "mt-5 border-t border-border pt-4" : ""}>
        <p className="text-base font-semibold">{t("metaTitle")}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("metaDescription")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => { writeMetaConsent("granted"); setEditing(false); }}>{t("metaAllow")}</Button>
          <Button type="button" variant="secondary" onClick={() => { writeMetaConsent("denied"); setEditing(false); }}>{t("metaDecline")}</Button>
        </div>
      </div>}
      <Link href="/privacy" className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t("privacy")}</Link>
    </aside>
  );
}
