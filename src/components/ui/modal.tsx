"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CloseIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export const Modal = ({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  className,
  headerClassName,
  bodyClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
}) => {
  const tCommon = useTranslations("common");
  const titleId = useId();
  const subtitleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    containerRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handler);
    };
  }, [open, onOpenChange]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        onClick={() => onOpenChange(false)}
        aria-label={tCommon("close")}
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[85dvh] w-[calc(100vw-24px)] max-w-lg flex-col rounded-lg bg-white shadow-xl",
          className,
        )}
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-100 bg-white p-6",
            headerClassName,
          )}
        >
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {title}
            </h2>
            {subtitle ? (
              <p id={subtitleId} className="text-sm text-gray-500">
                {subtitle}
              </p>
            ) : null}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                aria-label={tCommon("close")}
              >
                <CloseIcon className="h-4 w-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tCommon("close")}</TooltipContent>
          </Tooltip>
        </div>
        <div className={cn("flex-1 overflow-y-auto p-6", bodyClassName)}>{children}</div>
      </div>
    </div>
  );
};
