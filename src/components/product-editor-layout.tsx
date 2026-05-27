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
      "-mb-6 min-h-[calc(100vh-3rem)] bg-muted px-0 pb-[calc(var(--mobile-bottom-nav-height)+5.5rem)] pt-4 sm:-mx-6 sm:-mb-6 sm:px-6 sm:py-5 md:-my-6 lg:-mx-10 lg:-my-8 lg:px-10 lg:py-6",
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
  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      {eyebrow ? (
        <div className="mb-1 flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <h1 className="truncate text-xl font-semibold text-foreground sm:text-2xl">{title}</h1>
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>
);

export const ProductEditorSaveBar = ({
  label,
  actions,
}: {
  label: ReactNode;
  actions: ReactNode;
}) => (
  <div className="fixed inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height)+0.5rem)] z-30 rounded-lg border border-foreground/10 bg-foreground p-1.5 text-background shadow-[0_-4px_14px_rgba(15,23,42,0.1)] sm:sticky sm:inset-x-auto sm:bottom-auto sm:top-3 sm:z-10 sm:mb-4 sm:rounded-lg sm:border sm:p-1.5 sm:shadow-[0_4px_14px_rgba(15,23,42,0.1)] dark:border-border dark:bg-card dark:text-card-foreground">
    <div className="mx-auto flex min-h-10 w-full max-w-[1120px] items-center justify-between gap-3 sm:min-h-9 sm:max-w-none">
      <div className="min-w-0 truncate px-2 text-sm font-medium">{label}</div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </div>
  </div>
);

export const ProductEditorGrid = ({ main, sidebar }: { main: ReactNode; sidebar?: ReactNode }) => (
  <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
    <div className="min-w-0 space-y-3 sm:space-y-4">{main}</div>
    {sidebar ? (
      <aside className="min-w-0 space-y-3 sm:space-y-4 lg:sticky lg:top-20">{sidebar}</aside>
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
      "rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
      className,
    )}
  >
    {title || description || action ? (
      <div className="flex items-start justify-between gap-3 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="min-w-0">
          {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    ) : null}
    <div
      className={cn(
        "space-y-3 p-3 sm:space-y-4 sm:p-4",
        title || description || action ? "pt-3" : "",
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
}) => <div className={cn("grid gap-3 sm:grid-cols-2", className)}>{children}</div>;
