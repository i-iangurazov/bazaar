"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { FormGrid } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

const onboardingFallback = {
  store: "pending",
  users: "pending",
  catalog: "pending",
  inventory: "pending",
  procurement: "pending",
  receive: "pending",
} as const;

const LEGAL_ENTITY_TYPES = {
  IP: "IP",
  OSOO: "OSOO",
  AO: "AO",
  OTHER: "OTHER",
} as const;

type LegalEntityTypeValue = (typeof LEGAL_ENTITY_TYPES)[keyof typeof LEGAL_ENTITY_TYPES];

const OnboardingPage = () => {
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tStores = useTranslations("stores");
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "ADMIN";
  const isForbidden = status === "authenticated" && !isAdmin;
  const { toast } = useToast();

  const onboardingQuery = trpc.onboarding.get.useQuery(undefined, { enabled: isAdmin });
  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: isAdmin });

  const createStoreMutation = trpc.stores.create.useMutation({
    onSuccess: () => {
      storesQuery.refetch();
      onboardingQuery.refetch();
      toast({ variant: "success", description: t("storeCreated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateLegalMutation = trpc.stores.updateLegalDetails.useMutation({
    onSuccess: () => {
      storesQuery.refetch();
      onboardingQuery.refetch();
      toast({ variant: "success", description: t("storeUpdated") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const defaultMinStockMutation = trpc.inventory.setDefaultMinStock.useMutation({
    onSuccess: (result) => {
      onboardingQuery.refetch();
      toast({ variant: "success", description: t("minStockApplied", { count: result.count }) });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const skipMutation = trpc.onboarding.skipStep.useMutation({
    onSuccess: () => {
      onboardingQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const [selectedStoreId, setSelectedStoreId] = useState<string>("");

  useEffect(() => {
    if (!selectedStoreId && storesQuery.data?.length) {
      setSelectedStoreId(storesQuery.data[0].id);
    }
  }, [selectedStoreId, storesQuery.data]);

  const selectedStore = storesQuery.data?.find((store) => store.id === selectedStoreId) ?? null;

  const storeSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("storeNameRequired")),
        code: z.string().min(1, t("storeCodeRequired")),
        legalEntityType: z.string().min(1, t("legalTypeRequired")),
        legalName: z.string().min(1, t("legalNameRequired")),
        inn: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
      }),
    [t],
  );

  const legalSchema = useMemo(
    () =>
      z.object({
        storeId: z.string().min(1, t("storeRequired")),
        legalEntityType: z.string().min(1, t("legalTypeRequired")),
        legalName: z.string().min(1, t("legalNameRequired")),
        inn: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
      }),
    [t],
  );

  const minStockSchema = useMemo(
    () =>
      z.object({
        storeId: z.string().min(1, t("storeRequired")),
        minStock: z.coerce.number().int().min(0, t("minStockRequired")),
      }),
    [t],
  );

  const storeForm = useForm<z.infer<typeof storeSchema>>({
    resolver: zodResolver(storeSchema),
    defaultValues: {
      name: "",
      code: "",
      legalEntityType: "",
      legalName: "",
      inn: "",
      address: "",
      phone: "",
    },
  });

  const legalForm = useForm<z.infer<typeof legalSchema>>({
    resolver: zodResolver(legalSchema),
    defaultValues: {
      storeId: "",
      legalEntityType: "",
      legalName: "",
      inn: "",
      address: "",
      phone: "",
    },
  });

  const minStockForm = useForm<z.infer<typeof minStockSchema>>({
    resolver: zodResolver(minStockSchema),
    defaultValues: {
      storeId: "",
      minStock: 0,
    },
  });

  useEffect(() => {
    if (selectedStore) {
      legalForm.reset({
        storeId: selectedStore.id,
        legalEntityType: selectedStore.legalEntityType ?? "",
        legalName: selectedStore.legalName ?? "",
        inn: selectedStore.inn ?? "",
        address: selectedStore.address ?? "",
        phone: selectedStore.phone ?? "",
      });

      minStockForm.setValue("storeId", selectedStore.id);
    }
  }, [selectedStore, legalForm, minStockForm]);

  const steps = onboardingQuery.data?.steps ?? onboardingFallback;

  const doneCount = Object.values(steps).filter((value) => value !== "pending").length;
  const totalCount = Object.values(steps).length;
  const progressPercent = Math.max(0, Math.min(100, Math.round((doneCount / totalCount) * 100)));

  const renderStatus = (statusValue: string) => {
    if (statusValue === "completed") {
      return <Badge variant="success">{t("status.completed")}</Badge>;
    }
    if (statusValue === "skipped") {
      return <Badge variant="muted">{t("status.skipped")}</Badge>;
    }
    return <Badge variant="warning">{t("status.pending")}</Badge>;
  };

  if (isForbidden) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  if (onboardingQuery.isLoading || storesQuery.isLoading) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      </div>
    );
  }

  const stats = onboardingQuery.data?.stats;
  const hasStores = (storesQuery.data?.length ?? 0) > 0;
  const legalComplete = (stats?.legalStoreCount ?? 0) > 0;

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {onboardingQuery.data?.completedAt ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t("completeTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{t("completeSubtitle")}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href="/dashboard">{t("goDashboard")}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/reports">{t("goReports")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("progressTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("progressLabel", { done: doneCount, total: totalCount })}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted/40">
            <div
              className="h-2 rounded-full bg-emerald-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t("steps.store.title")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("steps.store.description")}</p>
              </div>
              {renderStatus(steps.store)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">{t("currencyHint")}</p>
            {steps.store === "completed" ? (
              <div className="text-sm text-muted-foreground">{t("steps.store.completed")}</div>
            ) : !hasStores ? (
              <Form {...storeForm}>
                <form
                  className="space-y-4"
                  onSubmit={storeForm.handleSubmit((values) => {
                    createStoreMutation.mutate({
                      name: values.name,
                      code: values.code,
                      allowNegativeStock: false,
                      trackExpiryLots: false,
                      legalEntityType: values.legalEntityType as LegalEntityTypeValue,
                      legalName: values.legalName,
                      inn: values.inn || null,
                      address: values.address || null,
                      phone: values.phone || null,
                    });
                  })}
                >
                  <FormGrid>
                    <FormField
                      control={storeForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("name")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("namePlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={storeForm.control}
                      name="code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("code")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("codePlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={storeForm.control}
                      name="legalEntityType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("legalType")}</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={tStores("legalTypePlaceholder")} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={LEGAL_ENTITY_TYPES.IP}>{tStores("legalTypeIp")}</SelectItem>
                              <SelectItem value={LEGAL_ENTITY_TYPES.OSOO}>{tStores("legalTypeOsoo")}</SelectItem>
                              <SelectItem value={LEGAL_ENTITY_TYPES.AO}>{tStores("legalTypeAo")}</SelectItem>
                              <SelectItem value={LEGAL_ENTITY_TYPES.OTHER}>
                                {tStores("legalTypeOther")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={storeForm.control}
                      name="legalName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("legalName")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("legalNamePlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={storeForm.control}
                      name="inn"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("inn")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("innPlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={storeForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("address")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("addressPlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={storeForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("phone")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("phonePlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </FormGrid>
                  <Button type="submit" disabled={createStoreMutation.isLoading}>
                    {createStoreMutation.isLoading ? tCommon("loading") : t("storeCreate")}
                  </Button>
                </form>
              </Form>
            ) : legalComplete ? (
              <div className="text-sm text-muted-foreground">{t("steps.store.completed")}</div>
            ) : (
              <Form {...legalForm}>
                <form
                  className="space-y-4"
                  onSubmit={legalForm.handleSubmit((values) => {
                    updateLegalMutation.mutate({
                      storeId: values.storeId,
                      legalEntityType: values.legalEntityType as LegalEntityTypeValue,
                      legalName: values.legalName,
                      inn: values.inn || null,
                      address: values.address || null,
                      phone: values.phone || null,
                    });
                  })}
                >
                  <FormGrid>
                    <FormField
                      control={legalForm.control}
                      name="storeId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tCommon("store")}</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              setSelectedStoreId(value);
                            }}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={tCommon("selectStore")} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(storesQuery.data ?? []).map((store) => (
                                <SelectItem key={store.id} value={store.id}>
                                  {store.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={legalForm.control}
                      name="legalEntityType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("legalType")}</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={tStores("legalTypePlaceholder")} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={LEGAL_ENTITY_TYPES.IP}>{tStores("legalTypeIp")}</SelectItem>
                              <SelectItem value={LEGAL_ENTITY_TYPES.OSOO}>{tStores("legalTypeOsoo")}</SelectItem>
                              <SelectItem value={LEGAL_ENTITY_TYPES.AO}>{tStores("legalTypeAo")}</SelectItem>
                              <SelectItem value={LEGAL_ENTITY_TYPES.OTHER}>
                                {tStores("legalTypeOther")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={legalForm.control}
                      name="legalName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("legalName")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("legalNamePlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={legalForm.control}
                      name="inn"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("inn")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("innPlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={legalForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("address")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("addressPlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={legalForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tStores("phone")}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={tStores("phonePlaceholder")} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </FormGrid>
                  <Button type="submit" disabled={updateLegalMutation.isLoading}>
                    {updateLegalMutation.isLoading ? tCommon("loading") : t("storeSave")}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t("steps.users.title")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("steps.users.description")}</p>
              </div>
              {renderStatus(steps.users)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("steps.users.progress", { count: stats?.teamCount ?? 0 })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href="/settings/users">{t("steps.users.manage")}</Link>
              </Button>
              {steps.users === "pending" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => skipMutation.mutate({ step: "users" })}
                >
                  {t("skip")}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t("steps.catalog.title")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("steps.catalog.description")}</p>
              </div>
              {renderStatus(steps.catalog)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("steps.catalog.progress", { count: stats?.productCount ?? 0 })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href="/settings/import">{t("steps.catalog.import")}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/products/new">{t("steps.catalog.add")}</Link>
              </Button>
              {steps.catalog === "pending" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => skipMutation.mutate({ step: "catalog" })}
                >
                  {t("skip")}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t("steps.inventory.title")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("steps.inventory.description")}</p>
              </div>
              {renderStatus(steps.inventory)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Form {...minStockForm}>
              <form
                className="space-y-4"
                onSubmit={minStockForm.handleSubmit((values) => {
                  defaultMinStockMutation.mutate({
                    storeId: values.storeId,
                    minStock: values.minStock,
                  });
                })}
              >
                <FormGrid>
                  <FormField
                    control={minStockForm.control}
                    name="storeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{tCommon("store")}</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={tCommon("selectStore")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(storesQuery.data ?? []).map((store) => (
                              <SelectItem key={store.id} value={store.id}>
                                {store.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={minStockForm.control}
                    name="minStock"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("minStockLabel")}</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" min={0} />
                        </FormControl>
                        <FormDescription>{t("minStockHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={defaultMinStockMutation.isLoading}>
                    {defaultMinStockMutation.isLoading ? tCommon("loading") : t("minStockApply")}
                  </Button>
                  <Button asChild variant="secondary">
                    <Link href="/inventory">{t("steps.inventory.openInventory")}</Link>
                  </Button>
                  {steps.inventory === "pending" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => skipMutation.mutate({ step: "inventory" })}
                    >
                      {t("skip")}
                    </Button>
                  ) : null}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t("steps.procurement.title")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("steps.procurement.description")}</p>
              </div>
              {renderStatus(steps.procurement)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("steps.procurement.progress", {
                suppliers: stats?.supplierCount ?? 0,
                pos: stats?.purchaseOrderCount ?? 0,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href="/suppliers">{t("steps.procurement.suppliers")}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/purchase-orders/new">{t("steps.procurement.newPo")}</Link>
              </Button>
              {steps.procurement === "pending" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => skipMutation.mutate({ step: "procurement" })}
                >
                  {t("skip")}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t("steps.receive.title")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("steps.receive.description")}</p>
              </div>
              {renderStatus(steps.receive)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("steps.receive.progress", { count: stats?.receivedOrderCount ?? 0 })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href="/purchase-orders">{t("steps.receive.openPo")}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/products">{t("steps.receive.printTags")}</Link>
              </Button>
              {steps.receive === "pending" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => skipMutation.mutate({ step: "receive" })}
                >
                  {t("skip")}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OnboardingPage;
