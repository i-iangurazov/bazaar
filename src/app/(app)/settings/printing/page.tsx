"use client";

import { useEffect, useMemo, useState } from "react";
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
  checkLocalPrintAgentHealth,
  defaultLocalPrintAgentUrl,
  getLocalPrintAgentBinding,
  listLocalPrintAgentPrinters,
  printViaLocalPrintAgent,
  saveLocalPrintAgentBinding,
  type LocalPrintAgentBinding,
  type LocalPrintAgentPrinter,
  type PrintProvider,
} from "@/lib/localPrintAgent";
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
  provider === "MANUAL_BROWSER_PRINT" ? PrinterPrintMode.PDF : PrinterPrintMode.CONNECTOR;

const defaultFormValues: PrintingFormValues = {
  receiptPrintProvider: "LOCAL_PRINT_AGENT",
  labelPrintProvider: "LOCAL_PRINT_AGENT",
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

const asProvider = (value: string | null | undefined): PrintProvider =>
  value === "KIOSK_SILENT_PRINT" ||
  value === "NETWORK_ESC_POS" ||
  value === "MANUAL_BROWSER_PRINT"
    ? value
    : "LOCAL_PRINT_AGENT";

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
  <label className="flex items-center justify-between gap-3 border border-border bg-secondary/30 p-3 text-sm">
    <span>{label}</span>
    <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
  </label>
);

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
  const [binding, setBinding] = useState<LocalPrintAgentBinding>({
    agentUrl: defaultLocalPrintAgentUrl,
    receiptPrinterName: "",
    labelPrinterName: "",
  });
  const [agentStatus, setAgentStatus] = useState<"idle" | "checking" | "connected" | "error">("idle");
  const [agentVersion, setAgentVersion] = useState("");
  const [printers, setPrinters] = useState<LocalPrintAgentPrinter[]>([]);
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
    setBinding(getLocalPrintAgentBinding(storeId));
    setAgentStatus("idle");
    setAgentVersion("");
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
      saveLocalPrintAgentBinding(storeId, binding);
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

  const handleCheckAgent = async () => {
    setAgentStatus("checking");
    try {
      const [health, printerRows] = await Promise.all([
        checkLocalPrintAgentHealth(binding.agentUrl),
        listLocalPrintAgentPrinters(binding.agentUrl),
      ]);
      setAgentVersion(health.version ?? "");
      setPrinters(printerRows);
      setAgentStatus("connected");
    } catch {
      setAgentStatus("error");
      setPrinters([]);
      toast({ variant: "error", description: t("agentNotRunning") });
    }
  };

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
      await printViaLocalPrintAgent(binding.agentUrl, {
        storeId,
        printerName,
        jobType: kind === "receipt" ? "RECEIPT" : "BARCODE_LABEL",
        format: "HTML",
        content:
          kind === "receipt"
            ? buildReceiptTestHtml(values, sample)
            : buildBarcodeTestHtml(values, sample),
        options: {
          copies: 1,
          paperWidthMm: kind === "receipt" ? receiptWidthMm(values) : values.labelWidthMm,
          paperHeightMm: kind === "barcode" ? values.labelHeightMm : undefined,
        },
      });
      toast({ variant: "success", description: t("testPrintSent") });
    } catch {
      toast({ variant: "error", description: t("testPrintFailed") });
    } finally {
      setTestAction(null);
    }
  };

  const handleSave = () => {
    if (!storeId || !canEdit) {
      return;
    }
    updateMutation.mutate({
      storeId,
      receiptPrintMode: providerToPrintMode(values.receiptPrintProvider),
      labelPrintMode: providerToPrintMode(values.labelPrintProvider),
      receiptPrintProvider: values.receiptPrintProvider,
      labelPrintProvider: values.labelPrintProvider,
      receiptAutoPrintEnabled: values.receiptAutoPrintEnabled,
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

  const agentStatusLabel = useMemo(() => {
    if (agentStatus === "connected") {
      return agentVersion ? t("agentConnectedVersion", { version: agentVersion }) : t("agentConnected");
    }
    if (agentStatus === "checking") return tCommon("loading");
    if (agentStatus === "error") return t("agentError");
    return t("agentIdle");
  }, [agentStatus, agentVersion, t, tCommon]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Card>
        <CardHeader>
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {tCommon("loading")}
        </div>
      ) : null}
      {settingsQuery.error ? (
        <p className="text-sm text-danger">{translateError(tErrors, settingsQuery.error)}</p>
      ) : null}
      {!selectedStore && !storesQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <EmptyIcon className="h-4 w-4" aria-hidden />
          {t("empty")}
        </div>
      ) : null}

      {selectedStore ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("statusTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center gap-2 border px-3 py-2 text-sm ${
                    agentStatus === "connected"
                      ? "border-success/40 bg-success/10 text-success"
                      : agentStatus === "error"
                        ? "border-danger/40 bg-danger/10 text-danger"
                        : "border-border bg-secondary/30 text-muted-foreground"
                  }`}
                >
                  {agentStatus === "connected" ? (
                    <StatusSuccessIcon className="h-4 w-4" aria-hidden />
                  ) : (
                    <StatusWarningIcon className="h-4 w-4" aria-hidden />
                  )}
                  {agentStatusLabel}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleCheckAgent()}
                  disabled={agentStatus === "checking"}
                >
                  {agentStatus === "checking" ? <Spinner className="h-4 w-4" /> : null}
                  {t("testConnection")}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{t("browserLimitHint")}</p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t("agentUrl")}</label>
                  <Input
                    value={binding.agentUrl}
                    onChange={(event) =>
                      setBinding((current) => ({ ...current, agentUrl: event.target.value }))
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t("receiptPrinter")}</label>
                  <Input
                    list="local-printer-list"
                    value={binding.receiptPrinterName}
                    onChange={(event) =>
                      setBinding((current) => ({
                        ...current,
                        receiptPrinterName: event.target.value,
                      }))
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t("labelPrinter")}</label>
                  <Input
                    list="local-printer-list"
                    value={binding.labelPrinterName}
                    onChange={(event) =>
                      setBinding((current) => ({ ...current, labelPrinterName: event.target.value }))
                    }
                    disabled={!canEdit}
                  />
                </div>
              </div>
              <datalist id="local-printer-list">
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name} />
                ))}
              </datalist>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card>
              <CardHeader>
                <CardTitle>{t("receiptTemplateTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("receiptProvider")}</label>
                    <Select
                      value={values.receiptPrintProvider}
                      onValueChange={(value) => updateValue("receiptPrintProvider", value as PrintProvider)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOCAL_PRINT_AGENT">{t("providerLocalAgent")}</SelectItem>
                        <SelectItem value="KIOSK_SILENT_PRINT">{t("providerKiosk")}</SelectItem>
                        <SelectItem value="NETWORK_ESC_POS">{t("providerNetwork")}</SelectItem>
                        <SelectItem value="MANUAL_BROWSER_PRINT">{t("providerManual")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("fallbackBehavior")}</label>
                    <Select
                      value={values.receiptFallbackMode}
                      onValueChange={(value) => updateValue("receiptFallbackMode", value as ReceiptFallback)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MANUAL_BROWSER_PRINT">{t("fallbackManual")}</SelectItem>
                        <SelectItem value="NONE">{t("fallbackNone")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
                    disabled={!canEdit}
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
                    disabled={testAction !== null}
                  >
                    {testAction === "receipt" ? <Spinner className="h-4 w-4" /> : <PrintIcon className="h-4 w-4" />}
                    {t("testReceiptPrint")}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("receiptPreview")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <div
                    className="border border-border bg-white p-4 text-black shadow-sm"
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
            <Card>
              <CardHeader>
                <CardTitle>{t("barcodeTemplateTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("labelProvider")}</label>
                    <Select
                      value={values.labelPrintProvider}
                      onValueChange={(value) => updateValue("labelPrintProvider", value as PrintProvider)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LOCAL_PRINT_AGENT">{t("providerLocalAgent")}</SelectItem>
                        <SelectItem value="KIOSK_SILENT_PRINT">{t("providerKiosk")}</SelectItem>
                        <SelectItem value="NETWORK_ESC_POS">{t("providerNetwork")}</SelectItem>
                        <SelectItem value="MANUAL_BROWSER_PRINT">{t("providerManual")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
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
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t("layoutOrder")}</label>
                    <Select
                      value={values.labelLayoutOrder}
                      onValueChange={(value) => updateValue("labelLayoutOrder", value as LabelLayoutOrder)}
                      disabled={!canEdit}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRICE_NAME_BARCODE">{t("layoutPriceNameBarcode")}</SelectItem>
                        <SelectItem value="NAME_BARCODE_PRICE">{t("layoutNameBarcodePrice")}</SelectItem>
                        <SelectItem value="BARCODE_ONLY">{t("layoutBarcodeOnly")}</SelectItem>
                        <SelectItem value="NAME_BARCODE">{t("layoutNameBarcode")}</SelectItem>
                        <SelectItem value="PRICE_BARCODE">{t("layoutPriceBarcode")}</SelectItem>
                      </SelectContent>
                    </Select>
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
                  disabled={testAction !== null}
                >
                  {testAction === "barcode" ? <Spinner className="h-4 w-4" /> : <PrintIcon className="h-4 w-4" />}
                  {t("testBarcodePrint")}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("barcodePreview")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="flex items-center justify-center border border-border bg-white p-3 text-center text-black shadow-sm"
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
  );
};

export default PrintingSettingsPage;
