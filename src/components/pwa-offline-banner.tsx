"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { StatusWarningIcon } from "@/components/icons";

export const PwaOfflineBanner = () => {
  const t = useTranslations("pwaStatus");
  const [isOffline, setIsOffline] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const updateOnlineState = () => {
      setIsOffline(!navigator.onLine);
      setIsReady(true);
    };

    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  if (!isReady || !isOffline) {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[70] border border-warning/40 bg-warning px-3 py-2 text-sm font-medium text-warning-foreground shadow-lg md:hidden"
      data-pwa-offline-banner
    >
      <div className="flex items-start gap-2">
        <StatusWarningIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p>{t("offlineTitle")}</p>
          <p className="mt-0.5 text-xs font-normal leading-relaxed opacity-90">
            {t("offlineDescription")}
          </p>
        </div>
      </div>
    </div>
  );
};
