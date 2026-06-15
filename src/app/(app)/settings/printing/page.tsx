"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PrinterPrintMode } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyIcon, PrintIcon, StatusSuccessIcon, StatusWarningIcon } from "@/components/icons";
import {
  PRICE_TAG_ROLL_DEFAULTS,
  PRICE_TAG_ROLL_LIMITS,
  PRICE_TAG_TEMPLATES,
  ROLL_PRICE_TAG_TEMPLATE,
} from "@/lib/priceTags";
import {
  connectQzTray,
  fetchQzSigningStatus,
  getQzSigningStatusSnapshot,
  getQzTrayBinding,
  getQzTrustStatus,
  listQzPrinters,
  printHtmlViaQzTray,
  qzTrayErrorMessageKey,
  saveQzTrayBinding,
  type QzTrayBinding,
  type QzTrayStatus,
  type QzSigningStatus,
  type QzTrustStatus,
} from "@/lib/qzTrayPrint";
import {
  isProductionAutoPrintProvider,
  normalizePrintProvider,
  type PrintProvider,
} from "@/lib/printProviders";
import { trpc } from "@/lib/trpc";
import { translateError } from "@/lib/translateError";
import { useToast } from "@/components/ui/toast";

type ReceiptPaperSize = "58MM" | "80MM" | "A4" | "CUSTOM";
type ReceiptUsage = "PRINT" | "EXPORT" | "BOTH";
type ReceiptFallback = "NONE" | "MANUAL_BROWSER_PRINT";
type LabelLayoutOrder =
  | "PRICE_NAME_BARCODE"
  | "NAME_BARCODE_PRICE"
  | "BARCODE_ONLY"
  | "NAME_BARCODE"
  | "PRICE_BARCODE";

type PrintingFormValues = {
  receiptPrintProvider: PrintProvider;
  labelPrintProvider: PrintProvider;
  receiptAutoPrintEnabled: boolean;
  receiptFallbackMode: ReceiptFallback;
  receiptTemplateUsage: ReceiptUsage;
  receiptPaperSize: ReceiptPaperSize;
  receiptCustomWidthMm: number;
  receiptCustomHeightMm: number;
  receiptMarginTopMm: number;
  receiptMarginRightMm: number;
  receiptMarginBottomMm: number;
  receiptMarginLeftMm: number;
  receiptFontSize: number;
  receiptShowStoreName: boolean;
  receiptShowStoreAddress: boolean;
  receiptShowStorePhone: boolean;
  receiptShowLogo: boolean;
  receiptShowCashierName: boolean;
  receiptShowSaleNumber: boolean;
  receiptShowDateTime: boolean;
  receiptShowProductName: boolean;
  receiptShowProductSku: boolean;
  receiptShowProductBarcode: boolean;
  receiptShowProductUnitPrice: boolean;
  receiptShowProductQuantity: boolean;
  receiptShowDiscount: boolean;
  receiptShowSubtotal: boolean;
  receiptShowPaymentMethod: boolean;
  receiptShowTotal: boolean;
  receiptShowChange: boolean;
  receiptFooterText: string;
  receiptPrinterModel: string;
  labelPrinterModel: string;
  labelTemplate: (typeof PRICE_TAG_TEMPLATES)[number];
  labelPaperMode: "A4" | "ROLL" | "LABEL_PRINTER" | "THERMAL";
  labelBarcodeType: "auto" | "ean13" | "code128";
  labelLayoutOrder: LabelLayoutOrder;
  labelDefaultCopies: number;
  labelShowProductName: boolean;
  labelShowPrice: boolean;
  labelShowSku: boolean;
  labelShowBarcodeText: boolean;
  labelShowCurrency: boolean;
  labelShowStoreName: boolean;
  labelBarcodeHeightMm: number;
  labelFontSize: number;
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

type PrintingPreviewSample = {
  receiptTestTitle: string;
  receiptHeading: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  receiptNumber: string;
  receiptDateTime: string;
  cashier: string;
  productName: string;
  sku: string;
  barcode: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  subtotal: string;
  discount: string;
  total: string;
  paymentMethod: string;
  paymentAmount: string;
  change: string;
  changeAmount: string;
  price: string;
};

const providerToPrintMode = (provider: PrintProvider) =>
  isProductionAutoPrintProvider(provider) ? PrinterPrintMode.CONNECTOR : PrinterPrintMode.PDF;

const defaultFormValues: PrintingFormValues = {
  receiptPrintProvider: "DISABLED",
  labelPrintProvider: "DISABLED",
  receiptAutoPrintEnabled: false,
  receiptFallbackMode: "MANUAL_BROWSER_PRINT",
  receiptTemplateUsage: "BOTH",
  receiptPaperSize: "58MM",
  receiptCustomWidthMm: 58,
  receiptCustomHeightMm: 0,
  receiptMarginTopMm: 3,
  receiptMarginRightMm: 2,
  receiptMarginBottomMm: 3,
  receiptMarginLeftMm: 2,
  receiptFontSize: 8.4,
  receiptShowStoreName: true,
  receiptShowStoreAddress: true,
  receiptShowStorePhone: true,
  receiptShowLogo: false,
  receiptShowCashierName: true,
  receiptShowSaleNumber: true,
  receiptShowDateTime: true,
  receiptShowProductName: true,
  receiptShowProductSku: true,
  receiptShowProductBarcode: false,
  receiptShowProductUnitPrice: true,
  receiptShowProductQuantity: true,
  receiptShowDiscount: true,
  receiptShowSubtotal: true,
  receiptShowPaymentMethod: true,
  receiptShowTotal: true,
  receiptShowChange: true,
  receiptFooterText: "",
  receiptPrinterModel: "XP-P501A",
  labelPrinterModel: "XP-365B",
  labelTemplate: ROLL_PRICE_TAG_TEMPLATE,
  labelPaperMode: "ROLL",
  labelBarcodeType: "auto",
  labelLayoutOrder: "NAME_BARCODE_PRICE",
  labelDefaultCopies: 1,
  labelShowProductName: true,
  labelShowPrice: true,
  labelShowSku: true,
  labelShowBarcodeText: true,
  labelShowCurrency: true,
  labelShowStoreName: false,
  labelBarcodeHeightMm: 12,
  labelFontSize: 8,
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
};

const asProvider = (value: string | null | undefined): PrintProvider => {
  return normalizePrintProvider(value);
};

const asReceiptPaperSize = (value: string | null | undefined): ReceiptPaperSize =>
  value === "80MM" || value === "A4" || value === "CUSTOM" ? value : "58MM";

const asLabelLayoutOrder = (value: string | null | undefined): LabelLayoutOrder =>
  value === "PRICE_NAME_BARCODE" ||
  value === "BARCODE_ONLY" ||
  value === "NAME_BARCODE" ||
  value === "PRICE_BARCODE"
    ? value
    : "NAME_BARCODE_PRICE";

const receiptWidthMm = (values: PrintingFormValues) => {
  if (values.receiptPaperSize === "80MM") return 80;
  if (values.receiptPaperSize === "A4") return 210;
  if (values.receiptPaperSize === "CUSTOM") return values.receiptCustomWidthMm;
  return 58;
};

const buildReceiptTestHtml = (values: PrintingFormValues, sample: PrintingPreviewSample) => `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; font-family: Arial, sans-serif; font-size: ${values.receiptFontSize}px; }
    .receipt { width: ${receiptWidthMm(values)}mm; padding: ${values.receiptMarginTopMm}mm ${values.receiptMarginRightMm}mm ${values.receiptMarginBottomMm}mm ${values.receiptMarginLeftMm}mm; }
    .center { text-align: center; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    hr { border: 0; border-top: 1px solid #bbb; margin: 6px 0; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="center"><strong>${sample.receiptTestTitle}</strong></div>
    ${values.receiptShowStoreName ? `<div>${sample.storeName}</div>` : ""}
    ${values.receiptShowStoreAddress ? `<div>${sample.storeAddress}</div>` : ""}
    ${values.receiptShowStorePhone ? `<div>${sample.storePhone}</div>` : ""}
    <hr />
    ${values.receiptShowSaleNumber ? `<div>${sample.receiptNumber}</div>` : ""}
    ${values.receiptShowDateTime ? `<div>${sample.receiptDateTime}</div>` : ""}
    ${values.receiptShowCashierName ? `<div>${sample.cashier}</div>` : ""}
    <hr />
    <div>${values.receiptShowProductName ? sample.productName : ""} ${values.receiptShowProductSku ? sample.sku : ""}</div>
    <div class="row"><span>${values.receiptShowProductQuantity ? sample.quantity : ""}${values.receiptShowProductUnitPrice ? ` x ${sample.unitPrice}` : ""}</span><span>${sample.lineTotal}</span></div>
    <hr />
    ${values.receiptShowSubtotal ? `<div class="row"><span>${sample.subtotal}</span><span>${sample.lineTotal}</span></div>` : ""}
    ${values.receiptShowTotal ? `<div class="row"><strong>${sample.total}</strong><strong>${sample.lineTotal}</strong></div>` : ""}
    ${values.receiptShowPaymentMethod ? `<div class="row"><span>${sample.paymentMethod}</span><span>${sample.paymentAmount}</span></div>` : ""}
    ${values.receiptShowChange ? `<div class="row"><span>${sample.change}</span><span>${sample.changeAmount}</span></div>` : ""}
    ${values.receiptFooterText ? `<hr /><div class="center">${values.receiptFooterText}</div>` : ""}
  </div>
</body>
</html>`;

const buildBarcodeTestHtml = (values: PrintingFormValues, sample: PrintingPreviewSample) => {
  const blocks =
    values.labelLayoutOrder === "PRICE_NAME_BARCODE"
      ? ["price", "name", "barcode"]
      : values.labelLayoutOrder === "BARCODE_ONLY"
        ? ["barcode"]
        : values.labelLayoutOrder === "NAME_BARCODE"
          ? ["name", "barcode"]
          : values.labelLayoutOrder === "PRICE_BARCODE"
            ? ["price", "barcode"]
            : ["name", "barcode", "price"];
  const content = blocks
    .map((block) => {
      if (block === "name" && values.labelShowProductName) {
        return `<div>${sample.productName}</div>`;
      }
      if (block === "price" && values.labelShowPrice) {
        return `<div class="price">${sample.price}</div>`;
      }
      if (block === "barcode") {
        return `<div class="barcode"></div>${values.labelShowBarcodeText ? `<div>${sample.barcode}</div>` : ""}`;
      }
      return "";
    })
    .join("");
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; font-family: Arial, sans-serif; }
    .label { width: ${values.labelWidthMm}mm; height: ${values.labelHeightMm}mm; padding: 2mm; box-sizing: border-box; text-align: center; font-size: ${values.labelFontSize}px; }
    .barcode { height: ${values.labelBarcodeHeightMm}mm; margin: 2mm 0; background: repeating-linear-gradient(90deg, #000 0 1px, #fff 1px 3px, #000 3px 5px, #fff 5px 7px); }
    .price { font-size: ${Math.max(values.labelFontSize + 5, 12)}px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="label">
    ${content}
    ${values.labelShowSku ? `<div>${sample.sku}</div>` : ""}
  </div>
</body>
</html>`;
};

const ToggleRow = ({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex items-center justify-between gap-3 rounded-xl border border-border/65 bg-muted/30 p-3 text-sm">
    <span>{label}</span>
    <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
  </label>
);

const MobileWizardStep = ({
  step,
  title,
  description,
  status,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  status?: "ready" | "warning" | "neutral";
  children: ReactNode;
}) => (
  <Card className="bazaar-admin-surface">
    <CardHeader className="bazaar-admin-section-header px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-sm font-semibold text-primary">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base">{title}</CardTitle>
            {status ? (
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  status === "ready"
                    ? "border-success/30 bg-success/10 text-success"
                    : status === "warning"
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : "border-border bg-secondary text-muted-foreground"
                }`}
              >
                {status === "ready" ? "OK" : status === "warning" ? "!" : "..."}
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-3 px-4 py-4">{children}</CardContent>
  </Card>
);

const MobileStatusRow = ({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready?: boolean;
}) => (
  <div className="flex items-start justify-between gap-3 rounded-xl border border-border/65 bg-muted/30 p-3 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span
      className={`max-w-[58%] text-right font-medium ${
        ready === undefined ? "text-foreground" : ready ? "text-success" : "text-warning"
      }`}
    >
      {value}
    </span>
  </div>
);

const qzTrustMessageKeyFor = (status: QzTrustStatus) => {
  if (status === "trusted") return "qzTrustTrusted";
  if (status === "certificate-missing") return "qzCertificateMissing";
  if (status === "signature-missing" || status === "unsigned") return "qzSignatureMissing";
  if (status === "certificate-mismatch") return "qzCertificateMismatch";
  if (status === "error") return "qzSigningEndpointFailed";
  return "qzTrustMissing";
};

const qzTrustNoticeKeyFor = (status: QzTrustStatus) => {
  if (status === "certificate-missing") return "qzCertificateMissingNotice";
  if (status === "signature-missing" || status === "unsigned") return "qzSignatureMissingNotice";
  if (status === "certificate-mismatch") return "qzCertificateMismatchNotice";
  if (status === "error") return "qzSigningEndpointFailed";
  return "qzCertificateNotice";
};

const PrintingSettingsPage = () => {
  const t = useTranslations("printingSettings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { toast } = useToast();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canEdit = role === "ADMIN" || role === "MANAGER";
  const trpcUtils = trpc.useUtils();
  const storesQuery = trpc.stores.list.useQuery();
  const [storeId, setStoreId] = useState("");
  const [values, setValues] = useState<PrintingFormValues>(defaultFormValues);
  const [binding, setBinding] = useState<QzTrayBinding>({
    receiptPrinterName: "",
    labelPrinterName: "",
    certificateProvisioned: false,
  });
  const [qzStatus, setQzStatus] = useState<QzTrayStatus>("idle");
  const [qzErrorKey, setQzErrorKey] = useState<string | null>(null);
  const [qzTrustStatus, setQzTrustStatus] = useState<QzTrustStatus>("unknown");
  const [qzSigningStatus, setQzSigningStatus] = useState<QzSigningStatus | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [testAction, setTestAction] = useState<"receipt" | "barcode" | null>(null);

  useEffect(() => {
    if (storeId || !storesQuery.data?.[0]) {
      return;
    }
    setStoreId(storesQuery.data[0].id);
  }, [storeId, storesQuery.data]);

  const settingsQuery = trpc.stores.hardware.useQuery(
    { storeId },
    { enabled: Boolean(storeId) },
  );

  useEffect(() => {
    if (!storeId) {
      return;
    }
    setBinding(getQzTrayBinding(storeId));
    setQzStatus("idle");
    setQzErrorKey(null);
    setQzTrustStatus("unknown");
    setQzSigningStatus(null);
    setPrinters([]);
  }, [storeId]);

  useEffect(() => {
    const settings = settingsQuery.data?.settings;
    if (!settings) {
      return;
    }
    setValues({
      ...defaultFormValues,
      receiptPrintProvider: asProvider(settings.receiptPrintProvider),
      labelPrintProvider: asProvider(settings.labelPrintProvider),
      receiptAutoPrintEnabled: settings.receiptAutoPrintEnabled,
      receiptFallbackMode:
        settings.receiptFallbackMode === "NONE" ? "NONE" : "MANUAL_BROWSER_PRINT",
      receiptTemplateUsage:
        settings.receiptTemplateUsage === "PRINT" || settings.receiptTemplateUsage === "EXPORT"
          ? settings.receiptTemplateUsage
          : "BOTH",
      receiptPaperSize: asReceiptPaperSize(settings.receiptPaperSize),
      receiptCustomWidthMm: settings.receiptCustomWidthMm,
      receiptCustomHeightMm: settings.receiptCustomHeightMm,
      receiptMarginTopMm: settings.receiptMarginTopMm,
      receiptMarginRightMm: settings.receiptMarginRightMm,
      receiptMarginBottomMm: settings.receiptMarginBottomMm,
      receiptMarginLeftMm: settings.receiptMarginLeftMm,
      receiptFontSize: settings.receiptFontSize,
      receiptShowStoreName: settings.receiptShowStoreName,
      receiptShowStoreAddress: settings.receiptShowStoreAddress,
      receiptShowStorePhone: settings.receiptShowStorePhone,
      receiptShowLogo: settings.receiptShowLogo,
      receiptShowCashierName: settings.receiptShowCashierName,
      receiptShowSaleNumber: settings.receiptShowSaleNumber,
      receiptShowDateTime: settings.receiptShowDateTime,
      receiptShowProductName: settings.receiptShowProductName,
      receiptShowProductSku: settings.receiptShowProductSku,
      receiptShowProductBarcode: settings.receiptShowProductBarcode,
      receiptShowProductUnitPrice: settings.receiptShowProductUnitPrice,
      receiptShowProductQuantity: settings.receiptShowProductQuantity,
      receiptShowDiscount: settings.receiptShowDiscount,
      receiptShowSubtotal: settings.receiptShowSubtotal,
      receiptShowPaymentMethod: settings.receiptShowPaymentMethod,
      receiptShowTotal: settings.receiptShowTotal,
      receiptShowChange: settings.receiptShowChange,
      receiptFooterText: settings.receiptFooterText,
      receiptPrinterModel: settings.receiptPrinterModel,
      labelPrinterModel: settings.labelPrinterModel,
      labelTemplate: PRICE_TAG_TEMPLATES.includes(settings.labelTemplate as (typeof PRICE_TAG_TEMPLATES)[number])
        ? (settings.labelTemplate as (typeof PRICE_TAG_TEMPLATES)[number])
        : ROLL_PRICE_TAG_TEMPLATE,
      labelPaperMode: settings.labelPaperMode as PrintingFormValues["labelPaperMode"],
      labelBarcodeType: settings.labelBarcodeType as PrintingFormValues["labelBarcodeType"],
      labelLayoutOrder: asLabelLayoutOrder(settings.labelLayoutOrder),
      labelDefaultCopies: settings.labelDefaultCopies,
      labelShowProductName: settings.labelShowProductName,
      labelShowPrice: settings.labelShowPrice,
      labelShowSku: settings.labelShowSku,
      labelShowBarcodeText: settings.labelShowBarcodeText,
      labelShowCurrency: settings.labelShowCurrency,
      labelShowStoreName: settings.labelShowStoreName,
      labelBarcodeHeightMm: settings.labelBarcodeHeightMm,
      labelFontSize: settings.labelFontSize,
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
  }, [settingsQuery.data?.settings]);

  const selectedStore = (storesQuery.data ?? []).find((store) => store.id === storeId);
  const receiptPreviewWidth = Math.min(360, receiptWidthMm(values) * 4);
  const labelPreviewWidth = Math.min(320, values.labelWidthMm * 5);
  const labelPreviewHeight = Math.min(220, values.labelHeightMm * 5);
  const sample: PrintingPreviewSample = {
    receiptTestTitle: t("sampleReceiptTestTitle"),
    receiptHeading: t("sampleReceiptHeading"),
    storeName: t("sampleStoreName"),
    storeAddress: t("sampleStoreAddress"),
    storePhone: t("sampleStorePhone"),
    receiptNumber: t("sampleReceiptNumber"),
    receiptDateTime: t("sampleReceiptDateTime"),
    cashier: t("sampleCashier"),
    productName: t("sampleProductName"),
    sku: t("sampleSku"),
    barcode: t("sampleBarcode"),
    quantity: t("sampleQuantity"),
    unitPrice: t("sampleUnitPrice"),
    lineTotal: t("sampleLineTotal"),
    subtotal: t("sampleSubtotal"),
    discount: t("sampleDiscount"),
    total: t("sampleTotal"),
    paymentMethod: t("samplePaymentMethod"),
    paymentAmount: t("samplePaymentAmount"),
    change: t("sampleChange"),
    changeAmount: t("sampleChangeAmount"),
    price: values.labelShowCurrency ? t("samplePriceWithCurrency") : t("samplePrice"),
  };
  const barcodePreviewBlocks =
    values.labelLayoutOrder === "PRICE_NAME_BARCODE"
      ? (["price", "name", "barcode"] as const)
      : values.labelLayoutOrder === "BARCODE_ONLY"
        ? (["barcode"] as const)
        : values.labelLayoutOrder === "NAME_BARCODE"
          ? (["name", "barcode"] as const)
          : values.labelLayoutOrder === "PRICE_BARCODE"
            ? (["price", "barcode"] as const)
            : (["name", "barcode", "price"] as const);

  const updateMutation = trpc.stores.updateHardware.useMutation({
    onSuccess: async () => {
      saveQzTrayBinding(storeId, binding);
      toast({ variant: "success", description: t("saved") });
      await Promise.all([
        settingsQuery.refetch(),
        trpcUtils.stores.hardware.invalidate({ storeId }),
      ]);
    },
    onError: (error) => {
      toast({ variant: "error", description: translateError(tErrors, error) });
    },
  });

  const updateValue = <K extends keyof PrintingFormValues>(key: K, value: PrintingFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const updateBinding = (patch: Partial<QzTrayBinding>) => {
    setBinding((current) => {
      const next = { ...current, ...patch };
      if (storeId) {
        saveQzTrayBinding(storeId, next);
      }
      return next;
    });
  };

  const checkQzConnection = useCallback(async (options?: { silent?: boolean }) => {
    setQzStatus("checking");
    setQzErrorKey(null);
    try {
      setQzSigningStatus(await fetchQzSigningStatus());
      await connectQzTray();
      const printerRows = await listQzPrinters();
      setPrinters(printerRows);
      setQzSigningStatus(getQzSigningStatusSnapshot());
      setQzTrustStatus(getQzTrustStatus());
      setQzStatus("connected");
      if (!options?.silent) {
        toast({ variant: "success", description: t("qzConnected") });
      }
    } catch (error) {
      const key = qzTrayErrorMessageKey(error);
      setQzErrorKey(key);
      setQzSigningStatus(getQzSigningStatusSnapshot());
      setQzTrustStatus(getQzTrustStatus());
      setQzStatus("error");
      setPrinters([]);
      if (!options?.silent) {
        toast({ variant: "error", description: t(key) });
      }
    }
  }, [t, toast]);

  useEffect(() => {
    if (!storeId || values.receiptPrintProvider !== "QZ_TRAY") {
      return;
    }
    void fetchQzSigningStatus()
      .then(setQzSigningStatus)
      .catch(() => setQzSigningStatus(null));
  }, [storeId, values.receiptPrintProvider]);

  useEffect(() => {
    if (!storeId || settingsQuery.isLoading || values.receiptPrintProvider !== "QZ_TRAY") {
      return;
    }
    void checkQzConnection({ silent: true });
  }, [checkQzConnection, settingsQuery.isLoading, storeId, values.receiptPrintProvider]);

  const handleTestPrint = async (kind: "receipt" | "barcode") => {
    if (!storeId) {
      return;
    }
    const printerName =
      kind === "receipt" ? binding.receiptPrinterName.trim() : binding.labelPrinterName.trim();
    if (!printerName) {
      toast({ variant: "error", description: t("printerRequired") });
      return;
    }
    setTestAction(kind);
    try {
      const result = await printHtmlViaQzTray({
        printerName,
        html:
          kind === "receipt"
            ? buildReceiptTestHtml(values, sample)
            : buildBarcodeTestHtml(values, sample),
      });
      setQzTrustStatus(result.trustStatus);
      toast({
        variant: result.trustStatus === "trusted" ? "success" : "info",
        description:
          result.trustStatus === "trusted"
            ? t("testPrintSent")
            : t(qzTrustMessageKeyFor(result.trustStatus)),
      });
    } catch (error) {
      const key = qzTrayErrorMessageKey(error);
      setQzErrorKey(key);
      setQzTrustStatus(getQzTrustStatus());
      setQzStatus("error");
      toast({ variant: "error", description: t(key) });
    } finally {
      setTestAction(null);
    }
  };

  const handleSave = () => {
    if (!storeId || !canEdit) {
      return;
    }
    const receiptProvider = values.receiptPrintProvider;
    const labelProvider = values.labelPrintProvider;
    updateMutation.mutate({
      storeId,
      receiptPrintMode: providerToPrintMode(receiptProvider),
      labelPrintMode: providerToPrintMode(labelProvider),
      receiptPrintProvider: receiptProvider,
      labelPrintProvider: labelProvider,
      receiptAutoPrintEnabled:
        receiptProvider === "QZ_TRAY" || receiptProvider === "KIOSK_SILENT_PRINT"
          ? values.receiptAutoPrintEnabled
          : false,
      receiptFallbackMode: values.receiptFallbackMode,
      receiptTemplateUsage: values.receiptTemplateUsage,
      receiptPaperSize: values.receiptPaperSize,
      receiptCustomWidthMm: Number(values.receiptCustomWidthMm),
      receiptCustomHeightMm: Number(values.receiptCustomHeightMm),
      receiptMarginTopMm: Number(values.receiptMarginTopMm),
      receiptMarginRightMm: Number(values.receiptMarginRightMm),
      receiptMarginBottomMm: Number(values.receiptMarginBottomMm),
      receiptMarginLeftMm: Number(values.receiptMarginLeftMm),
      receiptFontSize: Number(values.receiptFontSize),
      receiptShowStoreName: values.receiptShowStoreName,
      receiptShowStoreAddress: values.receiptShowStoreAddress,
      receiptShowStorePhone: values.receiptShowStorePhone,
      receiptShowLogo: values.receiptShowLogo,
      receiptShowCashierName: values.receiptShowCashierName,
      receiptShowSaleNumber: values.receiptShowSaleNumber,
      receiptShowDateTime: values.receiptShowDateTime,
      receiptShowProductName: values.receiptShowProductName,
      receiptShowProductSku: values.receiptShowProductSku,
      receiptShowProductBarcode: values.receiptShowProductBarcode,
      receiptShowProductUnitPrice: values.receiptShowProductUnitPrice,
      receiptShowProductQuantity: values.receiptShowProductQuantity,
      receiptShowDiscount: values.receiptShowDiscount,
      receiptShowSubtotal: values.receiptShowSubtotal,
      receiptShowPaymentMethod: values.receiptShowPaymentMethod,
      receiptShowTotal: values.receiptShowTotal,
      receiptShowChange: values.receiptShowChange,
      receiptFooterText: values.receiptFooterText,
      receiptPrinterModel: values.receiptPrinterModel,
      labelPrinterModel: values.labelPrinterModel,
      labelTemplate: values.labelTemplate,
      labelPaperMode: values.labelPaperMode,
      labelBarcodeType: values.labelBarcodeType,
      labelLayoutOrder: values.labelLayoutOrder,
      labelDefaultCopies: Number(values.labelDefaultCopies),
      labelShowProductName: values.labelShowProductName,
      labelShowPrice: values.labelShowPrice,
      labelShowSku: values.labelShowSku,
      labelShowBarcodeText: values.labelShowBarcodeText,
      labelShowCurrency: values.labelShowCurrency,
      labelShowStoreName: values.labelShowStoreName,
      labelBarcodeHeightMm: Number(values.labelBarcodeHeightMm),
      labelFontSize: Number(values.labelFontSize),
      labelRollGapMm: Number(values.labelRollGapMm),
      labelRollXOffsetMm: Number(values.labelRollXOffsetMm),
      labelRollYOffsetMm: Number(values.labelRollYOffsetMm),
      labelWidthMm: Number(values.labelWidthMm),
      labelHeightMm: Number(values.labelHeightMm),
      labelMarginTopMm: Number(values.labelMarginTopMm),
      labelMarginRightMm: Number(values.labelMarginRightMm),
      labelMarginBottomMm: Number(values.labelMarginBottomMm),
      labelMarginLeftMm: Number(values.labelMarginLeftMm),
      connectorDeviceId: values.connectorDeviceId || null,
    });
  };

  const qzStatusLabel = useMemo(() => {
    if (qzStatus === "connected") return t("qzConnected");
    if (qzStatus === "checking") return tCommon("loading");
    if (qzStatus === "error" && qzErrorKey) return t(qzErrorKey);
    if (qzStatus === "error") return t("qzNotConnected");
    return t("qzIdle");
  }, [qzErrorKey, qzStatus, t, tCommon]);

  const printerOptions = useMemo(() => {
    return Array.from(
      new Set(
        [
          binding.receiptPrinterName.trim(),
          binding.labelPrinterName.trim(),
          ...printers,
        ].filter(Boolean),
      ),
    );
  }, [binding.labelPrinterName, binding.receiptPrinterName, printers]);

  const receiptPrinterAvailable =
    !binding.receiptPrinterName.trim() || printers.includes(binding.receiptPrinterName.trim());
  const labelPrinterAvailable =
    !binding.labelPrinterName.trim() || printers.includes(binding.labelPrinterName.trim());
  const hasSavedPrinters = Boolean(
    binding.receiptPrinterName.trim() || binding.labelPrinterName.trim(),
  );
  const qzConfigured =
    values.receiptPrintProvider === "QZ_TRAY" &&
    qzStatus === "connected" &&
    Boolean(binding.receiptPrinterName.trim()) &&
    receiptPrinterAvailable;
  const qzServerSigningReady = qzTrustStatus === "trusted";
  const qzTerminalProvisioned = binding.certificateProvisioned;
  const qzNeedsClientProvision =
    qzConfigured && qzServerSigningReady && !qzTerminalProvisioned;
  const qzFullyReady = qzConfigured && qzServerSigningReady && qzTerminalProvisioned;
  const qzTrustMessageKey = qzTrustMessageKeyFor(qzTrustStatus);
  const qzTrustNoticeKey = qzTrustNoticeKeyFor(qzTrustStatus);
  const qzCertificateLoaded = qzSigningStatus?.certificateConfigured === true;
  const qzSignatureConfigured = qzSigningStatus?.signingConfigured === true;
  const qzRequestValidityKey =
    qzSigningStatus?.keyPairMatches === true
      ? "qzValidityValid"
      : qzSigningStatus?.keyPairMatches === false
        ? "qzValidityInvalid"
        : "qzValidityUnknown";
  const qzLocalTrustKey = qzTerminalProvisioned ? "qzLocalTrustTrusted" : "qzLocalTrustUntrusted";
  const qzFingerprint = qzSigningStatus?.certificateFingerprintSha256 ?? "";
  const qzRequestSigningWorks =
    qzCertificateLoaded && qzSignatureConfigured && qzSigningStatus?.keyPairMatches === true;
  const qzReceiptPrinterSelected = Boolean(binding.receiptPrinterName.trim());
  const qzLabelPrinterSelected = Boolean(binding.labelPrinterName.trim());
  const qzMobileReady =
    values.receiptPrintProvider === "QZ_TRAY" &&
    qzStatus === "connected" &&
    qzReceiptPrinterSelected &&
    receiptPrinterAvailable &&
    qzRequestSigningWorks &&
    qzTrustStatus === "trusted" &&
    qzTerminalProvisioned;
  const qzSignedButUntrusted = qzRequestSigningWorks && !qzTerminalProvisioned;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <section className="space-y-4 md:hidden" data-mobile-printing-wizard>
        <Card className="bazaar-admin-surface">
          <CardHeader className="bazaar-admin-section-header px-4 py-4">
            <CardTitle className="text-base">{t("wizardTitle")}</CardTitle>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("wizardDescription")}
            </p>
          </CardHeader>
          <CardContent className="space-y-3 px-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{tCommon("store")}</label>
              <Select value={storeId} onValueChange={setStoreId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder={tCommon("selectStore")} />
                </SelectTrigger>
                <SelectContent>
                  {(storesQuery.data ?? []).map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      {store.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("deviceScopeHint")}
              </p>
            </div>
          </CardContent>
        </Card>

        {!canEdit ? <p className="text-sm text-warning">{t("readOnly")}</p> : null}
        {settingsQuery.isLoading ? (
          <div className="bazaar-admin-empty min-h-[7rem]">
            <Spinner className="h-4 w-4" />
            {tCommon("loading")}
          </div>
        ) : null}
        {settingsQuery.error ? (
          <div className="bazaar-admin-error">
            {translateError(tErrors, settingsQuery.error)}
          </div>
        ) : null}
        {!selectedStore && !storesQuery.isLoading ? (
          <div className="bazaar-admin-empty min-h-[7rem]">
            <EmptyIcon className="h-4 w-4" aria-hidden />
            {t("empty")}
          </div>
        ) : null}

        {selectedStore ? (
          <>
            <MobileWizardStep
              step={1}
              title={t("wizardMethodTitle")}
              description={t("wizardMethodDescription")}
              status={values.receiptPrintProvider === "DISABLED" ? "neutral" : "ready"}
            >
              <div className="grid gap-2">
                {(["QZ_TRAY", "DISABLED"] as const).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={`bazaar-admin-choice-card min-h-16 ${
                      values.receiptPrintProvider === provider
                        ? "bazaar-admin-choice-card-active"
                        : ""
                    }`}
                    disabled={!canEdit}
                    onClick={() => {
                      updateValue("receiptPrintProvider", provider);
                      updateValue("labelPrintProvider", provider);
                      if (provider === "DISABLED") {
                        updateValue("receiptAutoPrintEnabled", false);
                      }
                    }}
                  >
                    <span className="block text-sm font-semibold text-foreground">
                      {provider === "QZ_TRAY" ? t("providerQz") : t("providerDisabled")}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {provider === "QZ_TRAY" ? t("providerQzHint") : t("providerDisabledHint")}
                    </span>
                  </button>
                ))}
                <div className="bazaar-admin-notice text-xs leading-relaxed">
                  {t("wizardAgentUnavailable")}
                </div>
              </div>
            </MobileWizardStep>

            <MobileWizardStep
              step={2}
              title={t("wizardConnectionTitle")}
              description={t("wizardConnectionDescription")}
              status={
                values.receiptPrintProvider === "DISABLED"
                  ? "neutral"
                  : qzStatus === "connected"
                    ? "ready"
                    : "warning"
              }
            >
              <MobileStatusRow
                label={t("connectionStatus")}
                value={qzStatusLabel}
                ready={qzStatus === "connected"}
              />
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-full"
                onClick={() => void checkQzConnection()}
                disabled={qzStatus === "checking" || values.receiptPrintProvider !== "QZ_TRAY"}
              >
                {qzStatus === "checking" ? <Spinner className="h-4 w-4" /> : null}
                {t("testConnection")}
              </Button>
            </MobileWizardStep>

            <MobileWizardStep
              step={3}
              title={t("wizardTrustTitle")}
              description={t("wizardTrustDescription")}
              status={qzRequestSigningWorks && qzTerminalProvisioned ? "ready" : "warning"}
            >
              <MobileStatusRow
                label={t("qzCertificateLoadedLabel")}
                value={qzCertificateLoaded ? t("yes") : t("no")}
                ready={qzCertificateLoaded}
              />
              <MobileStatusRow
                label={t("qzSignatureConfiguredLabel")}
                value={qzSignatureConfigured ? t("yes") : t("no")}
                ready={qzSignatureConfigured}
              />
              <MobileStatusRow
                label={t("qzRequestValidityLabel")}
                value={t(qzRequestValidityKey)}
                ready={qzSigningStatus?.keyPairMatches === true}
              />
              <MobileStatusRow
                label={t("qzLocalTrustLabel")}
                value={t(qzLocalTrustKey)}
                ready={qzTerminalProvisioned}
              />
              {qzFingerprint ? (
                <div className="bazaar-admin-info-tile text-sm">
                  <p className="font-medium text-foreground">{t("qzCertificateFingerprint")}</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {qzFingerprint}
                  </p>
                </div>
              ) : (
                <MobileStatusRow
                  label={t("qzCertificateFingerprint")}
                  value={t("qzCertificateFingerprintUnavailable")}
                  ready={false}
                />
              )}
              {qzSignedButUntrusted ? (
                <div className="bazaar-admin-status-tile-warning text-sm leading-relaxed">
                  {t("qzClientProvisionNotice")}
                </div>
              ) : null}
              <Button asChild type="button" variant="secondary" className="h-11 w-full">
                <a href="/api/qz/certificate" download="bazaar-qz-certificate.txt">
                  {t("downloadQzCertificate")}
                </a>
              </Button>
              <label className="flex items-center justify-between gap-3 border border-border bg-card p-3 text-sm">
                <span className="space-y-1">
                  <span className="block font-medium text-foreground">
                    {t("qzClientProvisionConfirm")}
                  </span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {t("qzClientProvisionHint")}
                  </span>
                </span>
                <Switch
                  checked={binding.certificateProvisioned}
                  onCheckedChange={(checked) => updateBinding({ certificateProvisioned: checked })}
                  disabled={!canEdit}
                  aria-label={t("qzClientProvisionConfirm")}
                />
              </label>
            </MobileWizardStep>

            <MobileWizardStep
              step={4}
              title={t("wizardPrintersTitle")}
              description={t("wizardPrintersDescription")}
              status={qzReceiptPrinterSelected && qzLabelPrinterSelected ? "ready" : "warning"}
            >
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t("receiptPrinter")}</label>
                <Select
                  value={binding.receiptPrinterName}
                  onValueChange={(value) => updateBinding({ receiptPrinterName: value })}
                  disabled={!canEdit || qzStatus !== "connected"}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("selectPrinter")} />
                  </SelectTrigger>
                  <SelectContent>
                    {printerOptions.map((printer) => (
                      <SelectItem key={printer} value={printer}>
                        {printer}
                        {printers.length > 0 && !printers.includes(printer)
                          ? ` (${t("printerUnavailableShort")})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {binding.receiptPrinterName.trim()
                    ? t("savedReceiptPrinter", { printer: binding.receiptPrinterName.trim() })
                    : t("receiptPrinterNotSelected")}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t("labelPrinter")}</label>
                <Select
                  value={binding.labelPrinterName}
                  onValueChange={(value) => updateBinding({ labelPrinterName: value })}
                  disabled={!canEdit || qzStatus !== "connected"}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder={t("selectPrinter")} />
                  </SelectTrigger>
                  <SelectContent>
                    {printerOptions.map((printer) => (
                      <SelectItem key={printer} value={printer}>
                        {printer}
                        {printers.length > 0 && !printers.includes(printer)
                          ? ` (${t("printerUnavailableShort")})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {binding.labelPrinterName.trim()
                    ? t("savedLabelPrinter", { printer: binding.labelPrinterName.trim() })
                    : t("labelPrinterNotSelected")}
                </p>
              </div>
            </MobileWizardStep>

            <MobileWizardStep
              step={5}
              title={t("wizardTemplatesTitle")}
              description={t("wizardTemplatesDescription")}
              status="neutral"
            >
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t("paperSize")}</label>
                <Select
                  value={values.receiptPaperSize}
                  onValueChange={(value) => updateValue("receiptPaperSize", value as ReceiptPaperSize)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58MM">{t("paper58")}</SelectItem>
                    <SelectItem value="80MM">{t("paper80")}</SelectItem>
                    <SelectItem value="A4">A4</SelectItem>
                    <SelectItem value="CUSTOM">{t("custom")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["receiptShowProductName", "showProductName"],
                  ["receiptShowProductSku", "showSku"],
                  ["receiptShowProductBarcode", "showBarcodeText"],
                  ["receiptShowDiscount", "showDiscount"],
                  ["receiptShowPaymentMethod", "showPaymentMethod"],
                  ["receiptShowChange", "showChange"],
                ] as const).map(([key, label]) => (
                  <ToggleRow
                    key={key}
                    label={t(label)}
                    checked={values[key]}
                    disabled={!canEdit}
                    onChange={(checked) => updateValue(key, checked)}
                  />
                ))}
              </div>
              <div className="overflow-auto">
                <div
                  className="border border-border bg-white p-3 text-xs text-black shadow-sm"
                  style={{ width: Math.min(300, receiptPreviewWidth) }}
                >
                  <div className="text-center font-bold">{sample.receiptHeading}</div>
                  {values.receiptShowSaleNumber ? <div>{sample.receiptNumber}</div> : null}
                  <div>
                    {values.receiptShowProductName ? sample.productName : ""}
                    {values.receiptShowProductSku ? ` ${sample.sku}` : ""}
                  </div>
                  {values.receiptShowProductBarcode ? <div>{sample.barcode}</div> : null}
                  <div className="flex justify-between gap-3">
                    <span>{sample.quantity}</span>
                    <span>{sample.lineTotal}</span>
                  </div>
                  {values.receiptShowTotal ? (
                    <div className="flex justify-between font-bold">
                      <span>{sample.total}</span>
                      <span>{sample.lineTotal}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <label className="text-sm font-medium text-foreground">{t("layoutOrder")}</label>
                <Select
                  value={values.labelLayoutOrder}
                  onValueChange={(value) => updateValue("labelLayoutOrder", value as LabelLayoutOrder)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NAME_BARCODE_PRICE">{t("layoutNameBarcodePrice")}</SelectItem>
                    <SelectItem value="PRICE_NAME_BARCODE">{t("layoutPriceNameBarcode")}</SelectItem>
                    <SelectItem value="NAME_BARCODE">{t("layoutNameBarcode")}</SelectItem>
                    <SelectItem value="PRICE_BARCODE">{t("layoutPriceBarcode")}</SelectItem>
                    <SelectItem value="BARCODE_ONLY">{t("layoutBarcodeOnly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["labelWidthMm", "widthMm"],
                  ["labelHeightMm", "heightMm"],
                  ["labelBarcodeHeightMm", "barcodeHeight"],
                  ["labelDefaultCopies", "labelDefaultCopies"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">{t(label)}</label>
                    <Input
                      type="number"
                      value={values[key]}
                      onChange={(event) => updateValue(key, Number(event.target.value))}
                      disabled={!canEdit}
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["labelShowPrice", "showPrice"],
                  ["labelShowProductName", "showProductName"],
                  ["labelShowSku", "showSku"],
                  ["labelShowBarcodeText", "showBarcodeText"],
                ] as const).map(([key, label]) => (
                  <ToggleRow
                    key={key}
                    label={t(label)}
                    checked={values[key]}
                    disabled={!canEdit}
                    onChange={(checked) => updateValue(key, checked)}
                  />
                ))}
              </div>
              <div
                className="flex items-center justify-center border border-border bg-white p-3 text-center text-xs text-black shadow-sm"
                style={{ minHeight: 120 }}
              >
                <div className="w-full">
                  {barcodePreviewBlocks.map((block) => {
                    if (block === "name" && values.labelShowProductName) {
                      return <div key={block}>{sample.productName}</div>;
                    }
                    if (block === "price" && values.labelShowPrice) {
                      return (
                        <div key={block} className="text-base font-bold">
                          {sample.price}
                        </div>
                      );
                    }
                    if (block === "barcode") {
                      return (
                        <div key={block}>
                          <div className="my-2 h-8 w-full bg-[repeating-linear-gradient(90deg,#000_0_2px,#fff_2px_4px,#000_4px_7px,#fff_7px_10px)]" />
                          {values.labelShowBarcodeText ? <div>{sample.barcode}</div> : null}
                        </div>
                      );
                    }
                    return null;
                  })}
                  {values.labelShowSku ? <div>{sample.sku}</div> : null}
                </div>
              </div>
            </MobileWizardStep>

            <MobileWizardStep
              step={6}
              title={t("wizardTestTitle")}
              description={t("wizardTestDescription")}
              status="neutral"
            >
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-full"
                onClick={() => void handleTestPrint("receipt")}
                disabled={
                  testAction !== null ||
                  values.receiptPrintProvider !== "QZ_TRAY" ||
                  qzStatus !== "connected"
                }
              >
                {testAction === "receipt" ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <PrintIcon className="h-4 w-4" />
                )}
                {t("testReceiptPrint")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-full"
                onClick={() => void handleTestPrint("barcode")}
                disabled={
                  testAction !== null ||
                  values.labelPrintProvider !== "QZ_TRAY" ||
                  qzStatus !== "connected"
                }
              >
                {testAction === "barcode" ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <PrintIcon className="h-4 w-4" />
                )}
                {t("testBarcodePrint")}
              </Button>
            </MobileWizardStep>

            <MobileWizardStep
              step={7}
              title={t("wizardReadyTitle")}
              description={qzMobileReady ? t("autoPrintReadyHint") : t("wizardReadyDescription")}
              status={qzMobileReady ? "ready" : "warning"}
            >
              <div
                className={`border p-3 text-sm leading-relaxed ${
                  qzMobileReady
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-warning/40 bg-warning/10 text-warning"
                }`}
              >
                <p className="font-semibold">
                  {qzMobileReady ? t("autoPrintReady") : t("autoPrintNeedsSetup")}
                </p>
                <p className="mt-1 text-xs">
                  {qzMobileReady ? t("autoPrintReadyHint") : t("autoPrintSetupRequired")}
                </p>
              </div>
              <MobileStatusRow
                label={t("connectionStatus")}
                value={qzStatusLabel}
                ready={qzStatus === "connected"}
              />
              <MobileStatusRow
                label={t("signingStatus")}
                value={qzRequestSigningWorks ? t("yes") : t("no")}
                ready={qzRequestSigningWorks}
              />
              <MobileStatusRow
                label={t("clientTrustStatus")}
                value={qzTerminalProvisioned ? t("qzClientProvisioned") : t("qzClientProvisionMissing")}
                ready={qzTerminalProvisioned}
              />
              <MobileStatusRow
                label={t("printerStatus")}
                value={hasSavedPrinters ? t("printersSaved") : t("printersNotSelected")}
                ready={hasSavedPrinters}
              />
            </MobileWizardStep>

            <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 border border-border bg-background p-3 shadow-lg">
              <Button
                type="button"
                className="h-12 w-full"
                onClick={handleSave}
                disabled={!canEdit || !storeId || updateMutation.isLoading || settingsQuery.isLoading}
              >
                {updateMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
                {tCommon("save")}
              </Button>
            </div>
          </>
        ) : null}
      </section>

      <div className="hidden space-y-6 md:block">
      <Card className="bazaar-admin-surface">
        <CardHeader className="bazaar-admin-section-header">
          <CardTitle>{t("storeScopeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{tCommon("store")}</label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger>
                <SelectValue placeholder={tCommon("selectStore")} />
              </SelectTrigger>
              <SelectContent>
                {(storesQuery.data ?? []).map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("deviceScopeHint")}</p>
          </div>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!canEdit || !storeId || updateMutation.isLoading || settingsQuery.isLoading}
          >
            {updateMutation.isLoading ? <Spinner className="h-4 w-4" /> : null}
            {tCommon("save")}
          </Button>
        </CardContent>
      </Card>

      {!canEdit ? <p className="text-sm text-warning">{t("readOnly")}</p> : null}
      {settingsQuery.isLoading ? (
        <div className="bazaar-admin-empty min-h-[7rem]">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : null}
      {settingsQuery.error ? (
        <div className="bazaar-admin-error">
          {translateError(tErrors, settingsQuery.error)}
        </div>
      ) : null}
      {!selectedStore && !storesQuery.isLoading ? (
        <div className="bazaar-admin-empty min-h-[7rem]">
          <EmptyIcon className="h-4 w-4" aria-hidden />
          {t("empty")}
        </div>
      ) : null}

      {selectedStore ? (
        <>
          <Card className="bazaar-admin-surface">
            <CardHeader className="bazaar-admin-section-header">
              <CardTitle>{t("statusTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={`rounded-xl border p-4 ${
                  qzFullyReady
                    ? "border-success/40 bg-success/10 text-success"
                    : values.receiptPrintProvider === "DISABLED"
                      ? "border-border bg-secondary/30 text-muted-foreground"
                      : qzStatus === "error"
                        ? "border-danger/40 bg-danger/10 text-danger"
                        : "border-warning/40 bg-warning/10 text-warning"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      {qzFullyReady
                        ? t("autoPrintReady")
                        : values.receiptPrintProvider === "DISABLED"
                          ? t("autoPrintDisabled")
                          : qzNeedsClientProvision
                            ? t("autoPrintNeedsClientTrust")
                          : qzConfigured
                            ? t("autoPrintNeedsTrust")
                            : t("autoPrintNeedsSetup")}
                    </p>
                    <p className="text-xs">
                      {qzFullyReady
                        ? t("autoPrintReadyHint")
                        : values.receiptPrintProvider === "DISABLED"
                          ? t("providerDisabledHint")
                          : qzNeedsClientProvision
                            ? t("qzClientProvisionMissing")
                          : qzConfigured
                            ? t(qzTrustMessageKey)
                            : t("autoPrintSetupRequired")}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-current/30 px-3 py-1 text-xs">
                    {qzFullyReady ? (
                      <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                    ) : (
                      <StatusWarningIcon className="h-4 w-4" aria-hidden />
                    )}
                    {values.receiptPrintProvider === "QZ_TRAY"
                      ? t("providerQz")
                      : values.receiptPrintProvider === "KIOSK_SILENT_PRINT"
                        ? t("providerKiosk")
                        : t("providerDisabled")}
                  </span>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {(["DISABLED", "QZ_TRAY", "KIOSK_SILENT_PRINT"] as const).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={`bazaar-admin-choice-card ${
                      values.receiptPrintProvider === provider
                        ? "bazaar-admin-choice-card-active"
                        : ""
                    }`}
                    disabled={!canEdit}
                    onClick={() => {
                      updateValue("receiptPrintProvider", provider);
                      updateValue("labelPrintProvider", provider);
                      if (provider === "DISABLED") {
                        updateValue("receiptAutoPrintEnabled", false);
                      }
                    }}
                  >
                    <span className="block text-sm font-semibold text-foreground">
                      {provider === "DISABLED"
                        ? t("providerDisabled")
                        : provider === "QZ_TRAY"
                          ? t("providerQz")
                          : t("providerKiosk")}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {provider === "DISABLED"
                        ? t("providerDisabledHint")
                        : provider === "QZ_TRAY"
                          ? t("providerQzHint")
                          : t("providerKioskHint")}
                    </span>
                  </button>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="bazaar-admin-info-tile text-sm">
                  <p className="font-medium text-foreground">{t("connectionStatus")}</p>
                  <p className="mt-1 text-muted-foreground">{qzStatusLabel}</p>
                </div>
                <div
                  className={`rounded-xl border p-3 text-sm ${
                    qzTrustStatus === "trusted"
                      ? "border-success/30 bg-success/10"
                      : "border-warning/40 bg-warning/10"
                  }`}
                >
                  <p className="font-medium text-foreground">{t("signingStatus")}</p>
                  <p className="mt-1 text-muted-foreground">
                    {t(qzTrustMessageKey)}
                  </p>
                </div>
                <div
                  className={`rounded-xl border p-3 text-sm ${
                    qzTerminalProvisioned
                      ? "border-success/30 bg-success/10"
                      : "border-warning/40 bg-warning/10"
                  }`}
                >
                  <p className="font-medium text-foreground">{t("clientTrustStatus")}</p>
                  <p className="mt-1 text-muted-foreground">
                    {qzTerminalProvisioned
                      ? t("qzClientProvisioned")
                      : t("qzClientProvisionMissing")}
                  </p>
                </div>
                <div className="bazaar-admin-info-tile text-sm">
                  <p className="font-medium text-foreground">{t("printerStatus")}</p>
                  <p className="mt-1 text-muted-foreground">
                    {hasSavedPrinters ? t("printersSaved") : t("printersNotSelected")}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="bazaar-admin-info-tile text-sm">
                  <p className="font-medium text-foreground">{t("qzCertificateLoadedLabel")}</p>
                  <p className="mt-1 text-muted-foreground">
                    {qzCertificateLoaded ? t("yes") : t("no")}
                  </p>
                </div>
                <div className="bazaar-admin-info-tile text-sm">
                  <p className="font-medium text-foreground">{t("qzSignatureConfiguredLabel")}</p>
                  <p className="mt-1 text-muted-foreground">
                    {qzSignatureConfigured ? t("yes") : t("no")}
                  </p>
                </div>
                <div className="bazaar-admin-info-tile text-sm">
                  <p className="font-medium text-foreground">{t("qzRequestValidityLabel")}</p>
                  <p className="mt-1 text-muted-foreground">{t(qzRequestValidityKey)}</p>
                </div>
                <div className="bazaar-admin-info-tile text-sm">
                  <p className="font-medium text-foreground">{t("qzLocalTrustLabel")}</p>
                  <p className="mt-1 text-muted-foreground">{t(qzLocalTrustKey)}</p>
                </div>
                <div className="bazaar-admin-info-tile text-sm md:col-span-2 xl:col-span-1">
                  <p className="font-medium text-foreground">{t("qzCertificateFingerprint")}</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {qzFingerprint || t("qzCertificateFingerprintUnavailable")}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${
                    qzStatus === "connected"
                      ? "border-success/40 bg-success/10 text-success"
                      : qzStatus === "error"
                        ? "border-danger/40 bg-danger/10 text-danger"
                        : "border-border bg-secondary/30 text-muted-foreground"
                  }`}
                >
                  {qzStatus === "connected" ? (
                    <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <StatusWarningIcon className="h-4 w-4" aria-hidden />
                  )}
                  {qzStatusLabel}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void checkQzConnection()}
                  disabled={qzStatus === "checking" || values.receiptPrintProvider !== "QZ_TRAY"}
                >
                  {qzStatus === "checking" ? <Spinner className="h-4 w-4" /> : null}
                  {t("testConnection")}
                </Button>
              </div>
              {values.receiptPrintProvider === "QZ_TRAY" && qzTrustStatus !== "trusted" ? (
                <div className="bazaar-admin-status-tile-warning p-4 text-sm">
                  {t(qzTrustNoticeKey)}
                </div>
              ) : null}
              {values.receiptPrintProvider === "QZ_TRAY" &&
              qzTrustStatus === "trusted" &&
              !qzTerminalProvisioned ? (
                <div className="bazaar-admin-status-tile-warning p-4 text-sm">
                  {t("qzClientProvisionNotice")}
                </div>
              ) : null}
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t("qzSetupIntro")}</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>{t("qzStepInstall")}</li>
                  <li>{t("qzStepInstallCertificate")}</li>
                  <li>{t("qzStepRestart")}</li>
                  <li>{t("qzStepCheck")}</li>
                  <li>{t("qzStepTestPrint")}</li>
                </ol>
              </div>
              {values.receiptPrintProvider === "QZ_TRAY" ? (
                <div className="space-y-3 rounded-xl border border-border/65 bg-muted/25 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {qzTrustStatus !== "certificate-missing" ? (
                      <Button asChild type="button" variant="secondary">
                        <a href="/api/qz/certificate" download="bazaar-qz-certificate.txt">
                          {t("downloadQzCertificate")}
                        </a>
                      </Button>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {t("downloadQzCertificateHint")}
                    </span>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-border/65 bg-card p-3 text-sm">
                    <span className="space-y-1">
                      <span className="block font-medium text-foreground">
                        {t("qzClientProvisionConfirm")}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t("qzClientProvisionHint")}
                      </span>
                    </span>
                    <Switch
                      checked={binding.certificateProvisioned}
                      onCheckedChange={(checked) =>
                        updateBinding({ certificateProvisioned: checked })
                      }
                      disabled={!canEdit}
                      aria-label={t("qzClientProvisionConfirm")}
                    />
                  </label>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t("receiptPrinter")}</label>
                  <Select
                    value={binding.receiptPrinterName}
                    onValueChange={(value) => updateBinding({ receiptPrinterName: value })}
                    disabled={!canEdit || qzStatus !== "connected"}
                  >
                    <SelectTrigger><SelectValue placeholder={t("selectPrinter")} /></SelectTrigger>
                    <SelectContent>
                      {printerOptions.map((printer) => (
                        <SelectItem key={printer} value={printer}>
                          {printer}
                          {printers.length > 0 && !printers.includes(printer)
                            ? ` (${t("printerUnavailableShort")})`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {binding.receiptPrinterName.trim()
                      ? t("savedReceiptPrinter", { printer: binding.receiptPrinterName.trim() })
                      : t("receiptPrinterNotSelected")}
                  </p>
                  {qzStatus === "connected" && !receiptPrinterAvailable ? (
                    <p className="text-xs text-danger">{t("savedPrinterNotFound")}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t("labelPrinter")}</label>
                  <Select
                    value={binding.labelPrinterName}
                    onValueChange={(value) => updateBinding({ labelPrinterName: value })}
                    disabled={!canEdit || qzStatus !== "connected"}
                  >
                    <SelectTrigger><SelectValue placeholder={t("selectPrinter")} /></SelectTrigger>
                    <SelectContent>
                      {printerOptions.map((printer) => (
                        <SelectItem key={printer} value={printer}>
                          {printer}
                          {printers.length > 0 && !printers.includes(printer)
                            ? ` (${t("printerUnavailableShort")})`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {binding.labelPrinterName.trim()
                      ? t("savedLabelPrinter", { printer: binding.labelPrinterName.trim() })
                      : t("labelPrinterNotSelected")}
                  </p>
                  {qzStatus === "connected" && !labelPrinterAvailable ? (
                    <p className="text-xs text-danger">{t("savedPrinterNotFound")}</p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="bazaar-admin-surface">
              <CardHeader className="bazaar-admin-section-header">
                <CardTitle>{t("receiptTemplateTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("receiptUsage")}</label>
                    <Select
                      value={values.receiptTemplateUsage}
                      onValueChange={(value) => updateValue("receiptTemplateUsage", value as ReceiptUsage)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BOTH">{t("usageBoth")}</SelectItem>
                        <SelectItem value="PRINT">{t("usagePrint")}</SelectItem>
                        <SelectItem value="EXPORT">{t("usageExport")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <ToggleRow
                    label={t("autoPrintReceipt")}
                    checked={values.receiptAutoPrintEnabled}
                    disabled={!canEdit || values.receiptPrintProvider === "DISABLED"}
                    onChange={(checked) => updateValue("receiptAutoPrintEnabled", checked)}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("paperSize")}</label>
                    <Select
                      value={values.receiptPaperSize}
                      onValueChange={(value) => updateValue("receiptPaperSize", value as ReceiptPaperSize)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="58MM">{t("paper58")}</SelectItem>
                        <SelectItem value="80MM">{t("paper80")}</SelectItem>
                        <SelectItem value="A4">A4</SelectItem>
                        <SelectItem value="CUSTOM">{t("custom")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("widthMm")}</label>
                    <Input
                      type="number"
                      value={values.receiptCustomWidthMm}
                      onChange={(event) => updateValue("receiptCustomWidthMm", Number(event.target.value))}
                      disabled={!canEdit || values.receiptPaperSize !== "CUSTOM"}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("heightMm")}</label>
                    <Input
                      type="number"
                      value={values.receiptCustomHeightMm}
                      onChange={(event) => updateValue("receiptCustomHeightMm", Number(event.target.value))}
                      disabled={!canEdit || values.receiptPaperSize !== "CUSTOM"}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("fontSize")}</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={values.receiptFontSize}
                      onChange={(event) => updateValue("receiptFontSize", Number(event.target.value))}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  {([
                    ["receiptMarginTopMm", "marginTop"],
                    ["receiptMarginRightMm", "marginRight"],
                    ["receiptMarginBottomMm", "marginBottom"],
                    ["receiptMarginLeftMm", "marginLeft"],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="space-y-2">
                      <label className="text-sm font-medium text-foreground">{t(label)}</label>
                      <Input
                        type="number"
                        step="0.5"
                        value={values[key]}
                        onChange={(event) => updateValue(key, Number(event.target.value))}
                        disabled={!canEdit}
                      />
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {([
                    ["receiptShowStoreName", "showStoreName"],
                    ["receiptShowStoreAddress", "showStoreAddress"],
                    ["receiptShowStorePhone", "showStorePhone"],
                    ["receiptShowLogo", "showLogo"],
                    ["receiptShowCashierName", "showCashier"],
                    ["receiptShowSaleNumber", "showSaleNumber"],
                    ["receiptShowDateTime", "showDateTime"],
                    ["receiptShowProductName", "showProductName"],
                    ["receiptShowProductSku", "showSku"],
                    ["receiptShowProductBarcode", "showBarcodeText"],
                    ["receiptShowProductUnitPrice", "showUnitPrice"],
                    ["receiptShowProductQuantity", "showQuantity"],
                    ["receiptShowSubtotal", "showSubtotal"],
                    ["receiptShowDiscount", "showDiscount"],
                    ["receiptShowTotal", "showTotal"],
                    ["receiptShowPaymentMethod", "showPaymentMethod"],
                    ["receiptShowChange", "showChange"],
                  ] as const).map(([key, label]) => (
                    <ToggleRow
                      key={key}
                      label={t(label)}
                      checked={values[key]}
                      disabled={!canEdit}
                      onChange={(checked) => updateValue(key, checked)}
                    />
                  ))}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t("footerText")}</label>
                  <Textarea
                    value={values.receiptFooterText}
                    onChange={(event) => updateValue("receiptFooterText", event.target.value)}
                    rows={3}
                    disabled={!canEdit}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleTestPrint("receipt")}
                    disabled={
                      testAction !== null ||
                      values.receiptPrintProvider !== "QZ_TRAY" ||
                      qzStatus !== "connected"
                    }
                  >
                    {testAction === "receipt" ? <Spinner className="h-4 w-4" /> : <PrintIcon className="h-4 w-4" />}
                    {t("testReceiptPrint")}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card className="bazaar-admin-surface">
              <CardHeader className="bazaar-admin-section-header">
                <CardTitle>{t("receiptPreview")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bazaar-admin-preview-frame overflow-auto">
                  <div
                    className="rounded-lg border border-border bg-white p-4 text-black shadow-sm"
                    style={{ width: receiptPreviewWidth }}
                  >
                    <div className="text-center font-bold">{sample.receiptHeading}</div>
                    {values.receiptShowStoreName ? <div>{sample.storeName}</div> : null}
                    {values.receiptShowStoreAddress ? <div>{sample.storeAddress}</div> : null}
                    {values.receiptShowStorePhone ? <div>{sample.storePhone}</div> : null}
                    <hr className="my-2" />
                    {values.receiptShowSaleNumber ? <div>{sample.receiptNumber}</div> : null}
                    {values.receiptShowDateTime ? <div>{sample.receiptDateTime}</div> : null}
                    {values.receiptShowCashierName ? <div>{sample.cashier}</div> : null}
                    <hr className="my-2" />
                    <div>
                      {values.receiptShowProductName ? sample.productName : ""}
                      {values.receiptShowProductSku ? ` ${sample.sku}` : ""}
                    </div>
                    {values.receiptShowProductBarcode ? <div>{sample.barcode}</div> : null}
                    <div className="flex justify-between gap-3">
                      <span>
                        {values.receiptShowProductQuantity ? sample.quantity : ""}
                        {values.receiptShowProductUnitPrice ? ` x ${sample.unitPrice}` : ""}
                      </span>
                      <span>{sample.lineTotal}</span>
                    </div>
                    <hr className="my-2" />
                    {values.receiptShowSubtotal ? <div className="flex justify-between"><span>{sample.subtotal}</span><span>{sample.lineTotal}</span></div> : null}
                    {values.receiptShowDiscount ? <div className="flex justify-between"><span>{sample.discount}</span><span>{t("sampleDiscountAmount")}</span></div> : null}
                    {values.receiptShowTotal ? <div className="flex justify-between font-bold"><span>{sample.total}</span><span>{sample.lineTotal}</span></div> : null}
                    {values.receiptShowPaymentMethod ? <div className="flex justify-between"><span>{sample.paymentMethod}</span><span>{sample.paymentAmount}</span></div> : null}
                    {values.receiptShowChange ? <div className="flex justify-between"><span>{sample.change}</span><span>{sample.changeAmount}</span></div> : null}
                    {values.receiptFooterText ? <div className="mt-2 text-center">{values.receiptFooterText}</div> : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="bazaar-admin-surface">
              <CardHeader className="bazaar-admin-section-header">
                <CardTitle>{t("barcodeTemplateTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("barcodeType")}</label>
                    <Select
                      value={values.labelBarcodeType}
                      onValueChange={(value) =>
                        updateValue("labelBarcodeType", value as PrintingFormValues["labelBarcodeType"])
                      }
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">{t("barcodeAuto")}</SelectItem>
                        <SelectItem value="ean13">{t("barcodeEan13")}</SelectItem>
                        <SelectItem value="code128">{t("barcodeCode128")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("labelTemplate")}</label>
                    <Select
                      value={values.labelTemplate}
                      onValueChange={(value) =>
                        updateValue("labelTemplate", value as PrintingFormValues["labelTemplate"])
                      }
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="xp365b-roll-58x40">{t("templateRoll")}</SelectItem>
                        <SelectItem value="3x8">{t("templateA4ThreeByEight")}</SelectItem>
                        <SelectItem value="2x5">{t("templateA4TwoByFive")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">{t("layoutOrder")}</p>
                  <div className="grid gap-3 md:grid-cols-5">
                    {([
                      ["NAME_BARCODE_PRICE", "layoutNameBarcodePrice"],
                      ["PRICE_NAME_BARCODE", "layoutPriceNameBarcode"],
                      ["NAME_BARCODE", "layoutNameBarcode"],
                      ["PRICE_BARCODE", "layoutPriceBarcode"],
                      ["BARCODE_ONLY", "layoutBarcodeOnly"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={!canEdit}
                        className={`bazaar-admin-choice-card space-y-2 text-xs ${
                          values.labelLayoutOrder === value
                            ? "bazaar-admin-choice-card-active"
                            : ""
                        }`}
                        onClick={() => updateValue("labelLayoutOrder", value)}
                      >
                        <span className="block font-medium text-foreground">{t(label)}</span>
                        <span className="block rounded-lg border border-border bg-white p-2 text-center text-[10px] text-black">
                          {value.includes("PRICE") && value.startsWith("PRICE") ? <b>{sample.price}</b> : null}
                          {value.includes("NAME") ? <span className="block">{sample.productName}</span> : null}
                          <span className="my-1 block h-5 bg-[repeating-linear-gradient(90deg,#000_0_2px,#fff_2px_4px,#000_4px_7px,#fff_7px_10px)]" />
                          {value.includes("PRICE") && !value.startsWith("PRICE") ? <b>{sample.price}</b> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  {([
                    ["labelWidthMm", "widthMm", PRICE_TAG_ROLL_LIMITS.widthMm.step],
                    ["labelHeightMm", "heightMm", PRICE_TAG_ROLL_LIMITS.heightMm.step],
                    ["labelBarcodeHeightMm", "barcodeHeight", 0.5],
                    ["labelFontSize", "fontSize", 0.5],
                    ["labelRollGapMm", "labelRollGapMm", PRICE_TAG_ROLL_LIMITS.gapMm.step],
                    ["labelRollXOffsetMm", "labelRollXOffsetMm", PRICE_TAG_ROLL_LIMITS.offsetMm.step],
                    ["labelRollYOffsetMm", "labelRollYOffsetMm", PRICE_TAG_ROLL_LIMITS.offsetMm.step],
                    ["labelDefaultCopies", "labelDefaultCopies", 1],
                  ] as const).map(([key, label, step]) => (
                    <div key={key} className="space-y-2">
                      <label className="text-sm font-medium text-foreground">{t(label)}</label>
                      <Input
                        type="number"
                        step={step}
                        value={values[key]}
                        onChange={(event) => updateValue(key, Number(event.target.value))}
                        disabled={!canEdit}
                      />
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {([
                    ["labelShowPrice", "showPrice"],
                    ["labelShowProductName", "showProductName"],
                    ["labelShowSku", "showSku"],
                    ["labelShowBarcodeText", "showBarcodeText"],
                    ["labelShowCurrency", "showCurrency"],
                    ["labelShowStoreName", "showStoreName"],
                  ] as const).map(([key, label]) => (
                    <ToggleRow
                      key={key}
                      label={t(label)}
                      checked={values[key]}
                      disabled={!canEdit}
                      onChange={(checked) => updateValue(key, checked)}
                    />
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleTestPrint("barcode")}
                  disabled={
                    testAction !== null ||
                    values.labelPrintProvider !== "QZ_TRAY" ||
                    qzStatus !== "connected"
                  }
                >
                  {testAction === "barcode" ? <Spinner className="h-4 w-4" /> : <PrintIcon className="h-4 w-4" />}
                  {t("testBarcodePrint")}
                </Button>
              </CardContent>
            </Card>
            <Card className="bazaar-admin-surface">
              <CardHeader className="bazaar-admin-section-header">
                <CardTitle>{t("barcodePreview")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="flex items-center justify-center rounded-lg border border-border bg-white p-3 text-center text-black shadow-sm"
                  style={{ width: labelPreviewWidth, minHeight: labelPreviewHeight }}
                >
                  <div className="w-full">
                    {barcodePreviewBlocks.map((block) => {
                      if (block === "name" && values.labelShowProductName) {
                        return <div key={block}>{sample.productName}</div>;
                      }
                      if (block === "price" && values.labelShowPrice) {
                        return (
                          <div key={block} className="text-lg font-bold">
                            {sample.price}
                          </div>
                        );
                      }
                      if (block === "barcode") {
                        return (
                          <div key={block}>
                            <div
                              className="my-2 w-full"
                              style={{
                                height: Math.max(28, values.labelBarcodeHeightMm * 3),
                                background:
                                  "repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px, #000 4px 7px, #fff 7px 10px)",
                              }}
                            />
                            {values.labelShowBarcodeText ? <div>{sample.barcode}</div> : null}
                          </div>
                        );
                      }
                      return null;
                    })}
                    {values.labelShowSku ? <div>{sample.sku}</div> : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
    </div>
  );
};

export default PrintingSettingsPage;
