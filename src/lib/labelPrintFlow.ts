import {
  PRICE_TAG_ROLL_DEFAULTS,
  PRICE_TAG_TEMPLATES,
  ROLL_PRICE_TAG_TEMPLATE,
  type PriceTagsTemplate,
} from "@/lib/priceTags";

export type LabelPrintProfileLike = {
  id?: string | null;
  labelTemplate?: string | null;
  labelDefaultCopies?: number | null;
  labelWidthMm?: number | null;
  labelHeightMm?: number | null;
} | null | undefined;

export type LabelPrintFlowAction = "quickPrint" | "setupRequired" | "openSettings" | "loading";

export const hasSavedLabelPrintProfile = (settings: LabelPrintProfileLike) =>
  Boolean(settings?.id);

export const resolveLabelPrintFlowAction = ({
  settings,
  storeId,
  isLoading,
  explicitSettings,
}: {
  settings: LabelPrintProfileLike;
  storeId?: string | null;
  isLoading?: boolean;
  explicitSettings?: boolean;
}): LabelPrintFlowAction => {
  if (explicitSettings) {
    return "openSettings";
  }
  if (!storeId) {
    return "setupRequired";
  }
  if (isLoading) {
    return "loading";
  }
  return hasSavedLabelPrintProfile(settings) ? "quickPrint" : "setupRequired";
};

export const resolveSavedLabelTemplate = (value?: string | null): PriceTagsTemplate =>
  PRICE_TAG_TEMPLATES.includes(value as PriceTagsTemplate)
    ? (value as PriceTagsTemplate)
    : ROLL_PRICE_TAG_TEMPLATE;

export const resolveSavedLabelCopies = (value?: number | null) => {
  const copies = Math.trunc(Number(value ?? 1));
  return Number.isFinite(copies) && copies > 0 ? copies : 1;
};

export const buildSavedLabelPrintValues = ({
  settings,
  storeId,
  quantity,
}: {
  settings: LabelPrintProfileLike;
  storeId?: string | null;
  quantity?: number | null;
}) => ({
  template: resolveSavedLabelTemplate(settings?.labelTemplate),
  storeId: storeId ?? "",
  quantity: resolveSavedLabelCopies(quantity ?? settings?.labelDefaultCopies),
  widthMm: settings?.labelWidthMm ?? PRICE_TAG_ROLL_DEFAULTS.widthMm,
  heightMm: settings?.labelHeightMm ?? PRICE_TAG_ROLL_DEFAULTS.heightMm,
  allowWithoutBarcode: false,
});
