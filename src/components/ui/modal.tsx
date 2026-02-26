"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
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
  usePortal = false,
  mobileSheet = false,
  animated = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  usePortal?: boolean;
  mobileSheet?: boolean;
  animated?: boolean;
}) => {
  const tCommon = useTranslations("common");
  const titleId = useId();
  const subtitleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    if (!animated) {
      setEntered(true);
      return;
    }
    const id = requestAnimationFrame(() => {
      setEntered(true);
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [animated, open]);

  if (!open) {
    return null;
  }

  const content = (
    <div
      className={cn(
        "fixed inset-0 z-50 overflow-hidden",
        mobileSheet
          ? "flex items-end justify-center px-0 py-0 sm:grid sm:place-items-center sm:px-4 sm:py-6"
          : "grid place-items-center px-3 py-4 sm:px-4 sm:py-6",
      )}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 z-0 bg-black/40 backdrop-blur-[1px]",
          animated && "transition-opacity duration-200",
          animated && (entered ? "opacity-100" : "opacity-0"),
        )}
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
          "relative z-10 flex w-full flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-2xl",
          mobileSheet
            ? "max-h-[90dvh] rounded-t-2xl border-b-0 sm:max-h-[85dvh] sm:rounded-xl sm:border-b"
            : "max-h-[85dvh] max-w-lg rounded-xl",
          animated && "transition-all duration-250 ease-out will-change-transform",
          animated &&
            (mobileSheet
              ? entered
                ? "translate-y-0 opacity-100"
                : "translate-y-10 opacity-0 sm:translate-y-4"
              : entered
                ? "scale-100 opacity-100"
                : "scale-95 opacity-0"),
          className,
        )}
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex items-start justify-between gap-4 rounded-t-xl border-b border-border bg-card p-6",
            headerClassName,
          )}
        >
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              {title}
            </h2>
            {subtitle ? (
              <p id={subtitleId} className="text-sm text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label={tCommon("close")}
            title={tCommon("close")}
          >
            <CloseIcon className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className={cn("flex-1 overflow-y-auto bg-card p-6", bodyClassName)}>{children}</div>
      </div>
    </div>
  );

  if (usePortal && typeof document !== "undefined") {
    return createPortal(content, document.body);
  }

  return content;
};
