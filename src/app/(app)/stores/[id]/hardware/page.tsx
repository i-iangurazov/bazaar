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
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { FormActions, FormStack } from "@/components/form-layout";
import {
  PRICE_TAG_ROLL_DEFAULTS,
  PRICE_TAG_ROLL_LIMITS,
  PRICE_TAG_TEMPLATES,
  ROLL_PRICE_TAG_TEMPLATE,
} from "@/lib/priceTags";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

type HardwareFormValues = {
  receiptPrintMode: PrinterPrintMode;
  labelPrintMode: PrinterPrintMode;
  receiptPrinterModel: string;
  labelPrinterModel: string;
  labelTemplate: (typeof PRICE_TAG_TEMPLATES)[number];
  labelPaperMode: "A4" | "ROLL" | "LABEL_PRINTER" | "THERMAL";
  labelBarcodeType: "auto" | "ean13" | "code128";
  labelDefaultCopies: number;
  labelShowProductName: boolean;
  labelShowPrice: boolean;
  labelShowSku: boolean;
  labelShowStoreName: boolean;
  labelRollGapMm: number;
  labelRollXOffsetMm: number;
  labelRollYOffsetMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  labelMarginTopMm: number;
  labelMarginRightMm: number;
  labelMarginBottomMm: number;
  labelMarginLeftMm: number;
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
        labelTemplate: z.enum(PRICE_TAG_TEMPLATES),
        labelPaperMode: z.enum(["A4", "ROLL", "LABEL_PRINTER", "THERMAL"]),
        labelBarcodeType: z.enum(["auto", "ean13", "code128"]),
        labelDefaultCopies: z.coerce.number().int().min(1, t("copiesRequired")).max(100),
        labelShowProductName: z.boolean(),
        labelShowPrice: z.boolean(),
        labelShowSku: z.boolean(),
        labelShowStoreName: z.boolean(),
        labelRollGapMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.gapMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.gapMm.max),
        labelRollXOffsetMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.offsetMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.offsetMm.max),
        labelRollYOffsetMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.offsetMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.offsetMm.max),
        labelWidthMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.widthMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.widthMm.max),
        labelHeightMm: z.coerce
          .number()
          .min(PRICE_TAG_ROLL_LIMITS.heightMm.min)
          .max(PRICE_TAG_ROLL_LIMITS.heightMm.max),
        labelMarginTopMm: z.coerce.number().min(0).max(20),
        labelMarginRightMm: z.coerce.number().min(0).max(20),
        labelMarginBottomMm: z.coerce.number().min(0).max(20),
        labelMarginLeftMm: z.coerce.number().min(0).max(20),
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
      labelTemplate: ROLL_PRICE_TAG_TEMPLATE,
      labelPaperMode: "ROLL",
      labelBarcodeType: "auto",
      labelDefaultCopies: 1,
      labelShowProductName: true,
      labelShowPrice: true,
      labelShowSku: true,
      labelShowStoreName: false,
      labelRollGapMm: PRICE_TAG_ROLL_DEFAULTS.gapMm,
      labelRollXOffsetMm: PRICE_TAG_ROLL_DEFAULTS.xOffsetMm,
      labelRollYOffsetMm: PRICE_TAG_ROLL_DEFAULTS.yOffsetMm,
      labelWidthMm: PRICE_TAG_ROLL_DEFAULTS.widthMm,
      labelHeightMm: PRICE_TAG_ROLL_DEFAULTS.heightMm,
      labelMarginTopMm: 0,
      labelMarginRightMm: 0,
      labelMarginBottomMm: 0,
      labelMarginLeftMm: 0,
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
      labelTemplate: settings.labelTemplate as HardwareFormValues["labelTemplate"],
      labelPaperMode: settings.labelPaperMode as HardwareFormValues["labelPaperMode"],
      labelBarcodeType: settings.labelBarcodeType as HardwareFormValues["labelBarcodeType"],
      labelDefaultCopies: settings.labelDefaultCopies,
      labelShowProductName: settings.labelShowProductName,
      labelShowPrice: settings.labelShowPrice,
      labelShowSku: settings.labelShowSku,
      labelShowStoreName: settings.labelShowStoreName,
      labelRollGapMm: settings.labelRollGapMm,
      labelRollXOffsetMm: settings.labelRollXOffsetMm,
      labelRollYOffsetMm: settings.labelRollYOffsetMm,
      labelWidthMm: settings.labelWidthMm,
      labelHeightMm: settings.labelHeightMm,
      labelMarginTopMm: settings.labelMarginTopMm,
      labelMarginRightMm: settings.labelMarginRightMm,
      labelMarginBottomMm: settings.labelMarginBottomMm,
      labelMarginLeftMm: settings.labelMarginLeftMm,
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
      labelTemplate: values.labelTemplate,
      labelPaperMode: values.labelPaperMode,
      labelBarcodeType: values.labelBarcodeType,
      labelDefaultCopies: values.labelDefaultCopies,
      labelShowProductName: values.labelShowProductName,
      labelShowPrice: values.labelShowPrice,
      labelShowSku: values.labelShowSku,
      labelShowStoreName: values.labelShowStoreName,
      labelRollGapMm: values.labelRollGapMm,
      labelRollXOffsetMm: values.labelRollXOffsetMm,
      labelRollYOffsetMm: values.labelRollYOffsetMm,
      labelWidthMm: values.labelWidthMm,
      labelHeightMm: values.labelHeightMm,
      labelMarginTopMm: values.labelMarginTopMm,
      labelMarginRightMm: values.labelMarginRightMm,
      labelMarginBottomMm: values.labelMarginBottomMm,
      labelMarginLeftMm: values.labelMarginLeftMm,
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

                    <div className="border-t border-border pt-4">
                      <div className="mb-3">
                        <h3 className="text-sm font-semibold text-foreground">
                          {t("labelProfileTitle")}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {t("labelProfileHint")}
                        </p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="labelTemplate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("labelTemplate")}</FormLabel>
                              <FormControl>
                                <Select
                                  value={field.value}
                                  onValueChange={(value) =>
                                    field.onChange(value as HardwareFormValues["labelTemplate"])
                                  }
                                  disabled={!canEdit}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("labelTemplate")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="xp365b-roll-58x40">
                                      {t("templateRollXp365b")}
                                    </SelectItem>
                                    <SelectItem value="3x8">{t("templateA4ThreeByEight")}</SelectItem>
                                    <SelectItem value="2x5">{t("templateA4TwoByFive")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="labelPaperMode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("labelPaperMode")}</FormLabel>
                              <FormControl>
                                <Select
                                  value={field.value}
                                  onValueChange={(value) =>
                                    field.onChange(value as HardwareFormValues["labelPaperMode"])
                                  }
                                  disabled={!canEdit}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("labelPaperMode")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="ROLL">{t("paperModeRoll")}</SelectItem>
                                    <SelectItem value="A4">{t("paperModeA4")}</SelectItem>
                                    <SelectItem value="LABEL_PRINTER">
                                      {t("paperModeLabelPrinter")}
                                    </SelectItem>
                                    <SelectItem value="THERMAL">{t("paperModeThermal")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="labelDefaultCopies"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("labelDefaultCopies")}</FormLabel>
                              <FormControl>
                                <Input {...field} type="number" min={1} max={100} disabled={!canEdit} />
                              </FormControl>
                              <FormDescription>{t("labelDefaultCopiesHint")}</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="labelBarcodeType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("labelBarcodeType")}</FormLabel>
                              <FormControl>
                                <Select
                                  value={field.value}
                                  onValueChange={(value) =>
                                    field.onChange(value as HardwareFormValues["labelBarcodeType"])
                                  }
                                  disabled={!canEdit}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder={t("labelBarcodeType")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="auto">{t("barcodeAuto")}</SelectItem>
                                    <SelectItem value="ean13">{t("barcodeEan13")}</SelectItem>
                                    <SelectItem value="code128">{t("barcodeCode128")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="labelWidthMm"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("labelWidthMm")}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="number"
                                  step={PRICE_TAG_ROLL_LIMITS.widthMm.step}
                                  disabled={!canEdit}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="labelHeightMm"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("labelHeightMm")}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="number"
                                  step={PRICE_TAG_ROLL_LIMITS.heightMm.step}
                                  disabled={!canEdit}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="labelRollGapMm"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t("labelRollGapMm")}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="number"
                                  step={PRICE_TAG_ROLL_LIMITS.gapMm.step}
                                  disabled={!canEdit}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField
                            control={form.control}
                            name="labelRollXOffsetMm"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t("labelRollXOffsetMm")}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="number"
                                    step={PRICE_TAG_ROLL_LIMITS.offsetMm.step}
                                    disabled={!canEdit}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="labelRollYOffsetMm"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t("labelRollYOffsetMm")}</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="number"
                                    step={PRICE_TAG_ROLL_LIMITS.offsetMm.step}
                                    disabled={!canEdit}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {t("labelMargins")}
                          </p>
                          <div className="grid gap-3 sm:grid-cols-4">
                            {(
                              [
                                ["labelMarginTopMm", "marginTop"],
                                ["labelMarginRightMm", "marginRight"],
                                ["labelMarginBottomMm", "marginBottom"],
                                ["labelMarginLeftMm", "marginLeft"],
                              ] as const
                            ).map(([name, labelKey]) => (
                              <FormField
                                key={name}
                                control={form.control}
                                name={name}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>{t(labelKey)}</FormLabel>
                                    <FormControl>
                                      <Input {...field} type="number" step={0.5} disabled={!canEdit} />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {(
                          [
                            ["labelShowProductName", "showProductName"],
                            ["labelShowPrice", "showPrice"],
                            ["labelShowSku", "showSku"],
                            ["labelShowStoreName", "showStoreName"],
                          ] as const
                        ).map(([name, labelKey]) => (
                          <FormField
                            key={name}
                            control={form.control}
                            name={name}
                            render={({ field }) => (
                              <FormItem className="flex items-center justify-between gap-3 border border-border bg-secondary/30 p-3">
                                <div>
                                  <FormLabel>{t(labelKey)}</FormLabel>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    disabled={!canEdit}
                                    aria-label={t(labelKey)}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                      {settingsQuery.data.settings.labelLastPrintedAt ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {t("lastPrintedAt", {
                            date: new Date(
                              settingsQuery.data.settings.labelLastPrintedAt,
                            ).toLocaleString(),
                          })}
                        </p>
                      ) : null}
                    </div>

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
