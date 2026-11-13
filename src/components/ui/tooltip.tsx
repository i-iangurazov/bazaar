"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";
import { useNativeCollisionPadding } from "@/hooks/useNativeCollisionPadding";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipTrigger = TooltipPrimitive.Trigger;

type TooltipProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;

export const Tooltip = ({ children, ...props }: TooltipProps) => (
  <TooltipPrimitive.Root {...props}>{children}</TooltipPrimitive.Root>
);

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding, ...props }, ref) => {
  const safeCollisionPadding = useNativeCollisionPadding(collisionPadding);
  return (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={safeCollisionPadding}
      className={cn(
        "es-tooltip relative z-[1200]",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = "TooltipContent";
