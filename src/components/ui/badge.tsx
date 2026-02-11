import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "danger" | "muted";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground",
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-danger text-danger-foreground",
  muted: "bg-muted text-muted-foreground",
};

export const Badge = ({ className, variant = "default", ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
      variants[variant],
      className,
    )}
    {...props}
  />
);
