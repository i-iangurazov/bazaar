"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

const generateId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, number>());
  const elementsRef = useRef(new Map<string, HTMLDivElement>());
  const originsRef = useRef(new Map<string, HTMLElement>());
  const isPosCashierRoute = pathname === "/pos/sell" || pathname.endsWith("/pos/sell");

  const remove = useCallback((id: string) => {
    const origin = originsRef.current.get(id);
    const restoreFocus = elementsRef.current.get(id)?.contains(document.activeElement);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    elementsRef.current.delete(id);
    originsRef.current.delete(id);
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    if (restoreFocus && origin?.isConnected) {
      queueMicrotask(() => {
        if (origin.isConnected) origin.focus();
      });
    }
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const elements = elementsRef.current;
    const origins = originsRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      elements.clear();
      origins.clear();
    };
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = generateId();
      if (document.activeElement instanceof HTMLElement) {
        originsRef.current.set(id, document.activeElement);
      }
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
        <div
          className={cn(
            "fixed left-4 right-4 z-[1100] flex flex-col gap-3 sm:w-96",
            isPosCashierRoute
              ? "top-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
              : "bottom-4 sm:left-auto sm:right-6",
          )}
        >
          {toasts.map((toast) => {
            const Icon = getToastIcon(toast.variant);
            return (
              <div
                key={toast.id}
                ref={(element) => {
                  if (element) elementsRef.current.set(toast.id, element);
                  else elementsRef.current.delete(toast.id);
                }}
                role={toast.variant === "error" ? "alert" : "status"}
                data-type={toast.variant ?? "info"}
                className="es-toast w-full min-w-0 max-w-full"
              >
                {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                <div className="es-toast__content [overflow-wrap:anywhere]">
                  {toast.title ? <p className="es-toast__message">{toast.title}</p> : null}
                  <p className={toast.title ? "es-toast__description" : "es-toast__message"}>
                    {toast.description}
                  </p>
                  {toast.actionLabel && toast.actionHref ? (
                    <div className="es-toast__body">
                      <Link
                        className="es-toast__action button-focus-ring inline-flex max-w-full whitespace-normal text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={toast.actionHref}
                      >
                        {toast.actionLabel}
                      </Link>
                    </div>
                  ) : null}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="es-toast__close h-10 w-10 text-inherit hover:bg-transparent hover:text-inherit md:h-8 md:w-8"
                      onClick={() => remove(toast.id)}
                      aria-label={tCommon("close")}
                    >
                      <CloseIcon className="h-4 w-4" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tCommon("close")}</TooltipContent>
                </Tooltip>
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
