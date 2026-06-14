"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";

import { GuidanceOverlay } from "@/components/guidance/guidance-overlay";
import { GuidanceProvider } from "@/components/guidance/guidance-provider";
import { PageTipsButton } from "@/components/guidance/page-tips-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  MobileAppShell,
  MobilePageContainer,
  type MobileShellNavItem,
} from "@/components/mobile-app-shell";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { SignOutButton } from "@/components/signout-button";
import { ScanInput } from "@/components/ScanInput";
import { CommandPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  CirclePlusIcon,
  DashboardIcon,
  InventoryIcon,
  InventoryOverviewIcon,
  ProductMovementIcon,
  StockCountsIcon,
  OrdersIcon,
  PosIcon,
  CustomerDatabaseIcon,
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
  ReportsIcon,
  DiagnosticsIcon,
  PlatformIcon,
  JobsIcon,
  BillingIcon,
  WhatsNewIcon,
  PrintIcon,
  ReceiveIcon,
  ArchiveIcon,
  AdjustIcon,
  UploadIcon,
  IntegrationsIcon,
  UserIcon,
  ChevronDownIcon,
  TagIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { normalizeLocale } from "@/lib/locales";
import { translateError } from "@/lib/translateError";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  canCreateProductForRole,
  hasPermission,
  type AppPermission,
  type RoleAccess,
} from "@/lib/roleAccess";
import { trpc } from "@/lib/trpc";
import type { GuidanceRole } from "@/lib/guidance";
import type { ScanResolvedResult } from "@/lib/scanning/scanRouter";

type NavItem = {
  key: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
  adminOnly?: boolean;
  managerOnly?: boolean;
  platformOwnerOnly?: boolean;
  orgOwnerOnly?: boolean;
  requiredPermission?: AppPermission;
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
  requiredPermission?: AppPermission;
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
    emailVerified?: boolean;
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
  const tBreadcrumbs = useTranslations("breadcrumbs");
  const tHeader = useTranslations("appHeader");
  const tCommand = useTranslations("commandPalette");
  const tErrors = useTranslations("errors");
  const tSupport = useTranslations("adminSupport");
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const normalizedPath = stripLocaleFromPath(pathname);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [customizeNavOpen, setCustomizeNavOpen] = useState(false);
  const [verificationResent, setVerificationResent] = useState(false);
  const isMobile = useIsMobile();
  const [groupState, setGroupState] = useState<Record<NavGroupId, boolean>>(defaultGroupState);
  const [hiddenNavItemKeys, setHiddenNavItemKeys] = useState<string[]>([]);
  const { toast } = useToast();
  const profileQuery = trpc.userSettings.getMyProfile.useQuery(undefined, {
    enabled: Boolean(user.organizationId),
  });
  const storesQuery = trpc.stores.list.useQuery(undefined, {
    enabled: Boolean(user.organizationId) && isMobile === true,
  });
  const resendVerificationMutation = trpc.publicAuth.resendVerification.useMutation({
    onSuccess: () => {
      setVerificationResent(true);
      toast({ variant: "success", description: tNav("emailVerificationSent") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const isOrgOwner = Boolean(profileQuery.data?.isOrgOwner ?? user.isOrgOwner);
  const emailVerified = profileQuery.data
    ? Boolean(profileQuery.data.emailVerifiedAt)
    : user.emailVerified !== false;
  const showEmailVerificationNotice = Boolean(user.email && !emailVerified && !impersonation);
  const access: RoleAccess = useMemo(
    () => ({
      role: user.role,
      isPlatformOwner: Boolean(user.isPlatformOwner),
      isOrgOwner,
    }),
    [isOrgOwner, user.isPlatformOwner, user.role],
  );
  const storageKey = useMemo(
    () =>
      `nav-groups:${user.organizationId ?? "org"}:${user.role}:${user.email ?? user.name ?? "user"}`,
    [user.organizationId, user.role, user.email, user.name],
  );
  const hiddenNavStorageKey = useMemo(
    () =>
      `nav-hidden:${user.organizationId ?? "org"}:${user.role}:${user.email ?? user.name ?? "user"}`,
    [user.organizationId, user.role, user.email, user.name],
  );
  const hiddenNavItemSet = useMemo(() => new Set(hiddenNavItemKeys), [hiddenNavItemKeys]);
  const guidanceRole: GuidanceRole =
    user.role === "ADMIN" || user.role === "MANAGER" || user.role === "STAFF" ? user.role : "STAFF";

  const navGroups = useMemo<NavGroup[]>(
    () => [
      {
        id: "core",
        labelKey: "groups.core",
        items: [
          {
            key: "dashboard",
            href: "/dashboard",
            icon: DashboardIcon,
            requiredPermission: "viewDashboard",
          },
          { key: "pos", href: "/pos", icon: PosIcon, requiredPermission: "usePos" },
          {
            key: "products",
            href: "/products",
            icon: ProductsIcon,
            requiredPermission: "viewProducts",
          },
          {
            key: "inventory",
            icon: InventoryIcon,
            children: [
              {
                key: "inventoryOverview",
                href: "/inventory",
                icon: InventoryOverviewIcon,
                exact: true,
                requiredPermission: "viewInventory",
              },
              {
                key: "productMovements",
                href: "/inventory/movements",
                icon: ProductMovementIcon,
                requiredPermission: "viewInventory",
              },
              {
                key: "stockReceiving",
                href: "/inventory/receiving",
                icon: ReceiveIcon,
                requiredPermission: "viewInventory",
              },
              {
                key: "stockWriteOff",
                href: "/inventory/write-offs",
                icon: ArchiveIcon,
                requiredPermission: "viewInventory",
              },
              {
                key: "stockCounts",
                href: "/inventory/counts",
                icon: StockCountsIcon,
                requiredPermission: "viewInventory",
              },
            ],
          },
          {
            key: "orders",
            icon: OrdersIcon,
            children: [
              {
                key: "salesOrders",
                href: "/sales/orders",
                icon: SalesOrdersIcon,
                requiredPermission: "viewSales",
              },
              {
                key: "purchaseOrders",
                href: "/purchase-orders",
                icon: PurchaseOrdersIcon,
                requiredPermission: "viewPurchaseOrders",
              },
            ],
          },
          {
            key: "customers",
            href: "/customers",
            icon: CustomerDatabaseIcon,
            requiredPermission: "manageCustomers",
          },
          {
            key: "suppliers",
            href: "/suppliers",
            icon: SuppliersIcon,
            requiredPermission: "viewSuppliers",
          },
          {
            key: "stores",
            href: "/stores",
            icon: StoresIcon,
            requiredPermission: "viewStores",
          },
        ],
      },
      {
        id: "operations",
        labelKey: "groups.operations",
        items: [
          {
            key: "integrations",
            href: "/operations/integrations",
            icon: IntegrationsIcon,
            requiredPermission: "manageIntegrations",
          },
          {
            key: "imports",
            href: "/settings/import",
            icon: UploadIcon,
            requiredPermission: "manageImports",
          },
          {
            key: "onboarding",
            href: "/onboarding",
            icon: OnboardingIcon,
            adminOnly: true,
            requiredPermission: "manageSettings",
          },
        ],
      },
      {
        id: "insights",
        labelKey: "groups.insights",
        items: [
          {
            key: "reports",
            href: "/reports",
            icon: ReportsIcon,
            managerOnly: true,
            requiredPermission: "viewReports",
          },
          {
            key: "adminMetrics",
            href: "/admin/metrics",
            icon: MetricsIcon,
            adminOnly: true,
            requiredPermission: "viewSystem",
          },
        ],
      },
      {
        id: "admin",
        labelKey: "groups.admin",
        items: [
          {
            key: "users",
            href: "/settings/users",
            icon: UsersIcon,
            adminOnly: true,
            requiredPermission: "manageUsers",
          },
          {
            key: "printing",
            href: "/settings/printing",
            icon: PrintIcon,
            adminOnly: true,
            requiredPermission: "manageSettings",
          },
          {
            key: "storeGroups",
            href: "/settings/store-groups",
            icon: StoresIcon,
            adminOnly: true,
            requiredPermission: "manageSettings",
          },
          {
            key: "attributes",
            href: "/settings/attributes",
            icon: AdjustIcon,
            requiredPermission: "manageProducts",
          },
          {
            key: "categories",
            href: "/settings/categories",
            icon: TagIcon,
            adminOnly: true,
            requiredPermission: "manageProducts",
          },
          {
            key: "units",
            href: "/settings/units",
            icon: UnitsIcon,
            requiredPermission: "manageProducts",
          },
          {
            key: "adminJobs",
            href: "/admin/jobs",
            icon: JobsIcon,
            adminOnly: true,
            requiredPermission: "viewSystem",
          },
          {
            key: "billing",
            href: "/billing",
            icon: BillingIcon,
            adminOnly: true,
            requiredPermission: "manageBilling",
          },
          {
            key: "platformOwner",
            href: "/platform",
            icon: PlatformIcon,
            adminOnly: true,
            platformOwnerOnly: true,
            requiredPermission: "viewPlatform",
          },
        ],
      },
      {
        id: "help",
        labelKey: "groups.help",
        items: [
          {
            key: "adminSupport",
            href: "/admin/support",
            icon: SupportIcon,
            adminOnly: true,
            requiredPermission: "viewSupport",
          },
          { key: "help", href: "/help", icon: HelpIcon, requiredPermission: "viewHelp" },
          {
            key: "diagnostics",
            href: "/settings/diagnostics",
            icon: DiagnosticsIcon,
            orgOwnerOnly: true,
            requiredPermission: "viewDiagnostics",
          },
          {
            key: "whatsNew",
            href: "/settings/whats-new",
            icon: WhatsNewIcon,
            adminOnly: true,
            requiredPermission: "manageSettings",
          },
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
        : user.role === "CASHIER"
          ? tCommon("roles.cashier")
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
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = window.localStorage.getItem(hiddenNavStorageKey);
      setHiddenNavItemKeys(stored ? (JSON.parse(stored) as string[]) : []);
    } catch {
      setHiddenNavItemKeys([]);
    }
  }, [hiddenNavStorageKey]);

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

  const canCreateProduct = canCreateProductForRole(access);
  const handleScanResolved = async (result: ScanResolvedResult) => {
    if (result.kind === "exact") {
      router.push(`/products/${result.item.id}`);
      return true;
    }
    if (result.kind === "notFound") {
      toast({
        variant: "info",
        description: tHeader("barcodeNotFound", { value: result.input }),
        ...(canCreateProduct
          ? {
              actionLabel: tHeader("createWithBarcode"),
              actionHref: `/products/new?barcode=${encodeURIComponent(result.input)}`,
            }
          : {}),
      });
      return false;
    }
    return true;
  };

  const isItemAllowedByRole = (item: NavItem): boolean => {
    if (item.adminOnly && user.role !== "ADMIN") {
      return false;
    }
    if (item.managerOnly && user.role !== "ADMIN" && user.role !== "MANAGER") {
      return false;
    }
    if (item.platformOwnerOnly && !user.isPlatformOwner) {
      return false;
    }
    if (item.orgOwnerOnly && !isOrgOwner) {
      return false;
    }
    if (!hasPermission(access, item.requiredPermission)) {
      return false;
    }
    if (item.children?.length) {
      return item.children.some((child) => isItemAllowedByRole(child));
    }
    if (!item.href) {
      return false;
    }
    return true;
  };

  const isItemVisible = (item: NavItem): boolean => {
    if (!isItemAllowedByRole(item)) {
      return false;
    }
    if (item.children?.length) {
      return item.children.some((child) => isItemVisible(child));
    }
    return !hiddenNavItemSet.has(item.key);
  };

  const isGroupAllowedByRole = (group: NavGroup) => {
    if (group.adminOnly && user.role !== "ADMIN") {
      return false;
    }
    if (group.managerOnly && user.role !== "ADMIN" && user.role !== "MANAGER") {
      return false;
    }
    if (group.platformOwnerOnly && !user.isPlatformOwner) {
      return false;
    }
    if (group.orgOwnerOnly && !isOrgOwner) {
      return false;
    }
    if (!hasPermission(access, group.requiredPermission)) {
      return false;
    }
    return group.items.some((item) => isItemAllowedByRole(item));
  };

  const isItemActive = (item: NavItem): boolean => {
    if (item.href) {
      if (item.exact) {
        return normalizedPath === item.href;
      }
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

  const setNavItemVisible = (key: string, visible: boolean) => {
    setHiddenNavItemKeys((prev) => {
      const next = visible
        ? prev.filter((itemKey) => itemKey !== key)
        : Array.from(new Set([...prev, key]));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(hiddenNavStorageKey, JSON.stringify(next));
      }
      return next;
    });
  };

  const resetNavCustomization = () => {
    setHiddenNavItemKeys([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(hiddenNavStorageKey);
    }
  };

  const collectCustomizableItems = (items: NavItem[]): NavItem[] =>
    items.flatMap((item) => {
      if (item.children?.length) {
        return collectCustomizableItems(item.children);
      }
      return isItemAllowedByRole(item) ? [item] : [];
    });

  const customizableNavGroups = navGroups
    .filter((group) => isGroupAllowedByRole(group))
    .map((group) => ({
      id: group.id,
      labelKey: group.labelKey,
      items: collectCustomizableItems(group.items),
    }))
    .filter((group) => group.items.length > 0);

  const renderNavGroups = (onNavigate?: () => void) =>
    navGroups
      .filter(
        (group) => isGroupAllowedByRole(group) && group.items.some((item) => isItemVisible(item)),
      )
      .map((group) => {
        const visibleItems = group.items.filter((item) => isItemVisible(item));
        if (!visibleItems.length) {
          return null;
        }
        const isOpen = groupState[group.id];
        const groupLabel = tNav(group.labelKey);
        return (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel asChild>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center justify-between rounded-md transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-expanded={isOpen}
                aria-label={tNav("groupToggle", { group: groupLabel })}
              >
                <span>{groupLabel}</span>
                <ChevronDownIcon
                  className={cn("h-4 w-4 transition-transform", isOpen ? "rotate-180" : "rotate-0")}
                  aria-hidden
                />
              </button>
            </SidebarGroupLabel>
            {isOpen ? (
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => {
                    const isActive = isItemActive(item);
                    const visibleChildren =
                      item.children?.filter((child) => isItemVisible(child)) ?? [];
                    if (visibleChildren.length) {
                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton
                            type="button"
                            isActive={isActive}
                            className={cn(!isActive && "text-sidebar-foreground/70")}
                          >
                            <item.icon aria-hidden />
                            <span>{tNav(item.key)}</span>
                          </SidebarMenuButton>
                          <SidebarMenu className="ml-4 mt-1 border-l border-sidebar-border pl-2 group-data-[state=collapsed]/sidebar-wrapper:hidden">
                            {visibleChildren.map((child) => {
                              const isChildActive = isItemActive(child);
                              return (
                                <SidebarMenuItem key={child.key}>
                                  <SidebarMenuButton asChild isActive={isChildActive}>
                                    <Link
                                      href={child.href ?? "/"}
                                      onClick={onNavigate}
                                      data-tour={`nav-${child.key}`}
                                    >
                                      <child.icon aria-hidden />
                                      <span>{tNav(child.key)}</span>
                                    </Link>
                                  </SidebarMenuButton>
                                </SidebarMenuItem>
                              );
                            })}
                          </SidebarMenu>
                        </SidebarMenuItem>
                      );
                    }
                    if (!item.href) {
                      return null;
                    }
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <Link href={item.href} onClick={onNavigate} data-tour={`nav-${item.key}`}>
                            <item.icon aria-hidden />
                            <span>{tNav(item.key)}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            ) : null}
          </SidebarGroup>
        );
      });

  const renderCustomizeNavButton = (onClick?: () => void) => (
    <Button
      type="button"
      variant="ghost"
      className="mt-4 w-full justify-start rounded-md px-3 group-data-[state=collapsed]/sidebar-wrapper:justify-center group-data-[state=collapsed]/sidebar-wrapper:px-0"
      onClick={() => {
        onClick?.();
        setCustomizeNavOpen(true);
      }}
    >
      <AdjustIcon className="h-4 w-4" aria-hidden />
      <span className="group-data-[state=collapsed]/sidebar-wrapper:sr-only">
        {tNav("customize")}
      </span>
    </Button>
  );

  const handleResendVerification = () => {
    if (!user.email) {
      return;
    }
    setVerificationResent(false);
    resendVerificationMutation.mutate({ email: user.email });
  };

  const renderEmailVerificationNotice = () => {
    if (!showEmailVerificationNotice) {
      return null;
    }

    return (
      <div className="mt-3 border border-warning/40 bg-warning/10 px-3 py-3 text-xs text-foreground">
        <p className="font-semibold text-foreground">{tNav("emailUnverifiedTitle")}</p>
        <p className="mt-1 leading-relaxed text-muted-foreground">
          {tNav("emailUnverifiedDescription")}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3 h-8 rounded-md px-2 text-xs"
          onClick={handleResendVerification}
          disabled={resendVerificationMutation.isLoading || verificationResent}
        >
          {resendVerificationMutation.isLoading
            ? tNav("emailVerificationSending")
            : verificationResent
              ? tNav("emailVerificationSent")
              : tNav("emailVerificationResend")}
        </Button>
      </div>
    );
  };

  const renderProfileShortcut = (onNavigate?: () => void) => (
    <Link
      href="/settings/profile"
      onClick={onNavigate}
      aria-label={tNav("profile")}
      className="group flex w-full items-center justify-between rounded-md border border-sidebar-border bg-sidebar-accent/60 px-3 py-2 text-left no-underline transition hover:border-sidebar-primary/30 hover:bg-sidebar-accent hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar group-data-[state=collapsed]/sidebar-wrapper:justify-center group-data-[state=collapsed]/sidebar-wrapper:px-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground/70 transition group-hover:border-sidebar-primary/30 group-hover:text-sidebar-primary">
          <UserIcon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 group-data-[state=collapsed]/sidebar-wrapper:sr-only">
          <span className="block truncate text-sm font-semibold text-sidebar-foreground">
            {displayName}
          </span>
          <span className="block truncate text-xs text-sidebar-foreground/60">{roleLabel}</span>
        </span>
      </div>
      <ChevronDownIcon
        className="-rotate-90 text-sidebar-foreground/60 transition group-hover:text-sidebar-foreground group-data-[state=collapsed]/sidebar-wrapper:hidden"
        aria-hidden
      />
    </Link>
  );

  type MobileNavCandidate = MobileShellNavItem & {
    activePath?: string;
    adminOnly?: boolean;
    managerOnly?: boolean;
    platformOwnerOnly?: boolean;
    orgOwnerOnly?: boolean;
    requiredPermission?: AppPermission;
  };

  const isMobileNavCandidateAllowed = (item: MobileNavCandidate) => {
    if (item.adminOnly && user.role !== "ADMIN") {
      return false;
    }
    if (item.managerOnly && user.role !== "ADMIN" && user.role !== "MANAGER") {
      return false;
    }
    if (item.platformOwnerOnly && !user.isPlatformOwner) {
      return false;
    }
    if (item.orgOwnerOnly && !isOrgOwner) {
      return false;
    }
    return hasPermission(access, item.requiredPermission);
  };

  const toMobileShellItem = (item: MobileNavCandidate): MobileShellNavItem => {
    const activePath = item.activePath ?? item.href;
    return {
      key: item.key,
      label: item.label,
      href: item.href,
      icon: item.icon,
      description: item.description,
      active: normalizedPath === activePath || normalizedPath.startsWith(`${activePath}/`),
    };
  };

  const mobileBottomCandidates: MobileNavCandidate[] = [
    {
      key: "mobile-dashboard",
      label: tBreadcrumbs("home"),
      href: "/dashboard",
      activePath: "/dashboard",
      icon: DashboardIcon,
      requiredPermission: "viewDashboard",
    },
    {
      key: "mobile-pos",
      label: tNav("pos"),
      href: "/pos",
      activePath: "/pos",
      icon: PosIcon,
      requiredPermission: "usePos",
    },
    {
      key: "mobile-products",
      label: tNav("products"),
      href: "/products",
      icon: ProductsIcon,
      requiredPermission: "viewProducts",
    },
    {
      key: "mobile-sales",
      label: tNav("sales"),
      href: "/sales/orders",
      activePath: "/sales",
      icon: SalesOrdersIcon,
      requiredPermission: "viewSales",
    },
  ];

  const mobileMoreCandidates: MobileNavCandidate[] = [
    {
      key: "mobile-inventory",
      label: tNav("inventory"),
      href: "/inventory",
      activePath: "/inventory",
      icon: InventoryIcon,
      requiredPermission: "viewInventory",
    },
    {
      key: "mobile-customers",
      label: tNav("customers"),
      href: "/customers",
      icon: CustomerDatabaseIcon,
      requiredPermission: "manageCustomers",
    },
    {
      key: "mobile-integrations",
      label: tNav("integrations"),
      href: "/operations/integrations",
      activePath: "/operations/integrations",
      icon: IntegrationsIcon,
      requiredPermission: "manageIntegrations",
    },
    {
      key: "mobile-reports",
      label: tNav("reports"),
      href: "/reports",
      icon: ReportsIcon,
      requiredPermission: "viewReports",
    },
    {
      key: "mobile-settings",
      label: tBreadcrumbs("settings"),
      href: "/settings/profile",
      activePath: "/settings/profile",
      icon: UserIcon,
      requiredPermission: "viewProfile",
    },
    {
      key: "mobile-categories",
      label: tNav("categories"),
      href: "/settings/categories",
      icon: TagIcon,
      adminOnly: true,
      requiredPermission: "manageProducts",
    },
    {
      key: "mobile-printing",
      label: tNav("printing"),
      href: "/settings/printing",
      icon: PrintIcon,
      adminOnly: true,
      requiredPermission: "manageSettings",
    },
    {
      key: "mobile-stores",
      label: tNav("stores"),
      href: "/stores",
      icon: StoresIcon,
      requiredPermission: "viewStores",
    },
    {
      key: "mobile-users",
      label: tNav("users"),
      href: "/settings/users",
      icon: UsersIcon,
      adminOnly: true,
      requiredPermission: "manageUsers",
    },
    {
      key: "mobile-help",
      label: tNav("help"),
      href: "/help",
      icon: HelpIcon,
      requiredPermission: "viewHelp",
    },
  ];

  const mobileBottomItems = mobileBottomCandidates
    .filter(isMobileNavCandidateAllowed)
    .map(toMobileShellItem);
  const mobileMoreItems = mobileMoreCandidates
    .filter(isMobileNavCandidateAllowed)
    .map(toMobileShellItem);

  const mobilePageTitle = useMemo(() => {
    if (normalizedPath === "/" || normalizedPath.startsWith("/dashboard")) {
      return tBreadcrumbs("home");
    }
    if (normalizedPath.startsWith("/pos")) {
      return tNav("pos");
    }
    if (normalizedPath.startsWith("/products")) {
      return tNav("products");
    }
    if (normalizedPath.startsWith("/inventory")) {
      return tNav("inventory");
    }
    if (normalizedPath.startsWith("/sales")) {
      return tNav("sales");
    }
    if (normalizedPath.startsWith("/customers")) {
      return tNav("customers");
    }
    if (normalizedPath.startsWith("/reports")) {
      return tNav("reports");
    }
    if (normalizedPath.startsWith("/operations/integrations")) {
      return tNav("integrations");
    }
    if (normalizedPath.startsWith("/stores")) {
      return tNav("stores");
    }
    if (normalizedPath.startsWith("/settings/printing")) {
      return tNav("printing");
    }
    if (normalizedPath.startsWith("/settings")) {
      return tBreadcrumbs("settings");
    }
    return tNav("brand");
  }, [normalizedPath, tBreadcrumbs, tNav]);

  const mobileStoreName = storesQuery.data?.[0]?.name ?? null;

  if (normalizedPath === "/pos/sell") {
    return (
      <div className="min-h-screen bg-background">
        {impersonation ? (
          <div className="sticky top-0 z-50 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-foreground">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
              <span>
                {tSupport("impersonationActive", {
                  user:
                    impersonation.targetName ??
                    impersonation.targetEmail ??
                    tCommon("userFallback"),
                })}
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={exitImpersonation}>
                {tSupport("exitImpersonation")}
              </Button>
            </div>
          </div>
        ) : null}
        <MobilePageContainer>{children}</MobilePageContainer>
        <MobileAppShell
          pageTitle={mobilePageTitle}
          storeName={mobileStoreName}
          bottomItems={mobileBottomItems}
          moreItems={mobileMoreItems}
          moreLabel={tNav("more")}
          profileLabel={tNav("profile")}
          closeLabel={tCommon("closeMenu")}
          navigationLabel={tNav("mobileNavigation")}
          showTopBar={false}
        />
      </div>
    );
  }

  return (
    <GuidanceProvider role={guidanceRole}>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/40">
        {impersonation ? (
          <div className="sticky top-0 z-50 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-foreground">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
              <span>
                {tSupport("impersonationActive", {
                  user:
                    impersonation.targetName ??
                    impersonation.targetEmail ??
                    tCommon("userFallback"),
                })}
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={exitImpersonation}>
                {tSupport("exitImpersonation")}
              </Button>
            </div>
          </div>
        ) : null}
        <MobileAppShell
          pageTitle={mobilePageTitle}
          storeName={mobileStoreName}
          bottomItems={mobileBottomItems}
          moreItems={mobileMoreItems}
          moreLabel={tNav("more")}
          profileLabel={tNav("profile")}
          closeLabel={tCommon("closeMenu")}
          navigationLabel={tNav("mobileNavigation")}
        />
        <SidebarProvider className="min-h-screen">
          <Sidebar className="md:sticky md:top-0 md:h-screen">
            <SidebarHeader className="space-y-3 p-4">
              <Link
                href="/dashboard"
                className="flex min-h-10 items-center no-underline hover:no-underline"
                aria-label={tNav("brand")}
              >
                <Image
                  src="/brand/logo.png"
                  alt=""
                  width={724}
                  height={181}
                  className="h-auto w-[164px] max-w-full group-data-[state=collapsed]/sidebar-wrapper:hidden"
                  priority
                />
                <span className="hidden h-10 w-10 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground shadow-sm group-data-[state=collapsed]/sidebar-wrapper:inline-flex">
                  B
                </span>
              </Link>
              <Button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                size="default"
                className="h-10 w-full rounded-md bg-sidebar-primary text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary/90 group-data-[state=collapsed]/sidebar-wrapper:w-10 group-data-[state=collapsed]/sidebar-wrapper:px-0"
                aria-label={tCommand("openButton")}
              >
                <CirclePlusIcon className="h-5 w-5" aria-hidden />
              </Button>
            </SidebarHeader>

            <SidebarContent className="scrollbar-soft">
              <nav aria-label={tNav("brand")}>{renderNavGroups()}</nav>
            </SidebarContent>

            <SidebarFooter className="space-y-3 p-4 text-sm">
              {renderCustomizeNavButton()}
              {renderEmailVerificationNotice()}
              {renderProfileShortcut()}
              <div>
                <SignOutButton />
              </div>
            </SidebarFooter>
          </Sidebar>

          <SidebarInset className="bg-transparent">
            <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
              <MobilePageContainer>
                <div className="mx-auto">
                  <div className="mb-6 hidden flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:flex">
                    <div className="flex w-full min-w-0 items-center gap-2 sm:max-w-md">
                      <SidebarTrigger className="h-10 w-10 shrink-0 border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground" />
                      <div className="relative min-w-0 flex-1">
                        <ScanInput
                          context="global"
                          dataTour="scan-input"
                          placeholder={tHeader("scanPlaceholder")}
                          ariaLabel={tHeader("scanLabel")}
                          supportsTabSubmit
                          enableProductSearch
                          onResolved={handleScanResolved}
                        />
                      </div>
                    </div>
                    <div className="hidden md:flex md:items-center md:gap-2">
                      <PageTipsButton />
                      <PwaInstallButton />
                      <LanguageSwitcher />
                    </div>
                  </div>
                  {children}
                </div>
              </MobilePageContainer>
            </main>
          </SidebarInset>
        </SidebarProvider>

        <Modal
          open={customizeNavOpen}
          onOpenChange={setCustomizeNavOpen}
          title={tNav("customizeTitle")}
          subtitle={tNav("customizeSubtitle")}
          className="max-w-2xl"
          usePortal
        >
          <div className="space-y-5">
            {customizableNavGroups.map((group) => (
              <div key={group.id} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {tNav(group.labelKey)}
                </p>
                <div className="divide-y divide-border border border-border">
                  {group.items.map((item) => {
                    const visible = !hiddenNavItemSet.has(item.key);
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-3 bg-card px-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {tNav(item.key)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{item.href}</p>
                        </div>
                        <Switch
                          checked={visible}
                          onCheckedChange={(checked) => setNavItemVisible(item.key, checked)}
                          aria-label={tNav("customizeToggle", { item: tNav(item.key) })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={resetNavCustomization}>
                {tNav("customizeReset")}
              </Button>
              <Button type="button" onClick={() => setCustomizeNavOpen(false)}>
                {tCommon("close")}
              </Button>
            </ModalFooter>
          </div>
        </Modal>
        <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
        <GuidanceOverlay />
      </div>
    </GuidanceProvider>
  );
};
