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
  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
    <div className="flex items-center gap-2 text-gray-600">
      <Badge variant="muted">{count}</Badge>
      <span>{label}</span>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {onClear && clearLabel ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          {clearLabel}
        </Button>
      ) : null}
    </div>
  </div>
);
