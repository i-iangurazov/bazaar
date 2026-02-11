"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";

import { GuidanceOverlay } from "@/components/guidance/guidance-overlay";
import { GuidanceProvider } from "@/components/guidance/guidance-provider";
import { PageTipsButton } from "@/components/guidance/page-tips-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignOutButton } from "@/components/signout-button";
import { CommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  DashboardIcon,
  InventoryIcon,
  OrdersIcon,
  ActivityIcon,
  SalesOrdersIcon,
  PurchaseOrdersIcon,
  SuppliersIcon,
  ProductsIcon,
  StoresIcon,
  UnitsIcon,
  UsersIcon,
  OnboardingIcon,
  HelpIcon,
  SupportIcon,
  MetricsIcon,
  JobsIcon,
  BillingIcon,
  WhatsNewIcon,
  AdjustIcon,
  UploadIcon,
  MenuIcon,
  CloseIcon,
  UserIcon,
  ChevronDownIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { normalizeLocale } from "@/lib/locales";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import type { GuidanceRole } from "@/lib/guidance";

type NavItem = {
  key: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  managerOnly?: boolean;
  platformOwnerOnly?: boolean;
  orgOwnerOnly?: boolean;
  children?: NavItem[];
};

type NavGroupId = "core" | "operations" | "insights" | "admin" | "help";

type NavGroup = {
  id: NavGroupId;
  labelKey: string;
  items: NavItem[];
  adminOnly?: boolean;
  managerOnly?: boolean;
  platformOwnerOnly?: boolean;
  orgOwnerOnly?: boolean;
};

const defaultGroupState: Record<NavGroupId, boolean> = {
  core: true,
  operations: false,
  insights: false,
  admin: false,
  help: false,
};

type AppShellProps = {
  children: ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    role: string;
    organizationId?: string | null;
    isPlatformOwner?: boolean;
    isOrgOwner?: boolean;
  };
  impersonation?: {
    targetName?: string | null;
    targetEmail?: string | null;
    expiresAt: string;
  } | null;
};

const stripLocaleFromPath = (pathname: string) => {
  const segments = pathname.split("/");
  const maybeLocale = normalizeLocale(segments[1]);
  if (maybeLocale) {
    const rest = `/${segments.slice(2).join("/")}`;
    return rest === "/" ? "/" : rest.replace(/\/$/, "");
  }
  return pathname;
};

export const AppShell = ({ children, user, impersonation }: AppShellProps) => {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tHeader = useTranslations("appHeader");
  const tErrors = useTranslations("errors");
  const tSupport = useTranslations("adminSupport");
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const normalizedPath = stripLocaleFromPath(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [scanValue, setScanValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [scanResults, setScanResults] = useState<
    Array<{ id: string; name: string; sku: string; matchType: "barcode" | "sku" | "name" }>
  >([]);
  const [groupState, setGroupState] = useState<Record<NavGroupId, boolean>>(defaultGroupState);
  const { toast } = useToast();
  const storageKey = useMemo(
    () =>
      `nav-groups:${user.organizationId ?? "org"}:${user.role}:${user.email ?? user.name ?? "user"}`,
    [user.organizationId, user.role, user.email, user.name],
  );
  const guidanceRole: GuidanceRole =
    user.role === "ADMIN" || user.role === "MANAGER" || user.role === "STAFF"
      ? user.role
      : "STAFF";

  const navGroups = useMemo<NavGroup[]>(
    () => [
      {
        id: "core",
        labelKey: "groups.core",
        items: [
          { key: "dashboard", href: "/dashboard", icon: DashboardIcon },
          { key: "products", href: "/products", icon: ProductsIcon },
          { key: "inventory", href: "/inventory", icon: InventoryIcon },
          {
            key: "orders",
            icon: OrdersIcon,
            children: [
              { key: "salesOrders", href: "/sales/orders", icon: SalesOrdersIcon },
              { key: "purchaseOrders", href: "/purchase-orders", icon: PurchaseOrdersIcon },
            ],
          },
          { key: "suppliers", href: "/suppliers", icon: SuppliersIcon },
          { key: "stores", href: "/stores", icon: StoresIcon },
        ],
      },
      {
        id: "operations",
        labelKey: "groups.operations",
        items: [
          { key: "imports", href: "/settings/import", icon: UploadIcon, adminOnly: true },
          { key: "onboarding", href: "/onboarding", icon: OnboardingIcon, adminOnly: true },
        ],
      },
      {
        id: "insights",
        labelKey: "groups.insights",
        items: [
          { key: "reports", href: "/reports", icon: ActivityIcon, managerOnly: true },
          { key: "adminMetrics", href: "/admin/metrics", icon: MetricsIcon, adminOnly: true },
        ],
      },
      {
        id: "admin",
        labelKey: "groups.admin",
        adminOnly: true,
        items: [
          { key: "users", href: "/settings/users", icon: UsersIcon, adminOnly: true },
          { key: "attributes", href: "/settings/attributes", icon: AdjustIcon, adminOnly: true },
          { key: "units", href: "/settings/units", icon: UnitsIcon, adminOnly: true },
          { key: "adminJobs", href: "/admin/jobs", icon: JobsIcon, adminOnly: true },
          { key: "billing", href: "/billing", icon: BillingIcon, adminOnly: true },
          {
            key: "platformOwner",
            href: "/platform",
            icon: MetricsIcon,
            adminOnly: true,
            platformOwnerOnly: true,
          },
        ],
      },
      {
        id: "help",
        labelKey: "groups.help",
        items: [
          { key: "profile", href: "/settings/profile", icon: UserIcon },
          { key: "adminSupport", href: "/admin/support", icon: SupportIcon, adminOnly: true },
          { key: "help", href: "/help", icon: HelpIcon },
          {
            key: "diagnostics",
            href: "/settings/diagnostics",
            icon: ActivityIcon,
            orgOwnerOnly: true,
          },
          { key: "whatsNew", href: "/settings/whats-new", icon: WhatsNewIcon, adminOnly: true },
        ],
      },
    ],
    [],
  );

  const roleLabel =
    user.role === "ADMIN"
      ? tCommon("roles.admin")
      : user.role === "MANAGER"
        ? tCommon("roles.manager")
        : tCommon("roles.staff");

  const displayName = user.name ?? user.email ?? tCommon("userFallback");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<NavGroupId, boolean>>;
        setGroupState((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore storage errors
    }
  }, [storageKey]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    const previousActive = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

    const getFocusable = () =>
      drawer
        ? Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)).filter(
            (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
          )
        : [];

    const focusables = getFocusable();
    focusables[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const items = getFocusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      previousActive?.focus();
    };
  }, [mobileOpen]);

  const exitImpersonation = async () => {
    try {
      await fetch("/api/impersonation", { method: "DELETE" });
      toast({ variant: "success", description: tSupport("impersonationEnded") });
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast({ variant: "error", description: tErrors("unexpectedError") });
    }
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(scanValue.trim());
    }, 200);
    return () => clearTimeout(handler);
  }, [scanValue]);

  const quickSearchQuery = trpc.products.searchQuick.useQuery(
    { q: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 },
  );

  const canCreateProduct = user.role !== "STAFF";

  const focusScanInput = () => {
    scanInputRef.current?.focus();
  };

  type ScanLookupResult = {
    exactMatch: boolean;
    items: Array<{ id: string; name: string; sku: string; matchType: "barcode" | "sku" | "name" }>;
  };

  const lookupScanQuery = trpc.products.lookupScan.useQuery(
    { q: scanValue.trim() },
    { enabled: false, refetchOnWindowFocus: false },
  );

  const handleLookupResult = (result: ScanLookupResult, normalized: string) => {
    if (result.exactMatch && result.items.length === 1) {
      router.push(`/products/${result.items[0].id}`);
      setScanValue("");
      setScanResults([]);
      setShowResults(false);
      return;
    }
    if (!result.items.length) {
      toast({
        variant: "info",
        description: tHeader("barcodeNotFound", { value: normalized }),
        ...(canCreateProduct
          ? {
              actionLabel: tHeader("createWithBarcode"),
              actionHref: `/products/new?barcode=${encodeURIComponent(normalized)}`,
            }
          : {}),
      });
      setScanValue("");
      setScanResults([]);
      setShowResults(false);
      focusScanInput();
      return;
    }
    setScanResults(result.items);
    setShowResults(true);
    focusScanInput();
  };

  const handleScanSubmit = () => {
    const normalized = scanValue.trim();
    if (!normalized || lookupScanQuery.isFetching) {
      return;
    }
    lookupScanQuery
      .refetch()
      .then((result) => {
        if (result.data) {
          handleLookupResult(result.data, normalized);
          return;
        }
        if (result.error) {
          toast({
            variant: "error",
            description: translateError(tErrors, result.error),
          });
          focusScanInput();
        }
      })
      .catch((error) => {
        toast({
          variant: "error",
          description: translateError(tErrors, error),
        });
        focusScanInput();
      });
  };

  const dropdownItems =
    scanResults.length > 0
      ? scanResults
      : (quickSearchQuery.data ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          matchType: "name" as const,
        }));

  const isItemVisible = (item: NavItem): boolean => {
    if (item.adminOnly && user.role !== "ADMIN") {
      return false;
    }
    if (item.managerOnly && user.role === "STAFF") {
      return false;
    }
    if (item.platformOwnerOnly && !user.isPlatformOwner) {
      return false;
    }
    if (item.orgOwnerOnly && !user.isOrgOwner) {
      return false;
    }
    if (item.children?.length) {
      return item.children.some((child) => isItemVisible(child));
    }
    if (!item.href) {
      return false;
    }
    return true;
  };

  const isItemActive = (item: NavItem): boolean => {
    if (item.href) {
      return normalizedPath === item.href || normalizedPath.startsWith(`${item.href}/`);
    }
    if (item.children?.length) {
      return item.children.some((child) => isItemVisible(child) && isItemActive(child));
    }
    return false;
  };

  const toggleGroup = (groupId: NavGroupId) => {
    setGroupState((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      }
      return next;
    });
  };

  const renderNavGroups = (onNavigate?: () => void) =>
    navGroups
      .filter((group) => {
        if (group.adminOnly && user.role !== "ADMIN") {
          return false;
        }
        if (group.managerOnly && user.role === "STAFF") {
          return false;
        }
        if (group.platformOwnerOnly && !user.isPlatformOwner) {
          return false;
        }
        if (group.orgOwnerOnly && !user.isOrgOwner) {
          return false;
        }
        return group.items.some((item) => isItemVisible(item));
      })
      .map((group) => {
        const visibleItems = group.items.filter((item) => isItemVisible(item));
        if (!visibleItems.length) {
          return null;
        }
        const isOpen = groupState[group.id];
        const groupLabel = tNav(group.labelKey);
        return (
          <div key={group.id} className="space-y-2">
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:bg-accent/50 hover:text-foreground"
              aria-expanded={isOpen}
              aria-label={tNav("groupToggle", { group: groupLabel })}
            >
              <span>{groupLabel}</span>
              <ChevronDownIcon
                className={cn("h-4 w-4 transition-transform", isOpen ? "rotate-180" : "rotate-0")}
                aria-hidden
              />
            </button>
            {isOpen ? (
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const isActive = isItemActive(item);
                  const visibleChildren = item.children?.filter((child) => isItemVisible(child)) ?? [];
                  if (visibleChildren.length) {
                    return (
                      <div key={item.key} className="space-y-1">
                        <div
                          className={cn(
                            "relative flex h-9 items-center gap-2 rounded-md border-l-2 border-transparent px-3 text-sm font-semibold",
                            isActive
                              ? "border-primary border-l-4 bg-accent text-accent-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          <item.icon className="h-4 w-4" aria-hidden />
                          <span>{tNav(item.key)}</span>
                        </div>
                        <div className="space-y-1 pl-4">
                          {visibleChildren.map((child) => {
                            const isChildActive = isItemActive(child);
                            return (
                              <Link
                                key={child.key}
                                href={child.href ?? "/"}
                                onClick={onNavigate}
                                data-tour={`nav-${child.key}`}
                                className={cn(
                                  "relative flex h-9 items-center gap-2 rounded-md border-l-2 border-transparent px-3 text-sm font-semibold transition",
                                  isChildActive
                                    ? "border-primary border-l-4 bg-accent text-accent-foreground"
                                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                                )}
                              >
                                <child.icon className="h-4 w-4" aria-hidden />
                                <span>{tNav(child.key)}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  if (!item.href) {
                    return null;
                  }
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={onNavigate}
                      data-tour={`nav-${item.key}`}
                      className={cn(
                        "relative flex h-9 items-center gap-2 rounded-md border-l-2 border-transparent px-3 text-sm font-semibold transition",
                        isActive
                          ? "border-primary border-l-4 bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" aria-hidden />
                      <span>{tNav(item.key)}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      });

  const renderProfileShortcut = (onNavigate?: () => void) => (
    <Link
      href="/settings/profile"
      onClick={onNavigate}
      aria-label={tNav("profile")}
      className="group flex w-full items-center justify-between rounded-lg border border-border bg-card/70 px-3 py-2 text-left no-underline transition hover:border-primary/40 hover:bg-accent/70 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground transition group-hover:border-primary/30 group-hover:text-primary">
          <UserIcon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">{displayName}</span>
          <span className="block truncate text-xs text-muted-foreground">{roleLabel}</span>
        </span>
      </div>
      <ChevronDownIcon
        className="-rotate-90 text-muted-foreground transition group-hover:text-foreground"
        aria-hidden
      />
    </Link>
  );

  return (
    <GuidanceProvider role={guidanceRole}>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/40">
      {impersonation ? (
        <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span>
              {tSupport("impersonationActive", {
                user: impersonation.targetName ?? impersonation.targetEmail ?? tCommon("userFallback"),
              })}
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={exitImpersonation}>
              {tSupport("exitImpersonation")}
            </Button>
          </div>
        </div>
      ) : null}
      <header
        className={cn(
          "sticky z-40 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 shadow-sm backdrop-blur lg:hidden",
          impersonation ? "top-10" : "top-0",
        )}
      >
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label={tCommon("openMenu")}
          >
            <MenuIcon className="h-4 w-4" aria-hidden />
          </Button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tNav("platform")}
            </p>
            <p className="text-lg font-semibold text-foreground">{tNav("brand")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PageTipsButton />
          <LanguageSwitcher />
        </div>
      </header>

      <div className="flex min-h-screen">
        <aside className="hidden w-64 flex-col border-r border-border bg-card px-6 py-8 lg:flex">
          <div className="space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tNav("platform")}
              </p>
              <h1 className="text-xl font-semibold text-foreground">{tNav("brand")}</h1>
            </div>
            <nav className="space-y-4">{renderNavGroups()}</nav>
          </div>
          <div className="mt-10 border-t border-border pt-6 text-sm">
            {renderProfileShortcut()}
            <div className="mt-4">
              <SignOutButton />
            </div>
          </div>
        </aside>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-md">
                <Input
                  data-tour="scan-input"
                  type="search"
                  placeholder={tHeader("scanPlaceholder")}
                  value={scanValue}
                  onChange={(event) => {
                    setScanValue(event.target.value);
                    if (scanResults.length) {
                      setScanResults([]);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleScanSubmit();
                    }
                  }}
                  onFocus={() => setShowResults(true)}
                  onBlur={() => {
                    setTimeout(() => setShowResults(false), 150);
                  }}
                  inputMode="search"
                  aria-label={tHeader("scanLabel")}
                  ref={scanInputRef}
                />
                {showResults && dropdownItems.length ? (
                  <div className="absolute z-20 mt-2 w-full rounded-md border border-border bg-popover shadow-lg">
                    <div className="max-h-64 overflow-y-auto py-1">
                      {dropdownItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full flex-col px-3 py-2 text-left text-sm transition hover:bg-accent"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            router.push(`/products/${item.id}`);
                            setScanValue("");
                            setScanResults([]);
                            setShowResults(false);
                            focusScanInput();
                          }}
                        >
                          <span className="font-medium text-foreground">{item.name}</span>
                          <span className="text-xs text-muted-foreground">{item.sku}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="hidden lg:flex lg:items-center lg:gap-2">
                <PageTipsButton />
                <LanguageSwitcher />
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>

      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          className={cn(
            "absolute inset-0 bg-black/30 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setMobileOpen(false)}
          aria-label={tCommon("closeMenu")}
        />
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          className={cn(
            "absolute left-0 top-0 h-full w-72 overflow-y-auto border-r border-border bg-card p-6 shadow-xl transition-transform duration-200 ease-out",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tNav("platform")}
              </p>
              <p className="text-lg font-semibold text-foreground">{tNav("brand")}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(false)}
              aria-label={tCommon("closeMenu")}
            >
              <CloseIcon className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <nav className="mt-6 space-y-4">{renderNavGroups(() => setMobileOpen(false))}</nav>

          <div className="mt-8 border-t border-border pt-6 text-sm">
            {renderProfileShortcut(() => setMobileOpen(false))}
            <div className="mt-4">
              <SignOutButton />
            </div>
          </div>
        </div>
      </div>
        <CommandPalette />
        <GuidanceOverlay />
      </div>
    </GuidanceProvider>
  );
};
