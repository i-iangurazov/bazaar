import type { ReactNode } from "react";
import React from "react";

import { cn } from "@/lib/utils";

export const EmptyState = ({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex min-h-[12rem] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background p-6 text-center",
      className,
    )}
  >
    {icon ? <div className="mb-3 text-muted-foreground">{icon}</div> : null}
    {title ? <p className="text-sm font-semibold text-foreground">{title}</p> : null}
    {description ? (
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    ) : null}
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);
