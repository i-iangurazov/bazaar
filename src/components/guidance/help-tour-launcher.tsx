"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { GuidanceTourTriggerButton } from "@/components/guidance/GuidanceButtons";
import { useGuidance } from "@/components/guidance/guidance-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { GuidanceFeature, GuidanceRole } from "@/lib/guidance";

export const HelpTourLauncher = () => {
  const t = useTranslations("guidance");
  const router = useRouter();
  const { role, features, completedTours, toursDisabled, setToursDisabled } = useGuidance();

  const launchableTours: {
    id: string;
    path: string;
    label: string;
    feature?: GuidanceFeature;
    roles?: GuidanceRole[];
  }[] = [
    { id: "dashboard-tour", path: "/dashboard", label: t("tours.dashboard.label") },
    { id: "products-tour", path: "/products", label: t("tours.products.label") },
    { id: "inventory-tour", path: "/inventory", label: t("tours.inventory.label") },
    { id: "purchase-orders-tour", path: "/purchase-orders", label: t("tours.purchaseOrders.label") },
    { id: "stock-counts-tour", path: "/inventory/counts", label: t("tours.stockCounts.label") },
    {
      id: "exports-tour",
      path: "/reports/exports",
      label: t("tours.exports.label"),
      feature: "exports" as GuidanceFeature,
      roles: ["ADMIN", "MANAGER"] as GuidanceRole[],
    },
    {
      id: "users-tour",
      path: "/settings/users",
      label: t("tours.users.label"),
      roles: ["ADMIN"] as GuidanceRole[],
    },
  ].filter((tour) => {
    if (tour.roles && !tour.roles.includes(role)) {
      return false;
    }
    if (tour.feature && !features.includes(tour.feature)) {
      return false;
    }
    return true;
  });

  if (!launchableTours.length) {
    return null;
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("tourLauncherTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t("disableToursLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("disableToursHint")}</p>
            </div>
            <Switch
              checked={toursDisabled}
              onCheckedChange={(next) => {
                void setToursDisabled(next);
              }}
              aria-label={t("disableToursLabel")}
            />
          </div>
        </div>
        {launchableTours.map((tour) => {
          const isCompleted = completedTours.has(tour.id);
          return (
            <div
              key={tour.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">{tour.label}</p>
                <Badge variant={isCompleted ? "success" : "warning"}>
                  {isCompleted ? t("tourCompleted") : t("tourPending")}
                </Badge>
              </div>
              <GuidanceTourTriggerButton
                label={t("openTipsPanel")}
                onClick={() => {
                  router.push(tour.path);
                }}
                className="shrink-0"
                disabled={toursDisabled}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
