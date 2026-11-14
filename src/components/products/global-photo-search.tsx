"use client";

import { ProductPhotoSearchButton } from "./product-photo-search";
import { trpc } from "@/lib/trpc";

/** The existing store list enforces membership; the dialog always asks for a scope. */
export function GlobalPhotoSearch({ identityKey, canViewProducts }: { identityKey: string; canViewProducts: boolean }) {
  const stores = trpc.stores.list.useQuery(undefined, { staleTime: 60_000 });
  return <ProductPhotoSearchButton identityKey={identityKey} storeId="" stores={stores.data ?? []}
    iconOnly loadingStores={stores.isLoading} storeError={stores.isError}
    onRetryStores={() => { void stores.refetch(); }} selectionMode={canViewProducts ? "card" : "preview"} />;
}
