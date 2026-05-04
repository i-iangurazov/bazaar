import * as React from "react";

import { cn } from "@/lib/utils";

export const PopoverSurface = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-none border border-border bg-popover p-3 text-popover-foreground shadow-lg",
      className,
    )}
    {...props}
  />
));
PopoverSurface.displayName = "PopoverSurface";

export const PopoverSection = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("border-b border-border py-2 last:border-b-0", className)}
    {...props}
  />
));
PopoverSection.displayName = "PopoverSection";
