import type { HTMLAttributes } from "react";
import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "danger" | "muted";

export const badgeVariants = cva(
  "es-badge inline-flex max-w-full items-center gap-1 rounded-full border border-transparent px-1.5 text-xs font-normal leading-5",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/10 text-warning",
        danger: "border-transparent bg-danger/10 text-danger",
        muted: "border-transparent bg-secondary text-muted-foreground",
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
