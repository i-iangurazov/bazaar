export type MobilePosCompletionAttempt = {
  saleId: string;
  idempotencyKey: string;
};

export const buildHeldReceiptResumeHref = (registerId: string, receiptId: string) =>
  `/pos/sell?registerId=${encodeURIComponent(registerId)}&receiptId=${encodeURIComponent(receiptId)}&mode=resume`;

export const resolveMobilePosCompletionAttempt = (input: {
  current: MobilePosCompletionAttempt | null;
  saleId: string;
  createIdempotencyKey: () => string;
}): MobilePosCompletionAttempt => {
  if (input.current?.saleId === input.saleId) {
    return input.current;
  }

  return {
    saleId: input.saleId,
    idempotencyKey: input.createIdempotencyKey(),
  };
};

export const mergeMobilePosReceiptHistory = <T extends { id: string; createdAt: Date | string }>(
  primary: T[],
  held: T[],
): T[] => {
  const byId = new Map<string, T>();
  for (const item of [...primary, ...held]) {
    byId.set(item.id, item);
  }

  return Array.from(byId.values()).sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
};
