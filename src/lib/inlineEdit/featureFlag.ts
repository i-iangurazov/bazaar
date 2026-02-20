const parseFlag = (value: string | undefined) => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const isInlineEditingEnabled = () => {
  const explicit = process.env.NEXT_PUBLIC_INLINE_EDITING ?? process.env.INLINE_EDITING;
  if (explicit !== undefined) {
    return parseFlag(explicit);
  }
  return process.env.NODE_ENV !== "production";
};
