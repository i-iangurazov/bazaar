"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-none border border-border bg-secondary transition-colors data-[state=checked]:border-primary/60 data-[state=checked]:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 translate-x-1 rounded-none border border-border bg-muted-foreground/70 shadow-sm transition-colors transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
      )}
    />
  </SwitchPrimitive.Root>
));

Switch.displayName = "Switch";
