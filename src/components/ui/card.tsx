import type { HTMLAttributes } from "react";
import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const cardVariants = cva("rounded-md border bg-card text-card-foreground shadow-sm", {
  variants: {
    variant: {
      default: "border-border",
      subtle: "border-border/70 bg-card/80",
      flat: "border-border shadow-none",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export const Card = ({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) => (
  <div className={cn(cardVariants({ variant }), className)} {...props} />
);

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("border-b border-border px-4 py-4 sm:px-6 sm:py-6", className)} {...props} />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-lg font-semibold", className)} {...props} />
);

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-4 py-4 sm:px-6 sm:py-6", className)} {...props} />
);
