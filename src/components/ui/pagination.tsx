import * as React from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Pagination = React.forwardRef<HTMLElement, React.ComponentProps<"nav">>(
  ({ className, "aria-label": ariaLabel = "pagination", ...props }, ref) => (
    <nav
      ref={ref}
      aria-label={ariaLabel}
      className={cn("flex w-full items-center justify-between gap-2", className)}
      {...props}
    />
  ),
);
Pagination.displayName = "Pagination";

export const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<"ul">>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn("flex flex-wrap items-center gap-2", className)} {...props} />
  ),
);
PaginationContent.displayName = "PaginationContent";

export const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<"li">>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn("", className)} {...props} />,
);
PaginationItem.displayName = "PaginationItem";

export const PaginationLink = React.forwardRef<
  HTMLAnchorElement,
  React.ComponentProps<"a"> & {
    isActive?: boolean;
  }
>(({ className, isActive, ...props }, ref) => (
  <a
    ref={ref}
    aria-current={isActive ? "page" : undefined}
    className={cn(
      buttonVariants({ variant: isActive ? "secondary" : "ghost", size: "sm" }),
      "min-w-9",
      className,
    )}
    {...props}
  />
));
PaginationLink.displayName = "PaginationLink";

export const PaginationButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, variant = "secondary", size = "icon", ...props }, ref) => (
  <Button
    ref={ref}
    variant={variant}
    size={size}
    className={cn("h-10 w-10 sm:h-8 sm:w-8", className)}
    {...props}
  />
));
PaginationButton.displayName = "PaginationButton";
