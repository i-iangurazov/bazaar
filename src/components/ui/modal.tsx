"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import React, { useRef } from "react";
import { useTranslations } from "next-intl";

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
  usePortal = true,
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
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const content = (
    <>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-[1000] bg-black/40 backdrop-blur-[1px]",
          animated &&
            "transition-opacity duration-200 data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
        )}
      />
      <DialogPrimitive.Content
        {...(subtitle ? {} : { "aria-describedby": undefined })}
        onOpenAutoFocus={() => {
          previouslyFocusedRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const previouslyFocused = previouslyFocusedRef.current;
          previouslyFocusedRef.current = null;
          queueMicrotask(() => {
            if (previouslyFocused?.isConnected) {
              previouslyFocused.focus();
            }
          });
        }}
        className={cn(
          "fixed z-[1001] flex w-[calc(100vw-1.5rem)] flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-2xl focus:outline-none",
          mobileSheet
            ? "bottom-0 left-0 right-0 max-h-[90dvh] w-full rounded-md border-b-0 sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:max-h-[85dvh] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:border-b"
            : "left-1/2 top-1/2 max-h-[85dvh] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-md",
          animated && "duration-250 transition-all ease-out will-change-transform",
          animated &&
            (mobileSheet
              ? "data-[state=closed]:translate-y-10 data-[state=open]:translate-y-0 data-[state=closed]:opacity-0 data-[state=open]:opacity-100 sm:data-[state=closed]:translate-y-4"
              : "data-[state=closed]:scale-95 data-[state=open]:scale-100 data-[state=closed]:opacity-0 data-[state=open]:opacity-100"),
          className,
        )}
      >
        <div
          className={cn(
            "sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card p-6",
            headerClassName,
          )}
        >
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
              {title}
            </DialogPrimitive.Title>
            {subtitle ? (
              <DialogPrimitive.Description
                className="text-sm text-muted-foreground"
              >
                {subtitle}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={tCommon("close")}
              title={tCommon("close")}
            >
              <CloseIcon className="h-4 w-4" aria-hidden />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className={cn("flex-1 overflow-y-auto bg-card p-6", bodyClassName)}>{children}</div>
      </DialogPrimitive.Content>
    </>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {usePortal ? <DialogPrimitive.Portal>{content}</DialogPrimitive.Portal> : content}
    </DialogPrimitive.Root>
  );
};

export const ModalFooter = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto",
      className,
    )}
  >
    {children}
  </div>
);
