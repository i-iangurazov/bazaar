"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { useTranslations } from "next-intl";

import { CloseIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]", className)}
    {...props}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const sheetContentVariants = cva(
  "fixed z-50 flex flex-col overflow-hidden border-border bg-card text-card-foreground shadow-2xl focus:outline-none",
  {
    variants: {
      side: {
        right: "inset-y-0 right-0 h-full w-[min(34rem,calc(100vw-1rem))] border-l",
        left: "inset-y-0 left-0 h-full w-[min(34rem,calc(100vw-1rem))] border-r",
        bottom: "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-md border-t",
        fullscreen: "inset-0 h-[100dvh] w-screen border-0",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof sheetContentVariants> & {
      showClose?: boolean;
      closeLabel?: string;
    }
>(({ side, className, children, showClose = true, closeLabel, ...props }, ref) => {
  const tCommon = useTranslations("common");
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(sheetContentVariants({ side }), className)}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="button-focus-ring absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground shadow-sm transition hover:bg-secondary/80 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={closeLabel ?? tCommon("close")}
          >
            <CloseIcon className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = DialogPrimitive.Content.displayName;

export const SheetHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("shrink-0 border-b border-border px-5 py-4 pr-16 sm:px-6", className)}
      {...props}
    />
  ),
);
SheetHeader.displayName = "SheetHeader";

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export const SheetBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("min-h-0 flex-1 overflow-y-auto p-5 sm:p-6", className)}
      {...props}
    />
  ),
);
SheetBody.displayName = "SheetBody";

export const SheetFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "shrink-0 border-t border-border bg-card px-5 py-4 sm:px-6",
        "flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto",
        className,
      )}
      {...props}
    />
  ),
);
SheetFooter.displayName = "SheetFooter";
