import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const FormSection = ({
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) => (
  <section className={cn("space-y-2 sm:space-y-3", className)}>
    {title ? (
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
    ) : null}
    <div className={cn("space-y-3 sm:space-y-4", contentClassName)}>{children}</div>
  </section>
);

export const FormGrid = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-2", className)}>{children}</div>;

export const Field = ({
  label,
  helper,
  error,
  children,
  className,
  labelClassName,
}: {
  label?: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}) => (
  <div className={cn("flex flex-col gap-1.5", className)}>
    {label ? <Label className={cn("text-xs text-muted-foreground", labelClassName)}>{label}</Label> : null}
    {children}
    {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
    {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
  </div>
);

export const FormStack = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => <div className={cn("flex flex-col gap-3 sm:gap-4", className)}>{children}</div>;

export const FormRow = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => <div className={cn("flex items-end gap-2", className)}>{children}</div>;

export const FormActions = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => (
  <div className={cn("flex flex-wrap justify-end gap-2 pt-2", className)}>
    {children}
  </div>
);
