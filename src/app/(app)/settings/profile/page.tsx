"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { ChevronDownIcon } from "@/components/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormActions, FormGrid } from "@/components/form-layout";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { applyThemePreference, persistThemeCookie } from "@/lib/theme";
import { locales, normalizeLocale } from "@/lib/locales";
import {
  defaultCurrencyRateKgsPerUnit,
  supportedCurrencyCodes,
  type SupportedCurrencyCode,
} from "@/lib/currency";

type ThemePreferenceValue = "LIGHT" | "DARK";

const isThemePreferenceValue = (value: string): value is ThemePreferenceValue =>
  value === "LIGHT" || value === "DARK";

const ProfilePage = () => {
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tRegister = useTranslations("registerBusiness");
  const { data: session, status, update: updateSession } = useSession();
  const { toast } = useToast();
  const trpcUtils = trpc.useUtils();

  const canEditBusiness = session?.user?.role === "ADMIN" || Boolean(session?.user?.isOrgOwner);
  const sessionIdentity =
    status === "authenticated" && session?.user?.id && session.user.organizationId
      ? `${session.user.organizationId}:${session.user.id}`
      : null;

  const personalSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t("personal.validation.nameRequired")),
        phone: z
          .string()
          .max(40, t("personal.validation.phoneMax", { max: 40 }))
          .optional(),
        jobTitle: z
          .string()
          .max(120, t("personal.validation.jobTitleMax", { max: 120 }))
          .optional(),
      }),
    [t],
  );

  const preferencesSchema = useMemo(
    () =>
      z.object({
        preferredLocale: z.enum(locales),
        themePreference: z.enum(["LIGHT", "DARK"]),
      }),
    [],
  );

  const businessSchema = useMemo(
    () =>
      z.object({
        organizationName: z.string().min(2, t("business.validation.organizationNameRequired")),
        storeId: z.string().min(1, t("business.validation.storeRequired")),
        currencyCode: z.enum(supportedCurrencyCodes),
        currencyRateKgsPerUnit: z.coerce
          .number()
          .positive(t("business.validation.currencyRateRequired")),
        legalEntityType: z.enum(["IP", "OSOO", "AO", "OTHER", "NONE"]),
        legalName: z
          .string()
          .max(240, t("business.validation.legalNameMax", { max: 240 }))
          .optional(),
        inn: z
          .string()
          .max(32, t("business.validation.innMax", { max: 32 }))
          .optional(),
        address: z
          .string()
          .max(512, t("business.validation.addressMax", { max: 512 }))
          .optional(),
        phone: z
          .string()
          .max(40, t("business.validation.phoneMax", { max: 40 }))
          .optional(),
      }),
    [t],
  );

  const productSettingsSchema = useMemo(
    () =>
      z.object({
        storeId: z.string().min(1, t("business.validation.storeRequired")),
        enableSku: z.boolean(),
        enableBarcode: z.boolean(),
        enableSimilarProductCheck: z.boolean(),
      }),
    [t],
  );

  const profileQuery = trpc.userSettings.getMyProfile.useQuery(undefined, {
    enabled: status === "authenticated",
  });

  const [selectedStoreId, setSelectedStoreId] = useState<string | undefined>(undefined);
  const lastSessionIdentityRef = useRef<string | null | undefined>(undefined);

  const businessQuery = trpc.orgSettings.getBusinessProfile.useQuery(
    { storeId: selectedStoreId },
    { enabled: status === "authenticated" && canEditBusiness },
  );
  const businessData =
    businessQuery.data?.organization.id === session?.user?.organizationId
      ? businessQuery.data
      : undefined;

  const personalForm = useForm<z.infer<typeof personalSchema>>({
    resolver: zodResolver(personalSchema),
    defaultValues: {
      name: "",
      phone: "",
      jobTitle: "",
    },
  });

  const preferencesForm = useForm<z.infer<typeof preferencesSchema>>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: {
      preferredLocale: "ru",
      themePreference: "LIGHT",
    },
  });

  const businessForm = useForm<z.infer<typeof businessSchema>>({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      organizationName: "",
      storeId: "",
      currencyCode: "KGS",
      currencyRateKgsPerUnit: defaultCurrencyRateKgsPerUnit,
      legalEntityType: "NONE",
      legalName: "",
      inn: "",
      address: "",
      phone: "",
    },
  });

  const productSettingsForm = useForm<z.infer<typeof productSettingsSchema>>({
    resolver: zodResolver(productSettingsSchema),
    defaultValues: {
      storeId: "",
      enableSku: true,
      enableBarcode: true,
      enableSimilarProductCheck: true,
    },
  });

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) {
      return;
    }
    personalForm.reset({
      name: profile.name,
      phone: profile.phone ?? "",
      jobTitle: profile.jobTitle ?? "",
    });
    preferencesForm.reset({
      preferredLocale: normalizeLocale(profile.preferredLocale) ?? "ru",
      themePreference: profile.themePreference === "DARK" ? "DARK" : "LIGHT",
    });
  }, [profileQuery.data, personalForm, preferencesForm]);

  useEffect(() => {
    if (!businessData?.selectedStore) {
      return;
    }
    setSelectedStoreId((current) =>
      current && businessData.stores.some((store) => store.id === current)
        ? current
        : (businessData.selectedStore?.id ?? undefined),
    );
    businessForm.reset({
      organizationName: businessData.organization.name,
      storeId: businessData.selectedStore.id,
      currencyCode: businessData.selectedStore.currencyCode ?? "KGS",
      currencyRateKgsPerUnit:
        businessData.selectedStore.currencyRateKgsPerUnit ?? defaultCurrencyRateKgsPerUnit,
      legalEntityType: businessData.selectedStore.legalEntityType ?? "NONE",
      legalName: businessData.selectedStore.legalName ?? "",
      inn: businessData.selectedStore.inn ?? "",
      address: businessData.selectedStore.address ?? "",
      phone: businessData.selectedStore.phone ?? "",
    });
    productSettingsForm.reset({
      storeId: businessData.selectedStore.id,
      enableSku: businessData.selectedStore.enableSku ?? true,
      enableBarcode: businessData.selectedStore.enableBarcode ?? true,
      enableSimilarProductCheck: businessData.selectedStore.enableSimilarProductCheck ?? true,
    });
  }, [businessData, businessForm, productSettingsForm]);

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (lastSessionIdentityRef.current === undefined) {
      lastSessionIdentityRef.current = sessionIdentity;
      return;
    }
    if (lastSessionIdentityRef.current === sessionIdentity) {
      return;
    }
    lastSessionIdentityRef.current = sessionIdentity;
    setSelectedStoreId(undefined);
    productSettingsForm.reset({
      storeId: "",
      enableSku: true,
      enableBarcode: true,
      enableSimilarProductCheck: true,
    });
  }, [productSettingsForm, sessionIdentity, status]);

  const updateProfileMutation = trpc.userSettings.updateMyProfile.useMutation({
    onSuccess: (result) => {
      profileQuery.refetch();
      personalForm.reset({
        name: result.name,
        phone: result.phone ?? "",
        jobTitle: result.jobTitle ?? "",
      });
      toast({ variant: "success", description: t("personal.saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updatePreferencesMutation = trpc.userSettings.updateMyPreferences.useMutation({
    onSuccess: async (result) => {
      profileQuery.refetch();
      await updateSession({
        preferredLocale: result.preferredLocale,
        themePreference: result.themePreference,
      });
      toast({ variant: "success", description: t("preferences.saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateThemeMutation = trpc.userSettings.updateMyPreferences.useMutation({
    onSuccess: async (result) => {
      await updateSession({
        preferredLocale: result.preferredLocale,
        themePreference: result.themePreference,
      });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateBusinessMutation = trpc.orgSettings.updateBusinessProfile.useMutation({
    onSuccess: (result) => {
      businessQuery.refetch();
      businessForm.reset({
        organizationName: result.organization.name,
        storeId: result.selectedStore.id,
        currencyCode: result.selectedStore.currencyCode ?? "KGS",
        currencyRateKgsPerUnit:
          result.selectedStore.currencyRateKgsPerUnit ?? defaultCurrencyRateKgsPerUnit,
        legalEntityType: result.selectedStore.legalEntityType ?? "NONE",
        legalName: result.selectedStore.legalName ?? "",
        inn: result.selectedStore.inn ?? "",
        address: result.selectedStore.address ?? "",
        phone: result.selectedStore.phone ?? "",
      });
      toast({ variant: "success", description: t("business.saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateProductSettingsMutation = trpc.stores.updateProductSettings.useMutation({
    onSuccess: async (result) => {
      productSettingsForm.reset({
        storeId: result.id,
        enableSku: result.enableSku ?? true,
        enableBarcode: result.enableBarcode ?? true,
        enableSimilarProductCheck: result.enableSimilarProductCheck ?? true,
      });
      await Promise.all([
        businessQuery.refetch(),
        trpcUtils.stores.list.invalidate(),
        trpcUtils.products.bootstrap.invalidate(),
        trpcUtils.products.getById.invalidate(),
        trpcUtils.products.storePricing.invalidate(),
        trpcUtils.products.searchQuick.invalidate(),
        trpcUtils.inventory.searchProducts.invalidate(),
      ]);
      toast({ variant: "success", description: t("productSettings.saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleThemeChange = (nextTheme: string) => {
    if (!isThemePreferenceValue(nextTheme)) {
      return;
    }
    preferencesForm.setValue("themePreference", nextTheme, { shouldDirty: true });
    applyThemePreference(nextTheme);
    persistThemeCookie(nextTheme);
    updateThemeMutation.mutate({ themePreference: nextTheme });
  };

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId);
    businessForm.setValue("storeId", storeId, { shouldDirty: true });
    productSettingsForm.setValue("storeId", storeId, { shouldDirty: false });
  };

  const selectedCurrency = businessForm.watch("currencyCode") as SupportedCurrencyCode;
  const selectedBusinessStore = businessData?.selectedStore ?? null;
  const productSettingsStoreId = productSettingsForm.watch("storeId");
  const productSettingsStorePending =
    Boolean(productSettingsStoreId) && selectedBusinessStore?.id !== productSettingsStoreId;
  const businessDataPending =
    canEditBusiness &&
    (businessQuery.isLoading ||
      businessQuery.isFetching ||
      (businessQuery.data !== undefined && businessData === undefined));
  const productSettingsLoading = businessDataPending || productSettingsStorePending;
  const productSettingsDisabled =
    productSettingsLoading || updateProductSettingsMutation.isLoading;

  if (status === "loading" || profileQuery.isLoading) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      </div>
    );
  }

  if (profileQuery.error) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{translateError(tErrors, profileQuery.error)}</p>
      </div>
    );
  }

  const userEmail = profileQuery.data?.email ?? session?.user?.email ?? "";
  const mobileSettingsCards = [
    ...(canEditBusiness
      ? [
          {
            href: "#store-profile",
            title: t("mobileHub.storeProfile.title"),
            description: t("mobileHub.storeProfile.description"),
          },
          {
            href: "#product-settings",
            title: t("mobileHub.productSettings.title"),
            description: t("mobileHub.productSettings.description"),
          },
          {
            href: "/settings/printing",
            title: t("mobileHub.printing.title"),
            description: t("mobileHub.printing.description"),
          },
          {
            href: "/settings/users",
            title: t("mobileHub.users.title"),
            description: t("mobileHub.users.description"),
          },
          {
            href: "/billing",
            title: t("mobileHub.subscription.title"),
            description: t("mobileHub.subscription.description"),
          },
        ]
      : []),
    {
      href: "#language-settings",
      title: t("mobileHub.language.title"),
      description: t("mobileHub.language.description"),
    },
    {
      href: "/help",
      title: t("mobileHub.support.title"),
      description: t("mobileHub.support.description"),
    },
    {
      href: "#account-settings",
      title: t("mobileHub.account.title"),
      description: t("mobileHub.account.description"),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <section className="space-y-3 md:hidden" data-mobile-settings-hub>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{t("mobileHub.title")}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("mobileHub.description")}
          </p>
        </div>
        <div className="grid gap-2">
          {mobileSettingsCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="flex min-h-16 items-center justify-between gap-3 border border-border bg-card px-4 py-3 text-left no-underline shadow-sm transition hover:border-primary/40 hover:bg-accent hover:no-underline"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{card.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {card.description}
                </span>
              </span>
              <ChevronDownIcon
                className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      </section>

      <Card id="account-settings" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{t("personal.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...personalForm}>
            <form
              className="space-y-4"
              onSubmit={personalForm.handleSubmit((values) => {
                updateProfileMutation.mutate({
                  name: values.name,
                  phone: values.phone ?? null,
                  jobTitle: values.jobTitle ?? null,
                });
              })}
            >
              <FormGrid>
                <FormField
                  control={personalForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("personal.name")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <Label>{t("personal.email")}</Label>
                  <Input value={userEmail} readOnly />
                </div>
                <FormField
                  control={personalForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("personal.phone")}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={personalForm.control}
                  name="jobTitle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("personal.jobTitle")}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>
              <FormActions>
                <Button type="submit" disabled={updateProfileMutation.isLoading}>
                  {updateProfileMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {tCommon("save")}
                </Button>
              </FormActions>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card id="language-settings" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{t("preferences.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...preferencesForm}>
            <form
              className="space-y-4"
              onSubmit={preferencesForm.handleSubmit((values) => {
                updatePreferencesMutation.mutate({
                  preferredLocale: values.preferredLocale,
                  themePreference: values.themePreference,
                });
              })}
            >
              <FormGrid>
                <FormField
                  control={preferencesForm.control}
                  name="preferredLocale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("preferences.locale")}</FormLabel>
                      <FormControl>
                        <Select value={field.value ?? "ru"} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {locales.map((availableLocale) => (
                              <SelectItem key={availableLocale} value={availableLocale}>
                                {tCommon(`locales.${availableLocale}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={preferencesForm.control}
                  name="themePreference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("preferences.theme")}</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value ?? "LIGHT"}
                          onValueChange={(value) => {
                            if (!isThemePreferenceValue(value)) {
                              return;
                            }
                            field.onChange(value);
                            handleThemeChange(value);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="LIGHT">{t("preferences.themes.light")}</SelectItem>
                            <SelectItem value="DARK">{t("preferences.themes.dark")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>
              <FormActions>
                <Button type="submit" disabled={updatePreferencesMutation.isLoading}>
                  {updatePreferencesMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                  {tCommon("save")}
                </Button>
              </FormActions>
            </form>
          </Form>
        </CardContent>
      </Card>

      {canEditBusiness ? (
        <Card id="store-profile" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>{t("business.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...businessForm}>
              <form
                className="space-y-4"
                onSubmit={businessForm.handleSubmit((values) => {
                  updateBusinessMutation.mutate({
                    organizationName: values.organizationName,
                    storeId: values.storeId,
                    currencyCode: values.currencyCode,
                    currencyRateKgsPerUnit:
                      values.currencyCode === "KGS"
                        ? defaultCurrencyRateKgsPerUnit
                        : values.currencyRateKgsPerUnit,
                    legalEntityType:
                      values.legalEntityType === "NONE" ? null : values.legalEntityType,
                    legalName: values.legalName ?? null,
                    inn: values.inn ?? null,
                    address: values.address ?? null,
                    phone: values.phone ?? null,
                  });
                })}
              >
                <FormGrid>
                  <FormField
                    control={businessForm.control}
                    name="organizationName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.organizationName")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="storeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.store")}</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              handleStoreChange(value);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t("business.selectStore")} />
                            </SelectTrigger>
                            <SelectContent>
                              {(businessData?.stores ?? []).map((store) => (
                                <SelectItem key={store.id} value={store.id}>
                                  {store.name} ({store.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="currencyCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.currency")}</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              if (value === "KGS") {
                                businessForm.setValue(
                                  "currencyRateKgsPerUnit",
                                  defaultCurrencyRateKgsPerUnit,
                                  { shouldDirty: true },
                                );
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {supportedCurrencyCodes.map((currencyCode) => (
                                <SelectItem key={currencyCode} value={currencyCode}>
                                  {t(`business.currencies.${currencyCode}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>{t("business.currencyHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="currencyRateKgsPerUnit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.currencyRateKgsPerUnit")}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            inputMode="decimal"
                            min="0.000001"
                            step="0.000001"
                            disabled={selectedCurrency === "KGS"}
                          />
                        </FormControl>
                        <FormDescription>
                          {selectedCurrency === "KGS"
                            ? t("business.currencyRateKgsHintKgs")
                            : t("business.currencyRateKgsHint", { currency: selectedCurrency })}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="legalEntityType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.legalEntityType")}</FormLabel>
                        <FormControl>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE">{t("business.none")}</SelectItem>
                              <SelectItem value="IP">{tRegister("legalEntityTypes.IP")}</SelectItem>
                              <SelectItem value="OSOO">
                                {tRegister("legalEntityTypes.OSOO")}
                              </SelectItem>
                              <SelectItem value="AO">{tRegister("legalEntityTypes.AO")}</SelectItem>
                              <SelectItem value="OTHER">
                                {tRegister("legalEntityTypes.OTHER")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="legalName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.legalName")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="inn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.inn")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.phone")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={businessForm.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("business.address")}</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
                <FormActions className="hidden md:flex">
                  <Button
                    type="submit"
                    disabled={updateBusinessMutation.isLoading || businessQuery.isLoading}
                  >
                    {updateBusinessMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {tCommon("save")}
                  </Button>
                </FormActions>
                <div className="border border-border bg-background p-3 md:hidden">
                  <Button
                    type="submit"
                    className="h-12 w-full"
                    disabled={updateBusinessMutation.isLoading || businessQuery.isLoading}
                  >
                    {updateBusinessMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {tCommon("save")}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      ) : null}

      {canEditBusiness ? (
        <Card id="product-settings" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>{t("productSettings.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("productSettings.description")}</p>
          </CardHeader>
          <CardContent>
            <Form {...productSettingsForm}>
              <form
                className="space-y-4"
                onSubmit={productSettingsForm.handleSubmit((values) => {
                  updateProductSettingsMutation.mutate({
                    storeId: values.storeId,
                    enableSku: values.enableSku,
                    enableBarcode: values.enableBarcode,
                    enableSimilarProductCheck: values.enableSimilarProductCheck,
                  });
                })}
              >
                <FormField
                  control={productSettingsForm.control}
                  name="storeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("business.store")}</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value}
                          onValueChange={(value) => {
                            field.onChange(value);
                            handleStoreChange(value);
                          }}
                          disabled={
                            businessQuery.isLoading || updateProductSettingsMutation.isLoading
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("business.selectStore")} />
                          </SelectTrigger>
                          <SelectContent>
                            {(businessData?.stores ?? []).map((store) => (
                              <SelectItem key={store.id} value={store.id}>
                                {store.name} ({store.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>{t("productSettings.storeHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {productSettingsLoading ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                    <Spinner className="h-4 w-4" />
                    {tCommon("loading")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <FormField
                      control={productSettingsForm.control}
                      name="enableSku"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                            <div className="space-y-1">
                              <FormLabel>{t("productSettings.enableSku")}</FormLabel>
                              <FormDescription>
                                {t("productSettings.enableSkuHint")}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={productSettingsDisabled}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={productSettingsForm.control}
                      name="enableBarcode"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                            <div className="space-y-1">
                              <FormLabel>{t("productSettings.enableBarcode")}</FormLabel>
                              <FormDescription>
                                {t("productSettings.enableBarcodeHint")}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={productSettingsDisabled}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={productSettingsForm.control}
                      name="enableSimilarProductCheck"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                            <div className="space-y-1">
                              <FormLabel>
                                {t("productSettings.enableSimilarProductCheck")}
                              </FormLabel>
                              <FormDescription>
                                {t("productSettings.enableSimilarProductCheckHint")}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={productSettingsDisabled}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                <FormActions className="hidden md:flex">
                  <Button
                    type="submit"
                    disabled={!selectedBusinessStore || productSettingsDisabled}
                  >
                    {updateProductSettingsMutation.isLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : null}
                    {tCommon("save")}
                  </Button>
                </FormActions>
                <div className="border border-border bg-background p-3 md:hidden">
                  <Button
                    type="submit"
                    className="h-12 w-full"
                    disabled={!selectedBusinessStore || productSettingsDisabled}
                  >
                    {updateProductSettingsMutation.isLoading ? (
                      <Spinner className="h-4 w-4" />
                    ) : null}
                    {tCommon("save")}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      ) : null}

      {businessQuery.error ? (
        <p className="text-sm text-danger">{translateError(tErrors, businessQuery.error)}</p>
      ) : null}
    </div>
  );
};

export default ProfilePage;
