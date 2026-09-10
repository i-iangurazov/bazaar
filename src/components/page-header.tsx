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
      "flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&>*]:max-w-full",
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
  <header data-page-header className="mb-5 min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
      <div className="min-w-0 flex-1 basis-56">
        <PageBreadcrumbs />
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.875rem] md:leading-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action ? <PageHeaderActions className={actionClassName}>{action}</PageHeaderActions> : null}
    </div>
    {filters ? (
      <div
        data-page-filters
        className={cn("min-w-0 rounded-lg border border-border bg-card p-3", filtersClassName)}
      >
        <div className="flex min-w-0 flex-wrap items-end gap-3">{filters}</div>
      </div>
    ) : null}
  </header>
);
