import type { HTMLAttributes } from "react";
import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const cardVariants = cva(
  "min-w-0 max-w-full rounded-xl border bg-card text-card-foreground shadow-sm dark:shadow-none",
  {
    variants: {
      variant: {
        default: "border-border",
        subtle: "border-border bg-muted/30",
        flat: "border-border/70 shadow-none ring-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const Card = ({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) => (
  <div className={cn(cardVariants({ variant }), className)} {...props} />
);

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-w-0 border-b border-border px-4 py-3.5 sm:px-5", className)} {...props} />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-base font-semibold tracking-tight", className)} {...props} />
);

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-w-0 px-4 py-4 sm:px-5", className)} {...props} />
);
