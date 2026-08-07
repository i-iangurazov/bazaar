"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { StatusWarningIcon } from "@/components/icons";
import {
  getConnectivityServerSnapshot,
  getConnectivitySnapshot,
  initializeNativeNetwork,
  subscribeConnectivity,
} from "@/lib/native/network";

export const PwaOfflineBanner = () => {
  const t = useTranslations("pwaStatus");
  const connectivity = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivityServerSnapshot,
  );

  useEffect(() => {
    let cleanup: () => void = () => undefined;
    let active = true;
    void initializeNativeNetwork().then((dispose) => {
      if (active) cleanup = dispose;
      else dispose();
    });
    return () => {
      active = false;
      cleanup();
    };
  }, []);

  if (connectivity.state === "online") {
    return null;
  }

  return (
    <div
      role="status"
      className="pwa-desktop-hidden fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[70] mx-auto max-w-xl border border-warning/40 bg-warning px-3 py-2 text-sm font-medium text-warning-foreground shadow-lg"
      data-pwa-offline-banner
    >
      <div className="flex items-start gap-2">
        <StatusWarningIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p>{t(connectivity.state === "reconnecting" ? "reconnectingTitle" : "offlineTitle")}</p>
          <p className="mt-0.5 text-xs font-normal leading-relaxed opacity-90">
            {t(
              connectivity.state === "reconnecting"
                ? "reconnectingDescription"
                : "offlineDescription",
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
