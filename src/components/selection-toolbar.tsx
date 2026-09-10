import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export const SelectionToolbar = ({
  count,
  label,
  onClear,
  clearLabel,
  scopeLabel,
  children,
}: {
  count: number;
  label: string;
  onClear?: () => void;
  clearLabel?: string;
  scopeLabel?: string;
  children?: ReactNode;
}) => (
  <div
    className="flex flex-col items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
    data-count={count}
    data-component="selection-toolbar"
  >
    <div className="min-w-0 text-foreground" role="status" aria-live="polite">
      <span className="font-medium">{label}</span>
      {scopeLabel ? (
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{scopeLabel}</p>
      ) : null}
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
