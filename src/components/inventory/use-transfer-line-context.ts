"use client";
import { useCallback, useEffect, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc";

type Result = inferRouterOutputs<AppRouter>["inventory"]["transferLineContext"];
type Input = {
  fromStoreId: string;
  toStoreId: string;
  lines: Array<{ productId: string; variantId?: string | null }>;
};

/** POST validation keeps 500-line documents out of GET URL limits. Stale replies
 * cannot overwrite the selected source/destination or a newer line selection. */
export function useTransferLineContext(input: Input, enabled: boolean) {
  const { mutateAsync } = trpc.inventory.transferLineContext.useMutation();
  const signature = JSON.stringify(input);
  const [revision, setRevision] = useState(0);
  const refetch = useCallback(() => setRevision((value) => value + 1), []);
  const [state, setState] = useState<{
    signature: string;
    data?: Result;
    pending: boolean;
    error: boolean;
  }>({
    signature: "",
    pending: false,
    error: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ signature, pending: true, error: false });
    const timer = setTimeout(() => {
      void mutateAsync(JSON.parse(signature) as Input)
        .then((data) => {
          if (active) setState({ signature, data, pending: false, error: false });
        })
        .catch(() => {
          if (active) setState({ signature, pending: false, error: true });
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
  return {
    data: state.signature === signature ? state.data : undefined,
    isFetching: enabled && (state.signature !== signature || state.pending),
    isError: state.signature === signature && state.error,
    refetch,
  };
}
