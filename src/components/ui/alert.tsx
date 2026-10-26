import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const alertVariants = cva("es-alert block", {
  variants: {
    variant: {
      default: "",
      info: "",
      success: "",
      warning: "",
      destructive: "",
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
  <div
    ref={ref}
    role="status"
    data-theme={
      variant === "info"
        ? "blue"
        : variant === "success"
          ? "green"
          : variant === "warning"
            ? "yellow"
            : variant === "destructive"
              ? "red"
              : undefined
    }
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("es-alert__title", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("es-alert__description", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";
