export type StorePriceFallbackRow = {
  storeId: string;
  storeName: string;
  overridePriceKgs: number | null;
  effectivePriceKgs: number | null;
};

export type BasePriceFallbackCandidate = {
  priceKgs: number;
  sourceStoreId: string;
  sourceStoreName: string;
  matchingStoreCount: number;
};

const normalizePrice = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export const deriveBasePriceFallbackCandidate = (
  stores: StorePriceFallbackRow[],
): BasePriceFallbackCandidate | null => {
  const pricedStores = stores
    .map((store) => ({
      ...store,
      resolvedPriceKgs: normalizePrice(store.overridePriceKgs) ?? normalizePrice(store.effectivePriceKgs),
    }))
    .filter((store): store is StorePriceFallbackRow & { resolvedPriceKgs: number } =>
      store.resolvedPriceKgs !== null,
    );

  if (!pricedStores.length) {
    return null;
  }

  const uniquePrices = Array.from(new Set(pricedStores.map((store) => store.resolvedPriceKgs)));
  if (uniquePrices.length !== 1) {
    return null;
  }

  const sourceStore = pricedStores[0];
  if (!sourceStore) {
    return null;
  }

  return {
    priceKgs: sourceStore.resolvedPriceKgs,
    sourceStoreId: sourceStore.storeId,
    sourceStoreName: sourceStore.storeName,
    matchingStoreCount: pricedStores.length,
  };
};
