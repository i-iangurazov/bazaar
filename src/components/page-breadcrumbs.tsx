"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

type Crumb = {
  label: string;
  href?: string;
};

const LOCALE_SEGMENTS = new Set(["ru", "kg", "ky"]);

const DYNAMIC_SEGMENT_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /^[a-z0-9]{20,}$/i,
];

const LINKABLE_SEGMENTS = new Set([
  "dashboard",
  "pos",
  "inventory",
  "products",
  "purchase-orders",
  "suppliers",
  "stores",
  "reports",
  "billing",
  "platform",
  "help",
  "onboarding",
  "orders",
]);

const isDynamicSegment = (segment: string) =>
  DYNAMIC_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment));

const segmentLabel = (
  segment: string,
  tNav: ReturnType<typeof useTranslations>,
  tBreadcrumbs: ReturnType<typeof useTranslations>,
  tPos: ReturnType<typeof useTranslations>,
) => {
  switch (segment) {
    case "dashboard":
      return tNav("dashboard");
    case "pos":
      return tNav("pos");
    case "sell":
      return tPos("entry.sell");
    case "history":
      return tPos("entry.history");
    case "shifts":
      return tPos("entry.shifts");
    case "registers":
      return tPos("entry.registers");
    case "inventory":
      return tNav("inventory");
    case "counts":
      return tBreadcrumbs("counts");
    case "products":
      return tNav("products");
    case "purchase-orders":
      return tNav("purchaseOrders");
    case "sales":
      return tBreadcrumbs("orders");
    case "orders":
      return tNav("salesOrders");
    case "suppliers":
      return tNav("suppliers");
    case "stores":
      return tNav("stores");
    case "users":
      return tNav("users");
    case "settings":
      return tBreadcrumbs("settings");
    case "attributes":
      return tNav("attributes");
    case "units":
      return tNav("units");
    case "import":
      return tNav("imports");
    case "whats-new":
      return tNav("whatsNew");
    case "profile":
      return tNav("profile");
    case "diagnostics":
      return tNav("diagnostics");
    case "reports":
      return tNav("reports");
    case "analytics":
      return tBreadcrumbs("analytics");
    case "exports":
      return tBreadcrumbs("exports");
    case "receipts":
      return tNav("posReceipts");
    case "close":
      return tBreadcrumbs("close");
    case "billing":
      return tNav("billing");
    case "onboarding":
      return tNav("onboarding");
    case "admin":
      return tBreadcrumbs("admin");
    case "support":
      return tNav("adminSupport");
    case "jobs":
      return tNav("adminJobs");
    case "metrics":
      return tBreadcrumbs("metrics");
    case "platform":
      return tNav("platform");
    case "help":
      return tNav("help");
    case "new":
      return tBreadcrumbs("create");
    case "edit":
      return tBreadcrumbs("edit");
    case "compliance":
      return tBreadcrumbs("compliance");
    default:
      return decodeURIComponent(segment).replace(/-/g, " ");
  }
};

export const PageBreadcrumbs = () => {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const tBreadcrumbs = useTranslations("breadcrumbs");
  const tPos = useTranslations("pos");

  const crumbs = useMemo(() => {
    const rawSegments = pathname.split("/").filter(Boolean);
    const segments = rawSegments.filter((segment) => !LOCALE_SEGMENTS.has(segment));

    if (segments.length < 2) {
      return [] as Crumb[];
    }

    const items: Crumb[] = [{ label: tBreadcrumbs("home"), href: "/dashboard" }];
    const pathParts: string[] = [];
    let hasDynamicSegment = false;

    for (const segment of segments) {
      if (isDynamicSegment(segment)) {
        pathParts.push(segment);
        hasDynamicSegment = true;
        continue;
      }

      pathParts.push(segment);

      const label = segmentLabel(segment, tNav, tBreadcrumbs, tPos);
      const href = LINKABLE_SEGMENTS.has(segment) ? `/${pathParts.join("/")}` : undefined;
      items.push({ label, href });
    }

    const hasExplicitAction = segments.includes("new") || segments.includes("edit");
    if (
      hasDynamicSegment &&
      !hasExplicitAction &&
      items[items.length - 1]?.label !== tBreadcrumbs("details")
    ) {
      items.push({ label: tBreadcrumbs("details") });
    }

    if (pathname.startsWith("/purchase-orders")) {
      const base: Crumb[] = [
        { label: tBreadcrumbs("home"), href: "/dashboard" },
        { label: tBreadcrumbs("orders") },
        { label: tNav("purchaseOrders"), href: "/purchase-orders" },
      ];

      const tail = items
        .slice(1)
        .filter((item) => item.label !== tNav("purchaseOrders") && item.label !== tBreadcrumbs("orders"));

      return [...base, ...tail];
    }

    return items;
  }, [pathname, tBreadcrumbs, tNav, tPos]);

  if (!crumbs.length) {
    return null;
  }

  return (
    <nav aria-label={tBreadcrumbs("ariaLabel")} className="mb-2 overflow-x-auto">
      <ol className="inline-flex min-w-max items-center gap-1 rounded-lg border border-border/70 bg-card/70 px-2 py-1 text-xs text-muted-foreground">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1">
              {index > 0 ? <span className="text-muted-foreground/60">/</span> : null}
              {isLast || !crumb.href ? (
                <span className="rounded-sm px-1.5 py-0.5 font-medium text-foreground">{crumb.label}</span>
              ) : (
                <Link
                  href={crumb.href}
                  className="rounded-sm px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
