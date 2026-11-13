"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { CloseIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  analyticsPrivacyOptOut,
  interceptPrivateMarketingLink,
  marketingMeasurementId,
  publicMarketingPage,
  readAdvertisingConsent,
  readAnalyticsConsent,
  synchronizeMarketingAnalytics,
  trackMarketingEvent,
  writeAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/marketingAnalytics";
import {
  metaMeasurementId,
  readMetaConsent,
  synchronizeMetaMeasurement,
  writeMetaConsent,
} from "@/lib/metaMarketing";
import styles from "./marketing-analytics.module.css";

type SavedChoices = {
  analytics: AnalyticsConsent | null;
  advertising: AnalyticsConsent | null;
  meta: AnalyticsConsent | null;
};
type Preferences = { analytics: boolean; advertising: boolean; meta: boolean };

function readChoices(): SavedChoices {
  return {
    analytics: readAnalyticsConsent(),
    advertising: readAdvertisingConsent(),
    meta: readMetaConsent(),
  };
}

function preferences(saved: SavedChoices): Preferences {
  return {
    analytics: saved.analytics === "granted",
    advertising: saved.analytics === "granted" && saved.advertising === "granted",
    meta: saved.meta === "granted",
  };
}

export function MarketingAnalytics() {
  const pathname = usePathname();
  const t = useTranslations("analyticsConsent");
  const id = useId();
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<SavedChoices>({
    analytics: null,
    advertising: null,
    meta: null,
  });
  const [draft, setDraft] = useState<Preferences>({
    analytics: false,
    advertising: false,
    meta: false,
  });
  const [blocked, setBlocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  const bannerRef = useRef<HTMLElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const applyingChoices = useRef(false);
  const synchronizedChoices = useRef<SavedChoices | null>(null);
  const synchronize = useRef<(() => void) | null>(null);
  const googleConfigured = Boolean(marketingMeasurementId());
  const metaConfigured = Boolean(metaMeasurementId());
  const configured = googleConfigured || metaConfigured;
  const pending = (googleConfigured && !saved.analytics) || (metaConfigured && !saved.meta);
  const showBanner = Boolean(
    configured && ready && publicMarketingPage(pathname) && !blocked && !dismissed && pending,
  );

  useEffect(() => {
    const sync = () => {
      // Complete a combined decision before synchronizing either provider.
      if (applyingChoices.current) return;
      const next = readChoices();
      const previous = synchronizedChoices.current;
      if (
        !previous ||
        previous.analytics !== next.analytics ||
        previous.advertising !== next.advertising ||
        previous.meta !== next.meta
      ) {
        setSaved(next);
        setDraft(preferences(next));
        synchronizedChoices.current = next;
      }
      setBlocked(analyticsPrivacyOptOut());
      synchronizeMarketingAnalytics(pathname);
      synchronizeMetaMeasurement(pathname);
      setReady(true);
    };
    synchronize.current = sync;
    sync();
    window.addEventListener("bazaar:analytics-consent", sync);
    window.addEventListener("bazaar:meta-consent", sync);
    window.addEventListener("storage", sync);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sync();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      synchronize.current = null;
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
      if (
        publicMarketingPage(window.location.pathname) &&
        anchor.protocol === "https:" &&
        anchor.hostname === "wa.me" &&
        anchor.pathname === "/996709911300"
      )
        trackMarketingEvent("contact_whatsapp_click");
      interceptPrivateMarketingLink(event);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [configured]);

  useEffect(() => {
    if (!showBanner || editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setDismissed(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showBanner, editing]);

  useEffect(() => {
    const banner = bannerRef.current;
    if (!showBanner || !banner) {
      setBannerHeight(0);
      return;
    }
    const measure = () => setBannerHeight(banner.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(banner);
    return () => observer?.disconnect();
  }, [showBanner]);

  if (!configured || !ready || !publicMarketingPage(pathname)) return null;
  if (blocked) {
    return pathname === "/privacy" ? (
      <p className={styles.browserChoice}>{t("browserChoice")}</p>
    ) : null;
  }

  const apply = (next: Preferences, all = false) => {
    const current = readChoices();
    const analytics = next.analytics ? "granted" : "denied";
    const advertising = next.analytics && next.advertising ? "granted" : "denied";
    const meta = next.meta ? "granted" : "denied";
    applyingChoices.current = true;
    try {
      if (
        googleConfigured &&
        (all || current.analytics !== analytics || current.advertising !== advertising)
      )
        writeAnalyticsConsent(analytics, advertising);
      if (metaConfigured && (all || current.meta !== meta)) writeMetaConsent(meta);
    } finally {
      applyingChoices.current = false;
      synchronize.current?.();
    }
    setEditing(false);
  };
  const openSettings = () => {
    setDraft(preferences(readChoices()));
    setEditing(true);
  };

  return (
    <Dialog
      open={editing}
      onOpenChange={(open) => {
        if (open) openSettings();
        else setEditing(false);
      }}
    >
      {showBanner ? (
        <aside ref={bannerRef} aria-label={t("bannerTitle")} className={styles.banner}>
          <div className={styles.inner}>
            <button
              type="button"
              aria-label={t("dismiss")}
              className={styles.dismiss}
              onClick={() => setDismissed(true)}
            >
              <CloseIcon aria-hidden className="h-4 w-4" />
            </button>
            <p className={styles.summary}>
              {t(
                googleConfigured && metaConfigured
                  ? "summary"
                  : googleConfigured
                    ? "googleSummary"
                    : "metaSummary",
              )}{" "}
              <button
                ref={settingsTriggerRef}
                type="button"
                className={styles.customize}
                onClick={openSettings}
              >
                {t("customize")}
              </button>
            </p>
            <div className={styles.actions}>
              <Button
                type="button"
                variant="outline"
                className={styles.choice}
                onClick={() => apply({ analytics: true, advertising: true, meta: true }, true)}
              >
                {t("acceptAll")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={styles.choice}
                onClick={() => apply({ analytics: false, advertising: false, meta: false }, true)}
              >
                {t("rejectAll")}
              </Button>
            </div>
          </div>
        </aside>
      ) : (
        <button
          ref={settingsTriggerRef}
          type="button"
          className={styles.reopen}
          onClick={openSettings}
        >
          {t("settings")}
        </button>
      )}
      {showBanner &&
        createPortal(<div aria-hidden="true" style={{ height: bannerHeight }} />, document.body)}
      <DialogContent
        size="sm"
        className={styles.settings}
        closeLabel={t("closeSettings")}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          settingsTriggerRef.current?.focus();
        }}
      >
        <div className={styles.settingsHeader}>
          <DialogTitle>{t("settingsTitle")}</DialogTitle>
          <DialogDescription>{t("settingsDescription")}</DialogDescription>
        </div>
        <DialogBody className={styles.settingsBody}>
          {googleConfigured && (
            <>
              <div className={styles.preference}>
                <div>
                  <label id={`${id}-statistics`} htmlFor={`${id}-statistics-switch`}>
                    {t("googleStatistics")}
                  </label>
                  <p id={`${id}-statistics-description`}>{t("googleStatisticsDescription")}</p>
                </div>
                <Switch
                  id={`${id}-statistics-switch`}
                  aria-labelledby={`${id}-statistics`}
                  aria-describedby={`${id}-statistics-description`}
                  checked={draft.analytics}
                  onCheckedChange={(analytics) =>
                    setDraft((value) => ({
                      ...value,
                      analytics,
                      advertising: analytics && value.advertising,
                    }))
                  }
                />
              </div>
              <div className={styles.preference}>
                <div>
                  <label id={`${id}-advertising`} htmlFor={`${id}-advertising-switch`}>
                    {t("googleAdvertising")}
                  </label>
                  <p id={`${id}-advertising-description`}>{t("googleAdvertisingDescription")}</p>
                </div>
                <Switch
                  id={`${id}-advertising-switch`}
                  aria-labelledby={`${id}-advertising`}
                  aria-describedby={`${id}-advertising-description`}
                  disabled={!draft.analytics}
                  checked={draft.advertising}
                  onCheckedChange={(advertising) =>
                    setDraft((value) => ({ ...value, advertising }))
                  }
                />
              </div>
            </>
          )}
          {metaConfigured && (
            <div className={styles.preference}>
              <div>
                <label id={`${id}-meta`} htmlFor={`${id}-meta-switch`}>
                  {t("metaAdvertising")}
                </label>
                <p id={`${id}-meta-description`}>{t("metaAdvertisingDescription")}</p>
              </div>
              <Switch
                id={`${id}-meta-switch`}
                aria-labelledby={`${id}-meta`}
                aria-describedby={`${id}-meta-description`}
                checked={draft.meta}
                onCheckedChange={(meta) => setDraft((value) => ({ ...value, meta }))}
              />
            </div>
          )}
        </DialogBody>
        <div className={styles.settingsFooter}>
          <div className={styles.actions}>
            <Button
              type="button"
              variant="outline"
              className={styles.choice}
              onClick={() => setEditing(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="button" className={styles.choice} onClick={() => apply(draft)}>
              {t("save")}
            </Button>
          </div>
          <Link href="/privacy" className={styles.privacy} onClick={() => setEditing(false)}>
            {t("privacy")}
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
