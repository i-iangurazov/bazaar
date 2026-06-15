import type { HTMLAttributes } from "react";
import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const cardVariants = cva(
  "min-w-0 max-w-full rounded-xl border bg-card text-card-foreground shadow-[0_16px_42px_rgba(15,23,42,0.06)] ring-1 ring-foreground/[0.015] dark:shadow-none",
  {
    variants: {
      variant: {
        default: "border-border/70",
        subtle: "border-border/55 bg-card/90",
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
  <div
    className={cn("border-b border-border/65 px-4 py-4 sm:px-6 sm:py-5", className)}
    {...props}
  />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-lg font-bold tracking-tight", className)} {...props} />
);

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-4 py-4 sm:px-6 sm:py-5", className)} {...props} />
);
