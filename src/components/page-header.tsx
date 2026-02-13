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
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  filters?: ReactNode;
}) => (
  <div className="mb-8 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <PageBreadcrumbs />
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <PageHeaderActions>{action}</PageHeaderActions> : null}
    </div>
    {filters ? <div className="flex flex-wrap gap-3">{filters}</div> : null}
  </div>
);
