/** Fixed internal return route; never accept arbitrary returnTo navigation. */
export const posShiftCloseHref = (registerId: string) =>
  `/pos/shifts?registerId=${encodeURIComponent(registerId)}#shift-close`;

export const posShiftReceiptHref = (registerId: string, receiptId: string) =>
  `/pos/sell?registerId=${encodeURIComponent(registerId)}&receiptId=${encodeURIComponent(receiptId)}&mode=resume&from=shift-close`;
