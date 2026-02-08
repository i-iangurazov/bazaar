"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { formatDateTime } from "@/lib/i18nFormat";

type BillingModalState = {
  organizationId: string;
  organizationName: string;
  plan: "STARTER" | "BUSINESS" | "ENTERPRISE";
  subscriptionStatus: "ACTIVE" | "PAST_DUE" | "CANCELED";
  trialDays: number;
  currentPeriodDays: number;
};

const normalizePlanForEditor = (
  plan: string,
): BillingModalState["plan"] => {
  if (plan === "BUSINESS" || plan === "ENTERPRISE" || plan === "STARTER") {
    return plan;
  }
  if (plan === "PRO") {
    return "BUSINESS";
  }
  return "STARTER";
};

const PlatformPage = () => {
  const { data: session, status } = useSession();
  const t = useTranslations("platformOwner");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const isPlatformOwner = Boolean(session?.user?.isPlatformOwner);
  const isForbidden = status === "authenticated" && !isPlatformOwner;
  const [billingModal, setBillingModal] = useState<BillingModalState | null>(null);

  const summaryQuery = trpc.platformOwner.summary.useQuery(undefined, {
    enabled: status === "authenticated" && isPlatformOwner,
  });

  const orgsQuery = trpc.platformOwner.listOrganizations.useQuery(undefined, {
    enabled: status === "authenticated" && isPlatformOwner,
  });

  const updateBillingMutation = trpc.platformOwner.updateOrganizationBilling.useMutation({
    onSuccess: () => {
      orgsQuery.refetch();
      setBillingModal(null);
      toast({ variant: "success", description: t("billingSaved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const sortedOrgs = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <Card>
          <CardContent className="py-8 text-sm text-gray-500">{tCommon("notAvailable")}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {summaryQuery.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t("summary.totalOrganizations")}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-ink">
              {summaryQuery.data.organizationsTotal}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t("summary.activeSubscriptions")}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-ink">
              {summaryQuery.data.organizationsPaid}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t("summary.estimatedMrr")}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-ink">
              {new Intl.NumberFormat(locale, {
                maximumFractionDigits: 0,
              }).format(summaryQuery.data.estimatedMrrKgs)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t("summary.activePlanMix")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-gray-600">
              <p>
                {t("summary.activePlanCount", {
                  plan: t("plans.starter"),
                  count: summaryQuery.data.activeByTier.STARTER,
                })}
              </p>
              <p>
                {t("summary.activePlanCount", {
                  plan: t("plans.business"),
                  count: summaryQuery.data.activeByTier.BUSINESS,
                })}
              </p>
              <p>
                {t("summary.activePlanCount", {
                  plan: t("plans.enterprise"),
                  count: summaryQuery.data.activeByTier.ENTERPRISE,
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("organizationsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {orgsQuery.isLoading ? (
            <div className="py-6">
              <Spinner className="h-5 w-5" />
            </div>
          ) : sortedOrgs.length === 0 ? (
            <p className="text-sm text-gray-500">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("organization")}</TableHead>
                    <TableHead>{t("plan")}</TableHead>
                    <TableHead>{t("subscriptionStatus")}</TableHead>
                    <TableHead>{t("stores")}</TableHead>
                    <TableHead>{t("users")}</TableHead>
                    <TableHead>{t("products")}</TableHead>
                    <TableHead>{t("trialEndsAt")}</TableHead>
                    <TableHead>{t("periodEndsAt")}</TableHead>
                    <TableHead>{t("createdAt")}</TableHead>
                    <TableHead>{tCommon("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedOrgs.map((org) => (
                    <TableRow key={org.id}>
                      <TableCell className="font-medium">{org.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            normalizePlanForEditor(org.plan) === "ENTERPRISE" ? "success" : "warning"
                          }
                        >
                          {t(`plans.${normalizePlanForEditor(org.plan).toLowerCase()}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={org.subscriptionStatus === "ACTIVE" ? "muted" : "danger"}>
                          {t(`subscriptionStatuses.${org.subscriptionStatus.toLowerCase()}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{org._count.stores}</TableCell>
                      <TableCell>{org._count.users}</TableCell>
                      <TableCell>{org._count.products}</TableCell>
                      <TableCell>
                        {org.trialEndsAt ? formatDateTime(org.trialEndsAt, locale) : tCommon("notAvailable")}
                      </TableCell>
                      <TableCell>
                        {org.currentPeriodEndsAt
                          ? formatDateTime(org.currentPeriodEndsAt, locale)
                          : tCommon("notAvailable")}
                      </TableCell>
                      <TableCell>{formatDateTime(org.createdAt, locale)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setBillingModal({
                              organizationId: org.id,
                              organizationName: org.name,
                              plan: normalizePlanForEditor(org.plan),
                              subscriptionStatus: org.subscriptionStatus,
                              trialDays: 14,
                              currentPeriodDays: 30,
                            })
                          }
                        >
                          {t("editBilling")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(billingModal)}
        onOpenChange={(open) => {
          if (!open) {
            setBillingModal(null);
          }
        }}
        title={t("editBillingTitle")}
      >
        {billingModal ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              updateBillingMutation.mutate({
                organizationId: billingModal.organizationId,
                plan: billingModal.plan,
                subscriptionStatus: billingModal.subscriptionStatus,
                trialDays: billingModal.trialDays,
                currentPeriodDays: billingModal.currentPeriodDays,
              });
            }}
          >
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-gray-500">{t("organization")}</p>
              <p className="font-medium text-ink">{billingModal.organizationName}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">{t("plan")}</p>
                <Select
                  value={billingModal.plan}
                  onValueChange={(value) =>
                    setBillingModal((prev) =>
                      prev ? { ...prev, plan: value as BillingModalState["plan"] } : prev,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STARTER">{t("plans.starter")}</SelectItem>
                    <SelectItem value="BUSINESS">{t("plans.business")}</SelectItem>
                    <SelectItem value="ENTERPRISE">{t("plans.enterprise")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">{t("subscriptionStatus")}</p>
                <Select
                  value={billingModal.subscriptionStatus}
                  onValueChange={(value) =>
                    setBillingModal((prev) =>
                      prev
                        ? {
                            ...prev,
                            subscriptionStatus: value as BillingModalState["subscriptionStatus"],
                          }
                        : prev,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">{t("subscriptionStatuses.active")}</SelectItem>
                    <SelectItem value="PAST_DUE">{t("subscriptionStatuses.past_due")}</SelectItem>
                    <SelectItem value="CANCELED">{t("subscriptionStatuses.canceled")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">{t("trialDays")}</p>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={billingModal.trialDays}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setBillingModal((prev) =>
                      prev ? { ...prev, trialDays: Number.isFinite(next) ? next : 0 } : prev,
                    );
                  }}
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">{t("currentPeriodDays")}</p>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={billingModal.currentPeriodDays}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setBillingModal((prev) =>
                      prev ? { ...prev, currentPeriodDays: Number.isFinite(next) ? next : 30 } : prev,
                    );
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setBillingModal(null)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={updateBillingMutation.isLoading}>
                {updateBillingMutation.isLoading ? tCommon("loading") : tCommon("save")}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
};

export default PlatformPage;
