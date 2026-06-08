"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { translateError } from "@/lib/translateError";
import { trpc } from "@/lib/trpc";

const StoreGroupsPage = () => {
  const t = useTranslations("storeGroups");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const overviewQuery = trpc.stores.assortmentOverview.useQuery();
  const stores = useMemo(() => overviewQuery.data?.stores ?? [], [overviewQuery.data?.stores]);
  const [sourceStoreId, setSourceStoreId] = useState("");
  const [targetStoreIds, setTargetStoreIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const previewMutation = trpc.stores.previewAssortmentShare.useMutation({
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });
  const applyMutation = trpc.stores.applyAssortmentShare.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("applySuccess") });
      previewMutation.reset();
      setTargetStoreIds([]);
      await Promise.all([
        overviewQuery.refetch(),
        trpcUtils.stores.list.invalidate(),
        trpcUtils.products.list.invalidate(),
        trpcUtils.products.searchQuick.invalidate(),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  useEffect(() => {
    if (sourceStoreId || !stores[0]) {
      return;
    }
    setSourceStoreId(stores[0].id);
    setGroupName(stores[0].productCatalog?.name ?? stores[0].name);
  }, [sourceStoreId, stores]);

  const sourceStore = stores.find((store) => store.id === sourceStoreId);
  const targetStoreSet = useMemo(() => new Set(targetStoreIds), [targetStoreIds]);
  const availableTargetStores = stores.filter((store) => store.id !== sourceStoreId);
  const canPreview = Boolean(sourceStoreId && targetStoreIds.length);
  const preview = previewMutation.data;

  const toggleTargetStore = (storeId: string) => {
    previewMutation.reset();
    setTargetStoreIds((current) =>
      current.includes(storeId)
        ? current.filter((currentStoreId) => currentStoreId !== storeId)
        : [...current, storeId],
    );
  };

  const handleSourceChange = (storeId: string) => {
    const nextSource = stores.find((store) => store.id === storeId);
    previewMutation.reset();
    setSourceStoreId(storeId);
    setTargetStoreIds((current) => current.filter((currentStoreId) => currentStoreId !== storeId));
    setGroupName(nextSource?.productCatalog?.name ?? nextSource?.name ?? "");
  };

  const previewChanges = () => {
    if (!canPreview) {
      return;
    }
    previewMutation.mutate({
      sourceStoreId,
      targetStoreIds,
      groupName: groupName.trim() || null,
    });
  };

  const applyChanges = () => {
    if (!preview || applyMutation.isLoading) {
      return;
    }
    applyMutation.mutate({
      sourceStoreId,
      targetStoreIds,
      groupName: groupName.trim() || null,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("modelTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">{t("ruleDefaultTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("ruleDefaultBody")}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">{t("ruleSharedTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("ruleSharedBody")}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">{t("ruleStockTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("ruleStockBody")}</p>
            </div>
          </div>
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
            {t("safePreviewNotice")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("createTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("createDescription")}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="assortment-group-name">{t("groupName")}</Label>
              <Input
                id="assortment-group-name"
                value={groupName}
                onChange={(event) => {
                  previewMutation.reset();
                  setGroupName(event.target.value);
                }}
                placeholder={t("groupNamePlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("groupNameHint")}</p>
            </div>

            <div className="space-y-2">
              <Label>{t("sourceStore")}</Label>
              <Select value={sourceStoreId} onValueChange={handleSourceChange}>
                <SelectTrigger>
                  <SelectValue placeholder={t("sourceStorePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name} ({store.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {sourceStore ? t("sourceCatalog", { catalog: sourceStore.productCatalog?.name ?? sourceStore.name }) : t("sourceStoreHint")}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label>{t("targetStores")}</Label>
                <p className="mt-1 text-xs text-muted-foreground">{t("targetStoresHint")}</p>
              </div>
              <Badge variant="muted">{t("selectedCount", { count: targetStoreIds.length })}</Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {availableTargetStores.map((store) => (
                <label
                  key={store.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition hover:border-primary/40"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-border"
                    checked={targetStoreSet.has(store.id)}
                    onChange={() => toggleTargetStore(store.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {store.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {store.code} · {store.productCatalog?.name ?? t("ownCatalog")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {!availableTargetStores.length ? (
              <p className="text-sm text-muted-foreground">{t("noTargetStores")}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 p-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <Label>{t("customerSharing")}</Label>
              <p className="text-sm text-muted-foreground">{t("customerSharingOrganizationWide")}</p>
              <p className="text-xs text-muted-foreground">{t("customerSharingOrganizationWideHint")}</p>
            </div>
            <Badge variant="success" className="w-fit shrink-0">
              {t("customersOrganizationWideBadge")}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={previewChanges} disabled={!canPreview || previewMutation.isLoading}>
              {previewMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
              {t("previewButton")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                previewMutation.reset();
                setTargetStoreIds([]);
              }}
              disabled={!targetStoreIds.length && !preview}
            >
              {tCommon("clearSelection")}
            </Button>
          </div>

          {preview ? (
            <div className="space-y-4 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{t("previewTitle")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("previewSummary", {
                      products: numberFormatter.format(preview.totalSharedProductCount),
                      stores: numberFormatter.format(preview.selectedStoreCount),
                    })}
                  </p>
                </div>
                <Badge variant="warning">{t("stockNotCopiedBadge")}</Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <Metric label={t("sourceProducts")} value={numberFormatter.format(preview.sourceProductCount)} />
                <Metric label={t("newAssignments")} value={numberFormatter.format(preview.totalProductsToAssign)} />
                <Metric label={t("zeroSnapshots")} value={numberFormatter.format(preview.totalZeroStockSnapshotsToCreate)} />
                <Metric label={t("targetBackShare")} value={numberFormatter.format(preview.targetProductsSharedBackToSource)} />
              </div>

              <div className="overflow-x-auto">
                <Table className="min-w-[780px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("store")}</TableHead>
                      <TableHead>{t("currentGroup")}</TableHead>
                      <TableHead>{t("productsToAdd")}</TableHead>
                      <TableHead>{t("sourceProductsToAdd")}</TableHead>
                      <TableHead>{t("zeroStockRows")}</TableHead>
                      <TableHead>{t("existingStock")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.targetImpacts.map((impact) => (
                      <TableRow key={impact.storeId}>
                        <TableCell className="font-medium">
                          {impact.storeName}
                          <div className="text-xs text-muted-foreground">{impact.storeCode}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{impact.currentCatalogName}</div>
                          {impact.willLeaveCurrentGroup ? (
                            <div className="text-xs text-warning">{t("willMoveGroup")}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>{numberFormatter.format(impact.productsToAdd)}</TableCell>
                        <TableCell>{numberFormatter.format(impact.sourceProductsToAdd)}</TableCell>
                        <TableCell>{numberFormatter.format(impact.zeroStockSnapshotsToCreate)}</TableCell>
                        <TableCell>{numberFormatter.format(impact.existingPositiveStockRows)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>{t("confirmationNoStockCopy")}</li>
                <li>{t("confirmationZeroStock")}</li>
                <li>{t("confirmationNoDelete")}</li>
                <li>{t("confirmationCustomerOrganizationWide")}</li>
              </ul>

              <Button type="button" onClick={applyChanges} disabled={applyMutation.isLoading}>
                {applyMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {t("applyButton")}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("configuredTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("configuredDescription")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {overviewQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : null}
          {overviewQuery.error ? (
            <p className="text-sm text-danger">{translateError(tErrors, overviewQuery.error)}</p>
          ) : null}
          {(overviewQuery.data?.groups ?? []).map((group) => (
            <section key={group.id} className="space-y-3 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{group.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("groupSummary", {
                      stores: numberFormatter.format(group.storeCount),
                      products: numberFormatter.format(group.productCount),
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={group.isShared ? "success" : "muted"}>
                    {group.isShared ? t("sharedAssortment") : t("separateStore")}
                  </Badge>
                  <Badge variant="success">{t("customersOrganizationWideBadge")}</Badge>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("store")}</TableHead>
                      <TableHead>{t("visibleProducts")}</TableHead>
                      <TableHead>{t("stockOwner")}</TableHead>
                      <TableHead>{t("stockRows")}</TableHead>
                      <TableHead>{t("productsLink")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.stores.map((store) => (
                      <TableRow key={store.id}>
                        <TableCell className="font-medium">
                          {store.name}
                          <div className="text-xs text-muted-foreground">{store.code}</div>
                        </TableCell>
                        <TableCell>{numberFormatter.format(store.visibleProductCount)}</TableCell>
                        <TableCell>{store.stockOwnerLabel}</TableCell>
                        <TableCell>{numberFormatter.format(store.stockSnapshotCount)}</TableCell>
                        <TableCell>
                          <Button asChild type="button" variant="ghost" size="sm">
                            <Link href={`/products?storeId=${encodeURIComponent(store.id)}`}>
                              {t("openProducts")}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ))}
          {!overviewQuery.isLoading && !(overviewQuery.data?.groups.length ?? 0) ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-border p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
  </div>
);

export default StoreGroupsPage;
