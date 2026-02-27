"use client";

import { useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { PrinterPrintMode } from "@prisma/client";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { FormActions, FormStack } from "@/components/form-layout";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

type HardwareFormValues = {
  receiptPrintMode: PrinterPrintMode;
  labelPrintMode: PrinterPrintMode;
  receiptPrinterModel: string;
  labelPrinterModel: string;
  connectorDeviceId: string;
};

const HardwarePage = () => {
  const t = useTranslations("storesHardware");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canView = role === "ADMIN" || role === "MANAGER" || role === "STAFF";
  const canEdit = role === "ADMIN" || role === "MANAGER";

  const params = useParams();
  const storeId = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  const settingsQuery = trpc.stores.hardware.useQuery(
    { storeId },
    { enabled: Boolean(storeId && canView) },
  );

  const schema = useMemo(
    () =>
      z.object({
        receiptPrintMode: z.nativeEnum(PrinterPrintMode),
        labelPrintMode: z.nativeEnum(PrinterPrintMode),
        receiptPrinterModel: z.string().min(1, t("modelRequired")),
        labelPrinterModel: z.string().min(1, t("modelRequired")),
        connectorDeviceId: z.string().optional().default(""),
      }),
    [t],
  );

  const form = useForm<HardwareFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      receiptPrintMode: PrinterPrintMode.PDF,
      labelPrintMode: PrinterPrintMode.PDF,
      receiptPrinterModel: "XP-P501A",
      labelPrinterModel: "XP-365B",
      connectorDeviceId: "",
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }
    const settings = settingsQuery.data.settings;
    form.reset({
      receiptPrintMode: settings.receiptPrintMode,
      labelPrintMode: settings.labelPrintMode,
      receiptPrinterModel: settings.receiptPrinterModel,
      labelPrinterModel: settings.labelPrinterModel,
      connectorDeviceId: settings.connectorDeviceId ?? "",
    });
  }, [form, settingsQuery.data]);

  const updateMutation = trpc.stores.updateHardware.useMutation({
    onSuccess: async () => {
      toast({ variant: "success", description: t("saved") });
      await settingsQuery.refetch();
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const connectorDevices = settingsQuery.data?.connectorDevices ?? [];
  const receiptMode = form.watch("receiptPrintMode");
  const labelMode = form.watch("labelPrintMode");
  const connectorRequired =
    receiptMode === PrinterPrintMode.CONNECTOR || labelMode === PrinterPrintMode.CONNECTOR;

  const handleSubmit = (values: HardwareFormValues) => {
    if (!canEdit) {
      return;
    }
    updateMutation.mutate({
      storeId,
      receiptPrintMode: values.receiptPrintMode,
      labelPrintMode: values.labelPrintMode,
      receiptPrinterModel: values.receiptPrinterModel.trim(),
      labelPrinterModel: values.labelPrinterModel.trim(),
      connectorDeviceId: values.connectorDeviceId.trim() || null,
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
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={
          settingsQuery.data?.store
            ? t("subtitleStore", { store: settingsQuery.data.store.name })
            : t("subtitle")
        }
      />

      {settingsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : null}

      {settingsQuery.error ? (
        <div className="text-sm text-danger">{translateError(tErrors, settingsQuery.error)}</div>
      ) : null}

      {!settingsQuery.data ? null : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("settingsTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)}>
                  <FormStack>
                    <FormField
                      control={form.control}
                      name="receiptPrintMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("receiptMode")}</FormLabel>
                          <FormControl>
                            <Select
                              value={field.value}
                              onValueChange={(value) => field.onChange(value as PrinterPrintMode)}
                              disabled={!canEdit}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t("modePlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={PrinterPrintMode.PDF}>{t("modePdf")}</SelectItem>
                                <SelectItem value={PrinterPrintMode.CONNECTOR}>{t("modeConnector")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormDescription>{t("receiptModeHint")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="labelPrintMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("labelMode")}</FormLabel>
                          <FormControl>
                            <Select
                              value={field.value}
                              onValueChange={(value) => field.onChange(value as PrinterPrintMode)}
                              disabled={!canEdit}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t("modePlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={PrinterPrintMode.PDF}>{t("modePdf")}</SelectItem>
                                <SelectItem value={PrinterPrintMode.CONNECTOR}>{t("modeConnector")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormDescription>{t("labelModeHint")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="receiptPrinterModel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("receiptModel")}</FormLabel>
                          <FormControl>
                            <Input {...field} disabled={!canEdit} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="labelPrinterModel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("labelModel")}</FormLabel>
                          <FormControl>
                            <Input {...field} disabled={!canEdit} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="connectorDeviceId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("connectorDevice")}</FormLabel>
                          <FormControl>
                            <Select
                              value={field.value || "none"}
                              onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                              disabled={!canEdit}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t("connectorDevicePlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">{t("connectorDeviceNone")}</SelectItem>
                                {connectorDevices.map((device) => (
                                  <SelectItem key={device.id} value={device.id}>
                                    {t("connectorDeviceOption", { name: device.name })}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormDescription>{t("connectorDeviceHint")}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {connectorRequired && !connectorDevices.length ? (
                      <p className="text-sm text-warning">{t("connectorDeviceMissingHint")}</p>
                    ) : null}

                    <FormActions>
                      <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => form.reset()}>
                        {t("reset")}
                      </Button>
                      <Button type="submit" className="w-full sm:w-auto" disabled={!canEdit || updateMutation.isLoading}>
                        {updateMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                        {updateMutation.isLoading ? tCommon("loading") : tCommon("save")}
                      </Button>
                    </FormActions>
                  </FormStack>
                </form>
              </Form>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("pdfModeTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>{t("pdfModeStep1")}</p>
                <p>{t("pdfModeStep2")}</p>
                <p>{t("pdfModeStep3")}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("connectorModeTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>{t("connectorModeStep1")}</p>
                <p>{t("connectorModeStep2")}</p>
                <p>{t("connectorModeStep3")}</p>
              </CardContent>
            </Card>
          </div>

          {!canEdit ? <p className="text-xs text-muted-foreground">{t("readOnly")}</p> : null}
        </>
      )}
    </div>
  );
};

export default HardwarePage;
