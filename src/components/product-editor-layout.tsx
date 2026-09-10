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
    <div className="mx-auto w-full max-w-[1120px]">{children}</div>
  </div>
);

export const ProductEditorHeader = ({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) => (
  <div className="mb-5 min-w-0 sm:flex sm:items-center sm:justify-between sm:gap-4">
    <div className="min-w-0">
      {eyebrow ? (
        <div className="mb-1 flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h1>
    </div>
    {actions ? (
      <div className="mt-3 flex shrink-0 items-center gap-2 sm:mt-0">{actions}</div>
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
    className="fixed inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height)+0.75rem)] z-30 rounded-xl border border-border bg-card p-2 text-card-foreground shadow-md sm:sticky sm:inset-x-auto sm:bottom-auto sm:top-3 sm:z-10 sm:mb-4 sm:p-2"
  >
    <div className="mx-auto flex min-h-10 w-full max-w-[1120px] items-center justify-between gap-3 sm:min-h-9 sm:max-w-none">
      <div className="min-w-0 truncate px-2 text-sm font-semibold text-foreground">{label}</div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </div>
  </div>
);

export const ProductEditorGrid = ({ main, sidebar }: { main: ReactNode; sidebar?: ReactNode }) => (
  <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
    <div className="min-w-0 space-y-4 sm:space-y-5">{main}</div>
    {sidebar ? (
      <aside className="min-w-0 space-y-4 sm:space-y-5 lg:sticky lg:top-20">{sidebar}</aside>
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
    className={cn(
      "min-w-0 rounded-xl border border-border bg-card shadow-sm dark:shadow-none",
      className,
    )}
  >
    {title || description || action ? (
      <div className="flex items-start justify-between gap-3 rounded-t-xl border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          {title ? (
            <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          ) : null}
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    ) : null}
    <div
      className={cn(
        "space-y-4 p-4 sm:space-y-5 sm:p-5",
        title || description || action ? "pt-4" : "",
        contentClassName,
      )}
    >
      {children}
    </div>
  </section>
);

export const ProductEditorFieldGrid = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</div>;
