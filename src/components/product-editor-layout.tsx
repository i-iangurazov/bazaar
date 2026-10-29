import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const ProductEditorPage = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "min-w-0 bg-transparent pb-[calc(var(--mobile-bottom-nav-height)+5.75rem)] md:pb-6",
      className,
    )}
  >
    <div className="mx-auto w-full max-w-[1280px]">{children}</div>
  </div>
);

export const ProductEditorHeader = ({
  eyebrow,
  title,
  actions,
  saveBar,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  saveBar?: ReactNode;
}) => (
  <div
    data-product-editor-header
    className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3 bg-background py-1 md:sticky md:top-14 md:z-30 md:py-3"
  >
    <div className="min-w-0">
      {eyebrow ? (
        <div className="mb-1 flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <h1 className="break-words text-[22px] font-semibold leading-7 tracking-tight text-foreground">
        {title}
      </h1>
    </div>
    {actions || saveBar ? (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {actions}
        {saveBar}
      </div>
    ) : null}
  </div>
);

export const ProductEditorSaveBar = ({
  label,
  actions,
}: {
  label: ReactNode;
  actions: ReactNode;
}) => (
  <div
    data-baam-obstacle
    className="fixed inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height)+0.75rem)] z-30 rounded-lg border border-border bg-card p-2 text-card-foreground shadow-md md:static md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none"
  >
    <div className="flex min-h-10 w-full items-center justify-between gap-3 md:min-h-8">
      <div role="status" className="min-w-0 px-2 text-xs text-muted-foreground md:px-0">
        {label}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </div>
  </div>
);

export const ProductEditorGrid = ({ main, sidebar }: { main: ReactNode; sidebar?: ReactNode }) => (
  <div
    data-product-editor-document
    className={cn(
      "grid min-w-0 rounded-lg border border-border bg-card",
      sidebar && "lg:grid-cols-[minmax(0,1fr)_260px]",
    )}
  >
    <div className="min-w-0">{main}</div>
    {sidebar ? (
      <aside className="min-w-0 rounded-b-lg border-t border-border bg-muted/30 lg:rounded-b-none lg:rounded-r-lg lg:border-l lg:border-t-0">
        {sidebar}
      </aside>
    ) : null}
  </div>
);

export const ProductEditorCard = ({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) => (
  <section
    className={cn("min-w-0 border-b border-border px-4 py-5 last:border-b-0 sm:px-5", className)}
  >
    {title || description || action ? (
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {title ? <h2 className="text-sm font-medium text-foreground">{title}</h2> : null}
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    ) : null}
    <div className={cn("space-y-4", contentClassName)}>{children}</div>
  </section>
);

export const ProductEditorFieldGrid = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</div>;
