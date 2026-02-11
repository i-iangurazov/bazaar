"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CloseIcon, StatusDangerIcon, StatusSuccessIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

type ToastItem = {
  id: string;
  title?: string;
  description: string;
  variant?: ToastVariant;
  actionLabel?: string;
  actionHref?: string;
};

type ToastInput = Omit<ToastItem, "id">;

type ToastContextValue = {
  push: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const getToastIcon = (variant?: ToastVariant) => {
  if (variant === "error") {
    return StatusDangerIcon;
  }
  if (variant === "success") {
    return StatusSuccessIcon;
  }
  return null;
};

const generateId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const tCommon = useTranslations("common");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, number>());

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = generateId();
      setToasts((prev) => [...prev, { id, ...toast }]);
      const timer = window.setTimeout(() => remove(id), 5000);
      timersRef.current.set(id, timer);
    },
    [remove],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length ? (
        <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-3 sm:left-auto sm:right-6 sm:w-96">
          {toasts.map((toast) => {
            const Icon = getToastIcon(toast.variant);
            return (
              <div
                key={toast.id}
                role={toast.variant === "error" ? "alert" : "status"}
                className={cn(
                  "rounded-lg border bg-card p-4 shadow-lg",
                  toast.variant === "error"
                    ? "border-danger/40"
                    : toast.variant === "success"
                      ? "border-success/40"
                      : "border-border",
                )}
              >
                <div className="flex items-start gap-3">
                  {Icon ? (
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full",
                        toast.variant === "error"
                          ? "bg-danger/15 text-danger"
                          : "bg-success/15 text-success",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  ) : null}
                  <div className="flex-1 space-y-1">
                    {toast.title ? (
                      <p className="text-sm font-semibold text-foreground">{toast.title}</p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">{toast.description}</p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(toast.id)}
                        aria-label={tCommon("close")}
                      >
                        <CloseIcon className="h-4 w-4" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{tCommon("close")}</TooltipContent>
                  </Tooltip>
                </div>
                {toast.actionLabel && toast.actionHref ? (
                  <div className="mt-3">
                    <Button asChild variant="secondary">
                      <Link href={toast.actionHref}>{toast.actionLabel}</Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return {
    toast: ctx.push,
  };
};
