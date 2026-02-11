"use client";

import { useTranslations } from "next-intl";

import { CloseIcon, HelpIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const headerButtonClassName = "h-10 px-4 text-sm";

export const GuidanceTipsTriggerButton = ({
  pendingCount,
  onClick,
}: {
  pendingCount: number;
  onClick: () => void;
}) => {
  const t = useTranslations("guidance");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="relative h-10 w-10"
            onClick={onClick}
            aria-label={t("tipsButton")}
          >
            <HelpIcon className="h-4 w-4" aria-hidden />
            {pendingCount > 0 ? (
              <Badge
                variant="muted"
                className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] px-1.5 py-0 text-[10px] leading-4"
              >
                {pendingCount}
              </Badge>
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("tipsButton")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const GuidanceTourTriggerButton = ({
  label,
  onClick,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) => (
  <Button
    type="button"
    variant="secondary"
    size="default"
    className={cn(headerButtonClassName, className)}
    onClick={onClick}
    disabled={disabled}
  >
    <HelpIcon className="h-4 w-4" aria-hidden />
    <span>{label}</span>
  </Button>
);

export const GuidanceTourNavButtons = ({
  canGoBack,
  onBack,
  onNext,
  onSkip,
  nextLabel,
}: {
  canGoBack: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  nextLabel: string;
}) => {
  const t = useTranslations("guidance");

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button type="button" variant="ghost" size="default" className={headerButtonClassName} onClick={onSkip}>
        {t("skip")}
      </Button>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="default"
          className={headerButtonClassName}
          onClick={onBack}
          disabled={!canGoBack}
        >
          {t("back")}
        </Button>
        <Button type="button" size="default" className={headerButtonClassName} onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
};

export const GuidanceCloseButton = ({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="h-10 w-10"
    aria-label={label}
    onClick={onClick}
  >
    <CloseIcon className="h-4 w-4" aria-hidden />
  </Button>
);
