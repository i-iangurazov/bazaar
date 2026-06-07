const parseFlag = (value: string | undefined) => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const parseOptionalFlag = (value: string | undefined, defaultValue: boolean) => {
  if (!value) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return parseFlag(value);
};

export const isAiFeaturesEnabled = () => parseFlag(process.env.NEXT_PUBLIC_AI_FEATURES_ENABLED);

export const isAiDescriptionGenerationEnabled = () =>
  parseOptionalFlag(process.env.NEXT_PUBLIC_AI_DESCRIPTION_GENERATION_ENABLED, true);

export const isProductPacksEnabled = () => parseFlag(process.env.NEXT_PUBLIC_PRODUCT_PACKS_ENABLED);
