"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export const Tabs = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("es-tabs space-y-4", className)} {...props} />
  ),
);
Tabs.displayName = "Tabs";

export const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, role = "tablist", onKeyDown, ...props }, ref) => (
    <div
      ref={ref}
      role={role}
      className={cn(
        "es-tabs__list flex items-center gap-5 border-b border-border bg-transparent px-0 py-0",
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        const current =
          event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
        if (!current || current.closest('[role="tablist"]') !== event.currentTarget) return;
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
        ).filter((tab) => tab.closest('[role="tablist"]') === event.currentTarget);
        const index = tabs.indexOf(current as HTMLButtonElement);
        const vertical = event.currentTarget.getAttribute("aria-orientation") === "vertical";
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
        const nextKey = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
        const previousKey = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
        let next: HTMLButtonElement | undefined;
        if (event.key === "Home") next = tabs[0];
        else if (event.key === "End") next = tabs[tabs.length - 1];
        else if (event.key === nextKey) next = tabs[(index + 1) % tabs.length];
        else if (event.key === previousKey) next = tabs[(index - 1 + tabs.length) % tabs.length];
        if (!next) return;
        event.preventDefault();
        next.focus();
        next.click();
      }}
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
      tabIndex,
      ...props
    },
    ref,
  ) => {
    const selected = ariaSelected ?? active;
    const isActive = selected === true || selected === "true";
    return (
      <button
        ref={ref}
        type={type}
        role={role}
        aria-selected={isActive}
        data-state={isActive ? "active" : "inactive"}
        tabIndex={tabIndex ?? (isActive ? 0 : -1)}
        className={cn(
          "es-tabs__tab relative inline-flex min-h-10 shrink-0 items-center justify-center border-b-2 border-transparent px-0 text-sm font-medium text-muted-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
          isActive
            ? "border-primary bg-transparent text-primary shadow-none"
            : "hover:text-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";

export const TabsPanel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, role = "tabpanel", ...props }, ref) => (
    <div ref={ref} role={role} className={cn("rounded-md", className)} {...props} />
  ),
);
TabsPanel.displayName = "TabsPanel";
