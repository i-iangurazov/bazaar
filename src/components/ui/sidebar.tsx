"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { useTranslations } from "next-intl";

import { MenuIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  state: "expanded" | "collapsed";
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export const SidebarProvider = ({
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  className,
  style,
  children,
}: {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      onOpenChange?.(nextOpen);
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }
    },
    [controlledOpen, onOpenChange],
  );
  const value = React.useMemo<SidebarContextValue>(
    () => ({
      open,
      setOpen,
      state: open ? "expanded" : "collapsed",
      toggleSidebar: () => setOpen(!open),
    }),
    [open, setOpen],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-sidebar-wrapper
        data-state={value.state}
        className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)}
        style={
          {
            "--sidebar-width": "16rem",
            "--sidebar-width-icon": "3.75rem",
            ...style,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider.");
  }
  return context;
};

export const Sidebar = React.forwardRef<
  HTMLElement,
  React.ComponentPropsWithoutRef<"aside"> & {
    collapsible?: "icon" | "none";
  }
>(({ className, collapsible = "icon", ...props }, ref) => {
  const { state } = useSidebar();
  return (
    <aside
      ref={ref}
      data-sidebar
      data-state={state}
      data-collapsible={collapsible}
      className={cn(
        "hidden min-h-svh shrink-0 border-r border-sidebar-border/80 bg-sidebar text-sidebar-foreground shadow-[18px_0_50px_rgba(15,23,42,0.08)] transition-[width] duration-200 md:flex md:flex-col dark:shadow-none",
        collapsible === "icon"
          ? "w-[var(--sidebar-width)] data-[state=collapsed]:w-[var(--sidebar-width-icon)]"
          : "w-[var(--sidebar-width)]",
        className,
      )}
      {...props}
    />
  );
});
Sidebar.displayName = "Sidebar";

export const SidebarInset = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("min-w-0 flex-1 bg-background", className)} {...props} />
  ),
);
SidebarInset.displayName = "SidebarInset";

export const SidebarHeader = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("shrink-0 border-b border-sidebar-border/70 p-3", className)}
    {...props}
  />
));
SidebarHeader.displayName = "SidebarHeader";

export const SidebarFooter = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("shrink-0 border-t border-sidebar-border/70 p-3", className)}
    {...props}
  />
));
SidebarFooter.displayName = "SidebarFooter";

export const SidebarContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("min-h-0 flex-1 overflow-y-auto p-3", className)} {...props} />
));
SidebarContent.displayName = "SidebarContent";

export const SidebarGroup = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("py-1.5 group-data-[state=collapsed]/sidebar-wrapper:py-0.5", className)}
      {...props}
    />
  ),
);
SidebarGroup.displayName = "SidebarGroup";

export const SidebarGroupLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div"> & { asChild?: boolean }
>(({ asChild = false, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      ref={ref}
      className={cn(
        "px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/45",
        "group-data-[state=collapsed]/sidebar-wrapper:sr-only",
        className,
      )}
      {...props}
    />
  );
});
SidebarGroupLabel.displayName = "SidebarGroupLabel";

export const SidebarGroupContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("space-y-1 group-data-[state=collapsed]/sidebar-wrapper:space-y-0.5", className)}
    {...props}
  />
));
SidebarGroupContent.displayName = "SidebarGroupContent";

export const SidebarMenu = React.forwardRef<HTMLUListElement, React.ComponentPropsWithoutRef<"ul">>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn("space-y-1", className)} {...props} />
  ),
);
SidebarMenu.displayName = "SidebarMenu";

export const SidebarMenuItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentPropsWithoutRef<"li">
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn("group/menu-item relative", className)} {...props} />
));
SidebarMenuItem.displayName = "SidebarMenuItem";

export const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
  }
>(({ asChild = false, isActive = false, className, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-active={isActive}
      className={cn(
        "button-focus-ring group/menu-button flex min-h-10 w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left text-sm font-semibold text-sidebar-foreground/80 transition hover:border-sidebar-border/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
        "data-[active=true]:border-sidebar-primary/30 data-[active=true]:bg-sidebar-primary/10 data-[active=true]:font-bold data-[active=true]:text-sidebar-primary",
        "group-data-[state=collapsed]/sidebar-wrapper:mx-auto group-data-[state=collapsed]/sidebar-wrapper:h-10 group-data-[state=collapsed]/sidebar-wrapper:w-10 group-data-[state=collapsed]/sidebar-wrapper:justify-center group-data-[state=collapsed]/sidebar-wrapper:rounded-lg group-data-[state=collapsed]/sidebar-wrapper:px-0 group-data-[state=collapsed]/sidebar-wrapper:[&>span]:sr-only [&>svg]:h-5 [&>svg]:w-5 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
});
SidebarMenuButton.displayName = "SidebarMenuButton";

export const SidebarMenuAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button">
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover/menu-item:opacity-100 peer-data-[active=true]/menu-button:opacity-100",
      className,
    )}
    {...props}
  />
));
SidebarMenuAction.displayName = "SidebarMenuAction";

export const SidebarMenuBadge = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "ml-auto rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[11px] font-semibold text-sidebar-accent-foreground",
      className,
    )}
    {...props}
  />
));
SidebarMenuBadge.displayName = "SidebarMenuBadge";

export const SidebarMenuSkeleton = ({ className }: { className?: string }) => (
  <div className={cn("flex items-center gap-3 px-2.5 py-2", className)}>
    <Skeleton className="h-4 w-4" />
    <Skeleton className="h-4 flex-1 group-data-[state=collapsed]/sidebar-wrapper:hidden" />
  </div>
);

export const SidebarTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, onClick, ...props }, ref) => {
  const { toggleSidebar } = useSidebar();
  const tCommon = useTranslations("common");
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      className={cn("text-sidebar-foreground", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          toggleSidebar();
        }
      }}
      {...props}
    >
      <MenuIcon className="h-4 w-4" aria-hidden />
      <span className="sr-only">{tCommon("toggleSidebar")}</span>
    </Button>
  );
});
SidebarTrigger.displayName = "SidebarTrigger";
