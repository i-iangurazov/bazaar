import * as React from "react";

import { cn } from "@/lib/utils";

export const Tabs = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("space-y-4", className)} {...props} />
  ),
);
Tabs.displayName = "Tabs";

export const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, role = "tablist", ...props }, ref) => (
    <div
      ref={ref}
      role={role}
      className={cn(
        "inline-flex items-center gap-1 rounded-none border border-border bg-secondary/50 p-1",
        className,
      )}
      {...props}
    />
  ),
);
TabsList.displayName = "TabsList";

type TabsTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  (
    {
      active = false,
      className,
      type = "button",
      role = "tab",
      "aria-selected": ariaSelected,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      role={role}
      aria-selected={ariaSelected ?? active}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-none px-3 text-sm font-semibold text-muted-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        active
          ? "bg-background text-foreground shadow-sm"
          : "hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    />
  ),
);
TabsTrigger.displayName = "TabsTrigger";

export const TabsPanel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, role = "tabpanel", ...props }, ref) => (
    <div ref={ref} role={role} className={cn("rounded-none", className)} {...props} />
  ),
);
TabsPanel.displayName = "TabsPanel";
