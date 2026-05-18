"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";

import { PageTipsButton } from "@/components/guidance/page-tips-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { SignOutButton } from "@/components/signout-button";
import { Button } from "@/components/ui/button";
import { CloseIcon, MoreIcon, UserIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type MobileShellNavItem = {
  key: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
  description?: string;
};

type MobileAppShellProps = {
  pageTitle: string;
  storeName?: string | null;
  statusLabel?: string | null;
  bottomItems: MobileShellNavItem[];
  moreItems: MobileShellNavItem[];
  moreLabel: string;
  profileLabel?: string;
  closeLabel?: string;
  navigationLabel?: string;
  showTopBar?: boolean;
};

type MobileTopBarProps = {
  pageTitle: string;
  storeName?: string | null;
  statusLabel?: string | null;
  profileLabel: string;
  moreLabel: string;
  onOpenMore: () => void;
};

type MobileBottomNavProps = {
  items: MobileShellNavItem[];
  moreLabel: string;
  navigationLabel: string;
  moreActive: boolean;
  onOpenMore: () => void;
};

type MobileMoreMenuProps = {
  open: boolean;
  items: MobileShellNavItem[];
  title: string;
  closeLabel: string;
  onClose: () => void;
};

type MobilePageContainerProps = {
  children: ReactNode;
  className?: string;
};

type MobileQuickActionButtonProps = {
  href: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  description?: string;
  variant?: "primary" | "secondary" | "warning";
  className?: string;
};

type MobileTaskCardProps = {
  label: string;
  value?: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  href?: string;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
};

export const MobileAppShell = ({
  pageTitle,
  storeName,
  statusLabel,
  bottomItems,
  moreItems,
  moreLabel,
  profileLabel = "Profile",
  closeLabel = "Close",
  navigationLabel = "Mobile navigation",
  showTopBar = true,
}: MobileAppShellProps) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = useMemo(() => moreItems.some((item) => item.active), [moreItems]);

  return (
    <>
      {showTopBar ? (
        <MobileTopBar
          pageTitle={pageTitle}
          storeName={storeName}
          statusLabel={statusLabel}
          profileLabel={profileLabel}
          moreLabel={moreLabel}
          onOpenMore={() => setMoreOpen(true)}
        />
      ) : null}
      <MobileBottomNav
        items={bottomItems}
        moreLabel={moreLabel}
        navigationLabel={navigationLabel}
        moreActive={moreActive}
        onOpenMore={() => setMoreOpen(true)}
      />
      <MobileMoreMenu
        open={moreOpen}
        items={moreItems}
        title={moreLabel}
        closeLabel={closeLabel}
        onClose={() => setMoreOpen(false)}
      />
    </>
  );
};

export const MobileTopBar = ({
  pageTitle,
  storeName,
  statusLabel,
  profileLabel,
  moreLabel,
  onOpenMore,
}: MobileTopBarProps) => (
  <header
    className="sticky top-0 z-40 border-b border-border bg-background/95 px-4 pb-3 pt-3 shadow-sm backdrop-blur md:hidden"
    style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
  >
    <div className="flex min-h-11 items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {storeName ?? "BAZAAR"}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          <h1 className="truncate text-base font-semibold text-foreground">{pageTitle}</h1>
          {statusLabel ? (
            <span className="shrink-0 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
              {statusLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <PageTipsButton />
        <PwaInstallButton />
        <Link
          href="/settings/profile"
          className="button-focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={profileLabel}
        >
          <UserIcon className="h-4 w-4" aria-hidden />
        </Link>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-11 w-11"
          onClick={onOpenMore}
          aria-label={moreLabel}
        >
          <MoreIcon className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  </header>
);

export const MobileBottomNav = ({
  items,
  moreLabel,
  navigationLabel,
  moreActive,
  onOpenMore,
}: MobileBottomNavProps) => (
  <nav
    className="fixed inset-x-2 bottom-2 z-40 rounded-md border border-border bg-background/95 px-2 pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden"
    style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    aria-label={navigationLabel}
  >
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${Math.max(items.length + 1, 1)}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <MobileBottomNavLink key={item.key} item={item} />
      ))}
      <button
        type="button"
        className={cn(
          "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-1 text-[11px] font-semibold transition",
          moreActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
        onClick={onOpenMore}
        aria-current={moreActive ? "page" : undefined}
      >
        <MoreIcon className="h-4 w-4" aria-hidden />
        <span className="w-full truncate text-center">{moreLabel}</span>
      </button>
    </div>
  </nav>
);

const MobileBottomNavLink = ({ item }: { item: MobileShellNavItem }) => (
  <Link
    href={item.href}
    className={cn(
      "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-1 text-[11px] font-semibold no-underline transition hover:no-underline",
      item.active
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
    )}
    aria-current={item.active ? "page" : undefined}
  >
    <item.icon className="h-4 w-4" aria-hidden />
    <span className="w-full truncate text-center">{item.label}</span>
  </Link>
);

export const MobileMoreMenu = ({
  open,
  items,
  title,
  closeLabel,
  onClose,
}: MobileMoreMenuProps) => {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/30 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
        aria-label={closeLabel}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-md border-t border-border bg-background shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <CloseIcon className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="grid gap-2 px-4 py-4">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold no-underline transition hover:border-primary/40 hover:bg-accent hover:no-underline",
                item.active && "border-primary/40 bg-primary/10 text-primary",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate">{item.label}</span>
                {item.description ? (
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {item.description}
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>

        <div className="space-y-3 border-t border-border px-4 py-4">
          <div className="flex min-h-12 items-center justify-center rounded-md border border-border bg-card px-3 py-2">
            <LanguageSwitcher
              compact
              className="border-0 bg-transparent p-0 shadow-none"
              inactiveButtonClassName="bg-secondary"
            />
          </div>
          <PwaInstallButton presentation="card" />
          <SignOutButton />
        </div>
        <div style={{ height: "max(1rem, env(safe-area-inset-bottom))" }} />
      </section>
    </div>
  );
};

export const MobilePageContainer = ({ children, className }: MobilePageContainerProps) => (
  <div
    className={cn("min-w-0 overflow-x-hidden md:contents", className)}
    style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}
  >
    {children}
  </div>
);

export const MobileQuickActionButton = ({
  href,
  label,
  icon: Icon,
  description,
  variant = "secondary",
  className,
}: MobileQuickActionButtonProps) => (
  <Link
    href={href}
    className={cn(
      "flex min-h-14 items-center gap-3 rounded-md border px-3 py-3 text-left no-underline shadow-sm transition hover:no-underline",
      variant === "primary" &&
        "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
      variant === "secondary" &&
        "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent",
      variant === "warning" &&
        "border-warning/40 bg-warning/10 text-foreground hover:border-warning/60",
      className,
    )}
  >
    {Icon ? (
      <span
        className={cn(
          "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border",
          variant === "primary"
            ? "border-primary-foreground/30 bg-primary-foreground/10"
            : "border-border bg-secondary",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
    ) : null}
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold">{label}</span>
      {description ? (
        <span
          className={cn(
            "mt-0.5 block truncate text-xs",
            variant === "primary" ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {description}
        </span>
      ) : null}
    </span>
  </Link>
);

export const MobileTaskCard = ({
  label,
  value,
  description,
  icon: Icon,
  href,
  variant = "default",
  className,
}: MobileTaskCardProps) => {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          {value !== undefined ? (
            <p className="mt-1 truncate text-xl font-semibold text-foreground">{value}</p>
          ) : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
              variant === "success" && "border-success/30 bg-success/10 text-success",
              variant === "warning" && "border-warning/30 bg-warning/10 text-warning",
              variant === "danger" && "border-danger/30 bg-danger/10 text-danger",
              variant === "default" && "border-border bg-secondary text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>
      {description ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </>
  );

  const classNames = cn(
    "block min-h-24 rounded-md border border-border bg-card p-3 text-left no-underline shadow-sm hover:no-underline",
    href && "transition hover:border-primary/40 hover:bg-accent",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classNames}>
        {content}
      </Link>
    );
  }

  return <div className={classNames}>{content}</div>;
};
