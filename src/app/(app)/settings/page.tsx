"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission, type AppPermission } from "@/lib/roleAccess";
import { cn } from "@/lib/utils";

type SettingsLink = {
  key: string;
  href: string;
  permission?: AppPermission;
  adminOnly?: boolean;
  orgOwnerOnly?: boolean;
};

const LINKS: SettingsLink[] = [
  { key: "profile", href: "/settings/profile" },
  { key: "users", href: "/settings/users", adminOnly: true, permission: "manageUsers" },
  { key: "loyalty", href: "/settings/loyalty", adminOnly: true, permission: "manageSettings" },
  { key: "printing", href: "/settings/printing", permission: "managePrinting" },
  { key: "storeGroups", href: "/settings/store-groups", adminOnly: true, permission: "manageSettings" },
  { key: "attributes", href: "/settings/attributes", permission: "manageProducts" },
  { key: "categories", href: "/settings/categories", adminOnly: true, permission: "manageProducts" },
  { key: "units", href: "/settings/units", permission: "manageProducts" },
  { key: "imports", href: "/settings/import", permission: "manageImports" },
  { key: "diagnostics", href: "/settings/diagnostics", orgOwnerOnly: true },
  { key: "whatsNew", href: "/settings/whats-new", adminOnly: true, permission: "manageSettings" },
];

export default function SettingsIndexPage() {
  const tNav = useTranslations("nav");
  const t = useTranslations("loyalty");
  const { data: session, status } = useSession();
  const access = {
    role: session?.user.role ?? "",
    isPlatformOwner: Boolean(session?.user.isPlatformOwner),
    isOrgOwner: Boolean(session?.user.isOrgOwner),
  };

  if (status === "loading") return <Skeleton className="h-96" />;

  const visible = LINKS.filter((link) => {
    if (link.adminOnly && access.role !== "ADMIN") return false;
    if (link.orgOwnerOnly && !access.isOrgOwner && access.role !== "ADMIN") return false;
    return hasPermission(access, link.permission);
  });

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader title={t("settingsIndexTitle")} subtitle={t("settingsIndexSubtitle")} />
      <nav className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className={cn(
              "rounded-xl border border-border bg-card p-4 text-sm font-medium transition",
              "hover:border-primary/40 hover:bg-secondary focus-visible:outline focus-visible:outline-2",
            )}
          >
            {tNav(link.key)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
