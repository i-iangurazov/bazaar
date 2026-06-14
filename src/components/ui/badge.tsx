import type { HTMLAttributes } from "react";
import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "danger" | "muted";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-foreground",
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/10 text-warning",
        danger: "border-danger/20 bg-danger/10 text-danger",
        muted: "border-border bg-muted text-muted-foreground",
      } satisfies Record<Variant, string>,
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const Badge = ({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant } & VariantProps<
    typeof badgeVariants
  >) => <span className={cn(badgeVariants({ variant }), className)} {...props} />;
