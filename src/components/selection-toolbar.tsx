import type { ReactNode } from "react";

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
  <div
    className="flex flex-col items-start gap-3 rounded-xl border border-primary/20 bg-primary/10 px-3 py-3 text-sm shadow-[0_12px_30px_hsl(var(--primary)/0.08)] sm:flex-row sm:items-center sm:justify-between"
    data-count={count}
    data-component="selection-toolbar"
  >
    <div className="flex items-center gap-2 whitespace-nowrap text-foreground">
      <span className="font-medium">{label}</span>
    </div>
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
      {children}
      {onClear && clearLabel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full sm:w-auto"
          onClick={onClear}
        >
          {clearLabel}
        </Button>
      ) : null}
    </div>
  </div>
);
