import type { ReactNode } from "react";

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
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description ? <p className="text-xs text-gray-500">{description}</p> : null}
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
