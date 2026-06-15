"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { ArchiveIcon, HideIcon, RestoreIcon, ViewIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type CategoryFilter = "ACTIVE" | "HIDDEN" | "ARCHIVED" | "ALL";

const normalizeCategorySearch = (value: string) => value.trim().toLocaleLowerCase("ru-RU");

const CategorySettingsPage = () => {
  const t = useTranslations("categorySettings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: session } = useSession();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();
  const storesQuery = trpc.stores.list.useQuery();
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("ACTIVE");
  const canManageCategories = session?.user?.role === "ADMIN" || Boolean(session?.user?.isOrgOwner);

  useEffect(() => {
    if (storeId || !storesQuery.data?.length) {
      return;
    }
    setStoreId(storesQuery.data[0]?.id ?? "");
  }, [storeId, storesQuery.data]);

  const selectedStore = useMemo(
    () => storesQuery.data?.find((store) => store.id === storeId) ?? null,
    [storeId, storesQuery.data],
  );

  const categoriesQuery = trpc.productCategories.listForStore.useQuery(
    { storeId, includeHidden: true },
    { enabled: Boolean(storeId) },
  );

  const updateVisibilityMutation = trpc.productCategories.setStoreVisibility.useMutation({
    onSuccess: async (_data, variables) => {
      await trpcUtils.productCategories.listForStore.invalidate({
        storeId: variables.storeId,
        includeHidden: true,
      });
      toast({ variant: "success", description: t("saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const categories = useMemo(() => {
    const query = normalizeCategorySearch(search);
    return (categoriesQuery.data ?? []).filter((category) => {
      if (query && !category.name.toLocaleLowerCase("ru-RU").includes(query)) {
        return false;
      }
      if (filter === "ACTIVE") {
        return category.isVisibleInForms && !category.isArchived;
      }
      if (filter === "HIDDEN") {
        return !category.isVisibleInForms && !category.isArchived;
      }
      if (filter === "ARCHIVED") {
        return category.isArchived;
      }
      return true;
    });
  }, [categoriesQuery.data, filter, search]);

  const categoryCounts = useMemo(() => {
    const rows = categoriesQuery.data ?? [];
    return {
      ACTIVE: rows.filter((category) => category.isVisibleInForms && !category.isArchived).length,
      HIDDEN: rows.filter((category) => !category.isVisibleInForms && !category.isArchived).length,
      ARCHIVED: rows.filter((category) => category.isArchived).length,
      ALL: rows.length,
    };
  }, [categoriesQuery.data]);

  const updateCategory = (
    name: string,
    values: { isVisibleInForms?: boolean; isArchived?: boolean },
  ) => {
    if (!storeId || !canManageCategories) {
      return;
    }
    updateVisibilityMutation.mutate({
      storeId,
      name,
      ...values,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card className="bazaar-admin-surface">
        <CardHeader className="border-b border-border/60 bg-muted/20">
          <CardTitle>{t("controlsTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("controlsDescription")}</p>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("store")}</label>
              <Select value={storeId} onValueChange={setStoreId} disabled={storesQuery.isLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={t("storePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {(storesQuery.data ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name} ({store.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedStore ? (
                <p className="text-xs text-muted-foreground">
                  {t("storeHint", { store: selectedStore.name })}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("search")}</label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
              />
            </div>
          </div>

          {!canManageCategories ? (
            <div className="bazaar-admin-notice border-warning/30 bg-warning/10 text-warning">
              {t("adminOnly")}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {(["ACTIVE", "HIDDEN", "ARCHIVED", "ALL"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={filter === value ? "default" : "secondary"}
                size="sm"
                onClick={() => setFilter(value)}
              >
                {t(`filters.${value.toLowerCase()}`)}
                <span className="text-xs opacity-70">{categoryCounts[value]}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bazaar-admin-surface">
        <CardHeader className="border-b border-border/60 bg-muted/20">
          <CardTitle>{t("listTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("listDescription")}</p>
        </CardHeader>
        <CardContent>
          {categoriesQuery.isLoading ? (
            <div className="bazaar-admin-empty min-h-[9rem] gap-2">
              <Spinner className="h-4 w-4" />
              {tCommon("loading")}
            </div>
          ) : categories.length ? (
            <div className="grid gap-3">
              {categories.map((category) => {
                const isHidden = !category.isVisibleInForms && !category.isArchived;
                const isArchived = category.isArchived;
                const statusVariant = isArchived ? "muted" : isHidden ? "warning" : "success";
                const statusLabel = isArchived
                  ? t("statuses.archived")
                  : isHidden
                    ? t("statuses.hidden")
                    : t("statuses.active");

                return (
                  <div
                    key={category.normalizedName}
                    className="bazaar-admin-mobile-card flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-foreground">
                          {category.name}
                        </h2>
                        <Badge variant={statusVariant}>{statusLabel}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t("productCount", { count: category.productCount })}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {isArchived || isHidden ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canManageCategories || updateVisibilityMutation.isLoading}
                          onClick={() =>
                            updateCategory(category.name, {
                              isVisibleInForms: true,
                              isArchived: false,
                            })
                          }
                        >
                          <ViewIcon className="h-4 w-4" aria-hidden />
                          {t("actions.show")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canManageCategories || updateVisibilityMutation.isLoading}
                          onClick={() =>
                            updateCategory(category.name, {
                              isVisibleInForms: false,
                              isArchived: false,
                            })
                          }
                        >
                          <HideIcon className="h-4 w-4" aria-hidden />
                          {t("actions.hide")}
                        </Button>
                      )}
                      {isArchived ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canManageCategories || updateVisibilityMutation.isLoading}
                          onClick={() =>
                            updateCategory(category.name, {
                              isVisibleInForms: true,
                              isArchived: false,
                            })
                          }
                        >
                          <RestoreIcon className="h-4 w-4" aria-hidden />
                          {t("actions.restore")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!canManageCategories || updateVisibilityMutation.isLoading}
                          onClick={() =>
                            updateCategory(category.name, {
                              isVisibleInForms: false,
                              isArchived: true,
                            })
                          }
                        >
                          <ArchiveIcon className="h-4 w-4" aria-hidden />
                          {t("actions.archive")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bazaar-admin-empty space-y-2">
              <p>{t("empty")}</p>
              <p>
                <Link href="/products/new" className="font-semibold text-primary">
                  {t("emptyAction")}
                </Link>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CategorySettingsPage;
