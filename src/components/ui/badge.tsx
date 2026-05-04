import type { HTMLAttributes } from "react";
import React from "react";

import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "danger" | "muted";

const variants: Record<Variant, string> = {
  default: "border-border bg-muted text-foreground",
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/20 bg-danger/10 text-danger",
  muted: "border-border bg-muted text-muted-foreground",
};

export const Badge = ({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-none border px-2 py-0.5 text-xs font-medium",
      variants[variant],
      className,
    )}
    {...props}
  />
);
