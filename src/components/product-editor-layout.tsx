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
      "-mb-6 min-h-[calc(100vh-3rem)] bg-transparent px-0 pb-[calc(var(--mobile-bottom-nav-height)+5.75rem)] pt-4 sm:-mx-6 sm:-mb-6 sm:px-6 sm:py-5 md:-my-6 lg:-mx-10 lg:-my-8 lg:px-10 lg:py-6",
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
  <div className="relative mb-5 overflow-hidden rounded-xl border border-border/65 bg-card/95 p-4 shadow-[0_18px_45px_rgba(15,23,42,0.07)] ring-1 ring-foreground/[0.015] backdrop-blur sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-5 dark:shadow-none">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
    <div className="min-w-0">
      {eyebrow ? (
        <div className="mb-1 flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h1>
    </div>
    {actions ? <div className="mt-3 flex shrink-0 items-center gap-2 sm:mt-0">{actions}</div> : null}
  </div>
);

export const ProductEditorSaveBar = ({
  label,
  actions,
}: {
  label: ReactNode;
  actions: ReactNode;
}) => (
  <div className="fixed inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height)+0.75rem)] z-30 rounded-xl border border-border/65 bg-card/95 p-2 text-card-foreground shadow-xl shadow-foreground/10 ring-1 ring-foreground/[0.03] backdrop-blur sm:sticky sm:inset-x-auto sm:bottom-auto sm:top-3 sm:z-10 sm:mb-4 sm:p-2">
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
      "overflow-hidden rounded-xl border border-border/65 bg-card/95 shadow-[0_14px_34px_rgba(15,23,42,0.055)] ring-1 ring-foreground/[0.015] dark:shadow-none",
      className,
    )}
  >
    {title || description || action ? (
      <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-muted/35 px-4 py-3 sm:px-5">
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
