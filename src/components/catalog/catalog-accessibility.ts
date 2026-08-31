const defaultCatalogAccentColor = "#2a6be4";
const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

const normalizeHexColor = (value?: string | null) =>
  value && hexColorPattern.test(value) ? value.toLowerCase() : defaultCatalogAccentColor;

const hexToRgb = (value: string) => {
  const normalized = normalizeHexColor(value);
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ] as const;
};

const relativeLuminance = (value: string) => {
  const [red, green, blue] = hexToRgb(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
};

export const catalogContrastRatio = (left: string, right: string) => {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

export const resolveCatalogAccentForeground = (background: string) => {
  const normalizedBackground = normalizeHexColor(background);
  const whiteContrast = catalogContrastRatio(normalizedBackground, "#ffffff");
  const blackContrast = catalogContrastRatio(normalizedBackground, "#000000");
  return whiteContrast >= blackContrast ? "#ffffff" : "#000000";
};

export const sanitizeCatalogAccent = normalizeHexColor;
