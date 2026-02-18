"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormActions, FormStack } from "@/components/form-layout";
import { useToast } from "@/components/ui/toast";
import { ChevronDownIcon } from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";

type FormValues = {
  defaultLocale: string;
  taxRegime: string;
  enableKkm: boolean;
  kkmMode: KkmModeValue;
  enableEsf: boolean;
  enableEttn: boolean;
  enableMarking: boolean;
  markingMode: MarkingModeValue;
  kkmProviderKey: string;
  kkmSettingsText: string;
};

const KKM_MODE = {
  OFF: "OFF",
  EXPORT_ONLY: "EXPORT_ONLY",
  CONNECTOR: "CONNECTOR",
  ADAPTER: "ADAPTER",
} as const;

type KkmModeValue = (typeof KKM_MODE)[keyof typeof KKM_MODE];

const MARKING_MODE = {
  OFF: "OFF",
  OPTIONAL: "OPTIONAL",
  REQUIRED_ON_SALE: "REQUIRED_ON_SALE",
} as const;

type MarkingModeValue = (typeof MARKING_MODE)[keyof typeof MARKING_MODE];

const emptyForm: FormValues = {
  defaultLocale: "",
  taxRegime: "",
  enableKkm: false,
  kkmMode: KKM_MODE.OFF,
  enableEsf: false,
  enableEttn: false,
  enableMarking: false,
  markingMode: MARKING_MODE.OFF,
  kkmProviderKey: "",
  kkmSettingsText: "",
};

const CompliancePage = () => {
  const t = useTranslations("compliance");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canView = role === "ADMIN" || role === "MANAGER";
  const canEdit = role === "ADMIN";
  const { toast } = useToast();
  const params = useParams();
  const storeId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  const storesQuery = trpc.stores.list.useQuery(undefined, { enabled: Boolean(storeId) });
  const profileQuery = trpc.compliance.getStore.useQuery(
    { storeId },
    { enabled: Boolean(storeId) },
  );

  const store = storesQuery.data?.find((item) => item.id === storeId);

  const schema = useMemo(
    () =>
      z.object({
        defaultLocale: z.string().optional(),
        taxRegime: z.string().optional(),
        enableKkm: z.boolean(),
        kkmMode: z.enum([
          KKM_MODE.OFF,
          KKM_MODE.EXPORT_ONLY,
          KKM_MODE.CONNECTOR,
          KKM_MODE.ADAPTER,
        ]),
        enableEsf: z.boolean(),
        enableEttn: z.boolean(),
        enableMarking: z.boolean(),
        markingMode: z.enum([
          MARKING_MODE.OFF,
          MARKING_MODE.OPTIONAL,
          MARKING_MODE.REQUIRED_ON_SALE,
        ]),
        kkmProviderKey: z.string().optional(),
        kkmSettingsText: z.string().optional(),
      }),
    [],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyForm,
  });

  useEffect(() => {
    if (!profileQuery.data) {
      form.reset(emptyForm);
      return;
    }
    const profile = profileQuery.data;
    form.reset({
      defaultLocale: profile.defaultLocale ?? "",
      taxRegime: profile.taxRegime ?? "",
      enableKkm: profile.enableKkm,
      kkmMode: profile.kkmMode,
      enableEsf: profile.enableEsf,
      enableEttn: profile.enableEttn,
      enableMarking: profile.enableMarking,
      markingMode: profile.markingMode ?? MARKING_MODE.OFF,
      kkmProviderKey: profile.kkmProviderKey ?? "",
      kkmSettingsText: profile.kkmSettings ? JSON.stringify(profile.kkmSettings, null, 2) : "",
    });
  }, [profileQuery.data, form]);

  const markingEnabled = form.watch("enableMarking");
  const markingMode = form.watch("markingMode");

  useEffect(() => {
    if (!markingEnabled && markingMode !== MARKING_MODE.OFF) {
      form.setValue("markingMode", MARKING_MODE.OFF, { shouldDirty: true });
      return;
    }
    if (markingEnabled && markingMode === MARKING_MODE.OFF) {
      form.setValue("markingMode", MARKING_MODE.OPTIONAL, { shouldDirty: true });
    }
  }, [form, markingEnabled, markingMode]);

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const updateMutation = trpc.compliance.updateStore.useMutation({
    onSuccess: () => {
      toast({ variant: "success", description: t("saved") });
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const handleSubmit = (values: FormValues) => {
    let parsedSettings: Record<string, unknown> | null = null;
    if (values.kkmSettingsText?.trim()) {
      try {
        parsedSettings = JSON.parse(values.kkmSettingsText);
      } catch {
        toast({ variant: "error", description: t("invalidJson") });
        return;
      }
    }

    updateMutation.mutate({
      storeId,
      defaultLocale: values.defaultLocale || null,
      taxRegime: values.taxRegime || null,
      enableKkm: values.enableKkm,
      kkmMode: values.kkmMode,
      enableEsf: values.enableEsf,
      enableEttn: values.enableEttn,
      enableMarking: values.enableMarking,
      markingMode: values.enableMarking ? values.markingMode : MARKING_MODE.OFF,
      kkmProviderKey: values.kkmProviderKey || null,
      kkmSettings: parsedSettings,
    });
  };

  if (!canView) {
    return (
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <p className="mt-4 text-sm text-danger">{tErrors("forbidden")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={store ? t("subtitleStore", { store: store.name }) : t("subtitle")}
      />

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>{t("cardTitle")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("cardSubtitle")}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            <ChevronDownIcon
              className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
            {advancedOpen ? t("advancedHide") : t("advancedShow")}
          </Button>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)}>
              <FormStack>
                <Button asChild type="button" variant="ghost" className="justify-start px-0">
                  <Link href="/help/compliance">{t("helpLink")}</Link>
                </Button>
                <FormField
                  control={form.control}
                  name="enableKkm"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
                      <div>
                        <FormLabel>{t("kkmToggle")}</FormLabel>
                        <p className="text-xs text-muted-foreground">{t("kkmHint")}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enableEsf"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
                      <div>
                        <FormLabel>{t("esfToggle")}</FormLabel>
                        <p className="text-xs text-muted-foreground">{t("esfHint")}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enableEttn"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
                      <div>
                        <FormLabel>{t("ettnToggle")}</FormLabel>
                        <p className="text-xs text-muted-foreground">{t("ettnHint")}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enableMarking"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
                      <div>
                        <FormLabel>{t("markingToggle")}</FormLabel>
                        <p className="text-xs text-muted-foreground">{t("markingHint")}</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {markingEnabled ? (
                  <FormField
                    control={form.control}
                    name="markingMode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("markingMode")}</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value}
                            onValueChange={(value) => field.onChange(value as MarkingModeValue)}
                            disabled={!canEdit}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t("markingMode")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={MARKING_MODE.OPTIONAL}>
                                {t("markingModeOptional")}
                              </SelectItem>
                              <SelectItem value={MARKING_MODE.REQUIRED_ON_SALE}>
                                {t("markingModeRequired")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <p className="text-xs text-muted-foreground">{t("markingModeHint")}</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}

                {advancedOpen ? (
                  <div className="rounded-lg border p-4">
                    <p className="mb-4 text-sm text-muted-foreground">{t("advancedIntro")}</p>
                    <FormStack>
                      <FormField
                        control={form.control}
                        name="defaultLocale"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("defaultLocale")}</FormLabel>
                            <FormControl>
                              <Select
                                value={field.value || "ru"}
                                onValueChange={field.onChange}
                                disabled={!canEdit}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={tCommon("selectLocale")} />
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
                        control={form.control}
                        name="taxRegime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("taxRegime")}</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value ?? ""} disabled={!canEdit} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="kkmMode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("kkmMode")}</FormLabel>
                            <FormControl>
                              <Select
                                value={field.value}
                                onValueChange={(value) => field.onChange(value as KkmModeValue)}
                                disabled={!canEdit}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t("kkmMode")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={KKM_MODE.OFF}>{t("kkmModeOff")}</SelectItem>
                                  <SelectItem value={KKM_MODE.EXPORT_ONLY}>{t("kkmModeExport")}</SelectItem>
                                  <SelectItem value={KKM_MODE.CONNECTOR}>{t("kkmModeConnector")}</SelectItem>
                                  <SelectItem value={KKM_MODE.ADAPTER}>{t("kkmModeAdapter")}</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {form.watch("enableKkm") && form.watch("kkmMode") === KKM_MODE.EXPORT_ONLY ? (
                        <p className="text-xs text-muted-foreground">{t("exportOnlyHint")}</p>
                      ) : null}
                      {form.watch("enableKkm") && form.watch("kkmMode") === KKM_MODE.CONNECTOR ? (
                        <p className="text-xs text-muted-foreground">{t("connectorHint")}</p>
                      ) : null}
                      {form.watch("enableKkm") && form.watch("kkmMode") === KKM_MODE.ADAPTER ? (
                        <p className="text-xs text-muted-foreground">{t("adapterHint")}</p>
                      ) : null}

                      <FormField
                        control={form.control}
                        name="kkmProviderKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("providerKey")}</FormLabel>
                            <FormControl>
                              <Input {...field} value={field.value ?? ""} disabled={!canEdit} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="kkmSettingsText"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("settingsJson")}</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                value={field.value ?? ""}
                                className="min-h-[120px]"
                                disabled={!canEdit}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </FormStack>
                  </div>
                ) : null}

                {!canEdit ? (
                  <p className="text-xs text-muted-foreground">{t("readOnlyHint")}</p>
                ) : null}
              </FormStack>

              {canEdit ? (
                <FormActions>
                  <Button type="submit" disabled={updateMutation.isLoading}>
                    {updateMutation.isLoading ? tCommon("loading") : tCommon("save")}
                  </Button>
                </FormActions>
              ) : null}
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
};

export default CompliancePage;
