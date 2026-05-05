"use client";

import React from "react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { InstallAppIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { usePwaInstall } from "@/hooks/usePwaInstall";

type GuidanceMode = "ios" | "safari" | "unsupported" | "browser";

export const PwaInstallButton = () => {
  const t = useTranslations("pwaInstall");
  const [guidanceMode, setGuidanceMode] = useState<GuidanceMode | null>(null);
  const { toast } = useToast();
  const {
    canPrompt,
    isInstalled,
    isIOS,
    isSafari,
    isUnsupported,
    isSecureInstallContext,
    isReady,
    promptInstall,
  } = usePwaInstall();

  if (!isReady || isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (canPrompt) {
      const result = await promptInstall();
      if (result.outcome === "accepted") {
        toast({ variant: "success", description: t("installedToast") });
      } else if (result.outcome === "unavailable") {
        setGuidanceMode("browser");
      }
      return;
    }

    if (isUnsupported || !isSecureInstallContext) {
      setGuidanceMode("unsupported");
      return;
    }

    if (isIOS) {
      setGuidanceMode("ios");
      return;
    }

    if (isSafari) {
      setGuidanceMode("safari");
      return;
    }

    setGuidanceMode("browser");
  };

  const title =
    guidanceMode === "ios"
      ? t("ios.title")
      : guidanceMode === "safari"
        ? t("safari.title")
      : guidanceMode === "unsupported"
        ? t("unsupported.title")
        : t("browser.title");
  const subtitle =
    guidanceMode === "ios"
      ? t("ios.subtitle")
      : guidanceMode === "safari"
        ? t("safari.subtitle")
      : guidanceMode === "unsupported"
        ? t("unsupported.subtitle")
        : t("browser.subtitle");

  const iosSteps = [
    t("ios.steps.openSafari"),
    t("ios.steps.tapShare"),
    t("ios.steps.addToHome"),
    t("ios.steps.confirm"),
  ];
  const safariSteps = [
    t("safari.steps.openSafari"),
    t("safari.steps.openShare"),
    t("safari.steps.add"),
    t("safari.steps.confirm"),
  ];

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="h-10 w-10"
        onClick={handleInstallClick}
        aria-label={t("buttonLabel")}
        title={t("buttonLabel")}
      >
        <InstallAppIcon className="h-4 w-4" aria-hidden />
      </Button>

      <Modal
        open={guidanceMode !== null}
        onOpenChange={(open) => setGuidanceMode(open ? guidanceMode : null)}
        title={title}
        subtitle={subtitle}
        className="max-w-md"
        headerClassName="p-4 sm:p-6"
        bodyClassName="p-4 sm:p-6"
        usePortal
        mobileSheet
        animated
      >
        {guidanceMode === "ios" || guidanceMode === "safari" ? (
          <ol className="space-y-3 text-sm text-muted-foreground">
            {(guidanceMode === "ios" ? iosSteps : safariSteps).map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-border bg-secondary text-xs font-semibold text-foreground">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              {guidanceMode === "unsupported"
                ? t("unsupported.body")
                : t("browser.body")}
            </p>
            {!isSecureInstallContext ? <p>{t("unsupported.httpsRequired")}</p> : null}
          </div>
        )}
      </Modal>
    </>
  );
};
