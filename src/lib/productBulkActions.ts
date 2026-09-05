type ProductArchiveState = { id: string; isDeleted: boolean };

export async function updateSelectedProductArchiveState({
  selectedIds,
  archived,
  loadProducts,
  updateProduct,
}: {
  selectedIds: string[];
  archived: boolean;
  loadProducts: (ids: string[]) => Promise<ProductArchiveState[]>;
  updateProduct: (productId: string) => Promise<unknown>;
}) {
  const ids = Array.from(new Set(selectedIds));
  const selected = new Set(ids);
  const products = new Map<string, ProductArchiveState>();
  // Keep read URLs bounded and resolve every selected page before any write.
  for (let offset = 0; offset < ids.length; offset += 100) {
    for (const product of await loadProducts(ids.slice(offset, offset + 100))) {
      if (selected.has(product.id)) products.set(product.id, product);
    }
  }
  const failedIds = ids.filter((id) => !products.has(id));
  const skippedIds = ids.filter((id) => products.get(id)?.isDeleted === archived);
  const targets = ids.filter((id) => products.has(id) && products.get(id)!.isDeleted !== archived);
  const succeededIds: string[] = [];
  // Each mutation retains its normal server-side authorization and audit trail.
  for (let offset = 0; offset < targets.length; offset += 5) {
    const batch = targets.slice(offset, offset + 5);
    const outcomes = await Promise.allSettled(batch.map((id) => Promise.resolve().then(() => updateProduct(id))));
    outcomes.forEach((outcome, index) => {
      (outcome.status === "fulfilled" ? succeededIds : failedIds).push(batch[index]!);
    });
  }
  return { succeededIds, failedIds, skippedIds };
}
