import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const PageHeaderActions = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
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
      <div>
        <h2 className="text-2xl font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {action ? <PageHeaderActions>{action}</PageHeaderActions> : null}
    </div>
    {filters ? <div className="flex flex-wrap gap-3">{filters}</div> : null}
  </div>
);
