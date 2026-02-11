import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const SelectionToolbar = ({
  count,
  label,
  onClear,
  clearLabel,
  children,
}: {
  count: number;
  label: string;
  onClear?: () => void;
  clearLabel?: string;
  children?: ReactNode;
}) => (
  <div className="flex flex-col items-start gap-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-2 text-muted-foreground">
      <Badge variant="muted">{count}</Badge>
      <span>{label}</span>
    </div>
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
      {children}
      {onClear && clearLabel ? (
        <Button type="button" variant="secondary" size="sm" className="w-full sm:w-auto" onClick={onClear}>
          {clearLabel}
        </Button>
      ) : null}
    </div>
  </div>
);
