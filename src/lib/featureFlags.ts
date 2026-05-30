const parseFlag = (value: string | undefined) => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
};

export const isAiFeaturesEnabled = () => parseFlag(process.env.NEXT_PUBLIC_AI_FEATURES_ENABLED);

export const isProductPacksEnabled = () =>
  parseFlag(process.env.NEXT_PUBLIC_PRODUCT_PACKS_ENABLED);
