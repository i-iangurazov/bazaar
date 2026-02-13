"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import {
  Form,
  FormControl,
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
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { applyThemePreference, persistThemeCookie } from "@/lib/theme";
import { normalizeLocale } from "@/lib/locales";

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

  const canEditBusiness = session?.user?.role === "ADMIN" || Boolean(session?.user?.isOrgOwner);

  const personalSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(2, t("personal.validation.nameRequired")),
        phone: z.string().max(40).optional(),
        jobTitle: z.string().max(120).optional(),
      }),
    [t],
  );

  const preferencesSchema = useMemo(
    () =>
      z.object({
        preferredLocale: z.enum(["ru", "kg"]),
        themePreference: z.enum(["LIGHT", "DARK"]),
      }),
    [],
  );

  const businessSchema = useMemo(
    () =>
      z.object({
        organizationName: z.string().min(2, t("business.validation.organizationNameRequired")),
        storeId: z.string().min(1, t("business.validation.storeRequired")),
        legalEntityType: z.enum(["IP", "OSOO", "AO", "OTHER", "NONE"]),
        legalName: z.string().max(240).optional(),
        inn: z.string().max(32).optional(),
        address: z.string().max(512).optional(),
        phone: z.string().max(40).optional(),
      }),
    [t],
  );

  const profileQuery = trpc.userSettings.getMyProfile.useQuery(undefined, {
    enabled: status === "authenticated",
  });

  const [selectedStoreId, setSelectedStoreId] = useState<string | undefined>(undefined);

  const businessQuery = trpc.orgSettings.getBusinessProfile.useQuery(
    { storeId: selectedStoreId },
    { enabled: status === "authenticated" && canEditBusiness },
  );

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
      legalEntityType: "NONE",
      legalName: "",
      inn: "",
      address: "",
      phone: "",
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
    const businessData = businessQuery.data;
    if (!businessData?.selectedStore) {
      return;
    }
    setSelectedStoreId((current) => current ?? businessData.selectedStore?.id ?? undefined);
    businessForm.reset({
      organizationName: businessData.organization.name,
      storeId: businessData.selectedStore.id,
      legalEntityType: businessData.selectedStore.legalEntityType ?? "NONE",
      legalName: businessData.selectedStore.legalName ?? "",
      inn: businessData.selectedStore.inn ?? "",
      address: businessData.selectedStore.address ?? "",
      phone: businessData.selectedStore.phone ?? "",
    });
  }, [businessQuery.data, businessForm]);

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
  };

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

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
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

      <Card>
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
                            <SelectItem value="ru">{tCommon("locales.ru")}</SelectItem>
                            <SelectItem value="kg">{tCommon("locales.kg")}</SelectItem>
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
        <Card>
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
                    legalEntityType: values.legalEntityType === "NONE" ? null : values.legalEntityType,
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
                              {(businessQuery.data?.stores ?? []).map((store) => (
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
                              <SelectItem value="OSOO">{tRegister("legalEntityTypes.OSOO")}</SelectItem>
                              <SelectItem value="AO">{tRegister("legalEntityTypes.AO")}</SelectItem>
                              <SelectItem value="OTHER">{tRegister("legalEntityTypes.OTHER")}</SelectItem>
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
                <FormActions>
                  <Button
                    type="submit"
                    disabled={updateBusinessMutation.isLoading || businessQuery.isLoading}
                  >
                    {updateBusinessMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                    {tCommon("save")}
                  </Button>
                </FormActions>
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
