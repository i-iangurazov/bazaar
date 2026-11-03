"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { InventoryProductPresentation } from "@/lib/inventoryProductPresentation";
import { trpc } from "@/lib/trpc";

type Input = { storeId: string; productIds: string[]; documentKey?: string };
type Line = { productId: string; imageUrl: string | null; sku: string; barcode: string | null };

/** Presentation is overlaid at render time: a refresh cannot change document
 * quantities/costs, draft inputs or the idempotency signature. */
export function useInventoryLinePresentation(input: Input, enabled: boolean) {
  const { mutateAsync } = trpc.inventory.productPresentation.useMutation();
  const signature = JSON.stringify({ ...input, productIds: [...new Set(input.productIds)].sort() });
  const [revision, setRevision] = useState(0);
  const refetch = useCallback(() => setRevision((value) => value + 1), []);
  const [state, setState] = useState<{
    signature: string;
    data?: InventoryProductPresentation[];
    error: boolean;
  }>({ signature: "", error: false });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const timer = setTimeout(() => {
      void mutateAsync(JSON.parse(signature) as Input)
        .then((data) => {
          if (active) setState({ signature, data, error: false });
        })
        .catch(() => {
          if (active)
            setState((current) => ({
              ...current,
              signature,
              error: true,
              data: current.signature === signature ? current.data : undefined,
            }));
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [signature, enabled, revision, mutateAsync]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden") refetch();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, refetch]);
  const byId = useMemo(
    () =>
      new Map(
        enabled && state.signature === signature
          ? state.data?.map((item) => [item.productId, item])
          : [],
      ),
    [enabled, state, signature],
  );
  const getPresentation = (line: Line) => byId.get(line.productId) ?? line;
  return {
    getPresentation,
    refetch,
    isError: enabled && state.signature === signature && state.error,
  };
}
