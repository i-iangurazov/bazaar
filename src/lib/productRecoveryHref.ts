/** Search by the organization-unique SKU, including hidden and archived cards.
 * Reset unrelated filters so the recovery link cannot land on an empty list. */
export function productRecoveryHref(sku: string, storeId?: string) {
  const params = new URLSearchParams({
    list: "1",
    archived: "true",
    q: sku,
    category: "",
    type: "all",
    readiness: "all",
    page: "1",
  });
  if (storeId) params.set("storeId", storeId);
  return `/products?${params}`;
}
