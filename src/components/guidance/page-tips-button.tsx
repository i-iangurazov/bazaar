"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import {
  GuidanceTipsTriggerButton,
  GuidanceTourTriggerButton,
} from "@/components/guidance/GuidanceButtons";
import { useGuidance } from "@/components/guidance/guidance-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export const PageTipsButton = () => {
  const t = useTranslations("guidance");
  const {
    role,
    pageTips,
    pageTours,
    completedTours,
    toursDisabled,
    activeTourId,
    focusTip,
    startTour,
    resetTour,
    setToursDisabled,
  } = useGuidance();
  const [open, setOpen] = useState(false);

  const hasGuidance = pageTips.length > 0 || pageTours.length > 0;
  const tipsCount = pageTips.length;

  const pageTour = useMemo(() => pageTours[0] ?? null, [pageTours]);
  const isTourCompleted = pageTour ? completedTours.has(pageTour.id) : false;
  const canResetTour = role === "ADMIN" || process.env.NODE_ENV !== "production";

  if (!hasGuidance) {
    return null;
  }

  return (
    <>
      <GuidanceTipsTriggerButton pendingCount={tipsCount} onClick={() => setOpen(true)} />

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t("tipsPanelTitle")}
        subtitle={t("tipsPanelSubtitle")}
        bodyClassName="space-y-4"
      >
        <div className="rounded-md border border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-ink">{t("disableToursLabel")}</p>
              <p className="text-xs text-gray-500">{t("disableToursHint")}</p>
            </div>
            <Switch
              checked={toursDisabled}
              onCheckedChange={(next) => {
                void setToursDisabled(next);
              }}
              aria-label={t("disableToursLabel")}
            />
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {pageTour ? (
            <div className="flex items-center gap-2">
              <Badge variant={isTourCompleted ? "success" : "warning"}>
                {isTourCompleted ? t("tourCompleted") : t("tourPending")}
              </Badge>
              {toursDisabled ? <Badge variant="default">{t("toursDisabledBadge")}</Badge> : null}
            </div>
          ) : (
            <div />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {pageTour && canResetTour ? (
              <Button
                type="button"
                variant="secondary"
                size="default"
                className="h-10 px-4 text-sm"
                onClick={() => {
                  void resetTour(pageTour.id);
                }}
              >
                {t("resetTour")}
              </Button>
            ) : null}
            {pageTour ? (
              <GuidanceTourTriggerButton
                label={activeTourId === pageTour.id ? t("tourRunning") : t("startTour")}
                onClick={() => {
                  startTour(pageTour.id);
                  setOpen(false);
                }}
                disabled={toursDisabled}
              />
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          {pageTips.map((tip) => (
            <div key={tip.id} className="rounded-md border border-gray-200 p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-ink">{t(tip.titleKey)}</p>
                <p className="text-xs text-gray-500">{t(tip.bodyKey)}</p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    focusTip(tip.id);
                    setOpen(false);
                  }}
                >
                  {t("showTip")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
};
