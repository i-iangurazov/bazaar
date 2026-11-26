import type { ReactNode } from "react";

import { ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export function MobileSaleProperty({ icon, label, value, onEdit, disabled }: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  onEdit?: () => void;
  disabled?: boolean;
}) {
  const layout = "flex min-h-12 w-full items-center gap-2 border-b border-border px-3 py-2 text-left last:border-b-0";
  const content = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 text-sm leading-snug">{label}</span>
      <span className={cn("min-w-0 max-w-[54%] break-words text-right text-sm font-medium leading-snug", onEdit ? "text-primary" : "text-foreground")}>
        {value}
      </span>
    </>
  );

  return onEdit ? (
    <button type="button" className={cn(layout, "button-focus-ring disabled:opacity-50")} onClick={onEdit} disabled={disabled}>
      {content}
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  ) : (
    <div className={layout}>{content}</div>
  );
}
