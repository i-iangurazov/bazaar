export const WRITE_OFF_REASONS = [
  "Брак",
  "Порча",
  "Просрочка",
  "Потеря",
  "Кража",
  "Для внутреннего использования",
  "Другое",
] as const;

export type StockWriteOffReason = (typeof WRITE_OFF_REASONS)[number];

export const WRITE_OFF_NOTE_PREFIX = "writeOff:";

export const isStockWriteOffReason = (value: string): value is StockWriteOffReason =>
  (WRITE_OFF_REASONS as readonly string[]).includes(value);

export const buildWriteOffMovementNote = (input: {
  reason: StockWriteOffReason;
  comment?: string | null;
}) => {
  const reason = encodeURIComponent(input.reason.trim());
  const comment = input.comment?.trim() ? encodeURIComponent(input.comment.trim()) : "";
  return `${WRITE_OFF_NOTE_PREFIX}${reason}${comment ? `:${comment}` : ""}`;
};

export const parseWriteOffMovementNote = (note?: string | null) => {
  const trimmed = note?.trim();
  if (!trimmed?.startsWith(WRITE_OFF_NOTE_PREFIX)) {
    return null;
  }

  const [encodedReason = "", encodedComment = ""] = trimmed
    .slice(WRITE_OFF_NOTE_PREFIX.length)
    .split(":");
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value).trim();
    } catch {
      return value.trim();
    }
  };
  const reason = decode(encodedReason);
  const comment = decode(encodedComment);
  if (!reason) {
    return null;
  }
  return {
    reason,
    comment: comment || null,
  };
};
