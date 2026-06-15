import type { ReactNode } from "react";

import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { cn } from "@/lib/utils";

export const PageHeaderActions = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex w-full flex-wrap items-stretch gap-2 sm:w-auto sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto",
      className,
    )}
  >
    {children}
  </div>
);

export const PageHeader = ({
  title,
  subtitle,
  action,
  filters,
  actionClassName,
  filtersClassName,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  filters?: ReactNode;
  actionClassName?: string;
  filtersClassName?: string;
}) => (
  <div className="relative mb-6 overflow-hidden rounded-xl border border-border/65 bg-card/95 p-4 shadow-[0_18px_45px_rgba(15,23,42,0.07)] ring-1 ring-foreground/[0.015] backdrop-blur md:p-5 dark:shadow-none">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
    <div className="pointer-events-none absolute -right-16 -top-24 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
    <div className="relative space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <PageBreadcrumbs />
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {action ? (
          <PageHeaderActions className={actionClassName}>{action}</PageHeaderActions>
        ) : null}
      </div>
      {filters ? (
        <div
          className={cn(
            "rounded-xl border border-border/65 bg-muted/45 p-3 shadow-inner shadow-foreground/[0.015]",
            filtersClassName,
          )}
        >
          <div className="flex flex-wrap gap-3">{filters}</div>
        </div>
      ) : null}
    </div>
  </div>
);
