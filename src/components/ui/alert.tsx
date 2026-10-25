import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const alertVariants = cva("rounded-md border border-transparent px-3 py-2.5 text-sm", {
  variants: {
    variant: {
      default: "border-border bg-card text-card-foreground",
      info: "bg-info/10 text-foreground",
      success: "bg-success/10 text-foreground",
      warning: "bg-warning/10 text-foreground",
      destructive: "bg-danger/10 text-danger",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="status" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("font-semibold text-foreground", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";
