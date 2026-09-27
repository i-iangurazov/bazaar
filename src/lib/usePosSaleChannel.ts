"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type CommercialSaleChannel = "IN_STORE" | "ONLINE";
const valid = (value: unknown): value is CommercialSaleChannel =>
  value === "IN_STORE" || value === "ONLINE";
const memory = new Map<string, CommercialSaleChannel>();
function read(key: string) {
  try {
    const value = localStorage.getItem(key);
    if (valid(value)) return value;
  } catch {
    /* Private browsing can disable storage; keep this tab's draft. */
  }
  return memory.get(key);
}
function write(key: string, value?: CommercialSaleChannel) {
  if (value) memory.set(key, value);
  else memory.delete(key);
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* Retain the in-memory draft when browser storage is unavailable. */
  }
}

/** Channel changes are local until an existing create/hold/complete request saves them.
 * Keys include user, register and receipt, so changing carts cannot reuse another choice. */
export function usePosSaleChannel(input: {
  userId?: string;
  registerId?: string | null;
  saleId?: string | null;
  saved?: CommercialSaleChannel | null;
}) {
  const prefix = `bazaar:pos-channel:${input.userId ?? "pending"}:${input.registerId ?? "pending"}:`;
  const key = prefix + (input.saleId ?? "new");
  const [revision, rerender] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key === key) rerender((n) => n + 1);
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [key]);
  const get = useCallback(
    (saleId = input.saleId, saved = input.saved) =>
      read(prefix + (saleId ?? "new")) ?? saved ?? undefined,
    [prefix, input.saleId, input.saved],
  );
  const set = useCallback(
    (value: CommercialSaleChannel) => {
      write(key, value);
      rerender((n) => n + 1);
    },
    [key],
  );
  const adopt = useCallback(
    (saleId: string) => {
      const pending = read(prefix + "new");
      if (pending) write(prefix + saleId, pending);
      write(prefix + "new");
      rerender((n) => n + 1);
    },
    [prefix],
  );
  const reset = useCallback(() => {
    write(key);
    write(prefix + "new");
    rerender((n) => n + 1);
  }, [key, prefix]);
  // Read after state/storage events; never write storage during render.
  void revision;
  const channel = (hydrated ? get() : input.saved) ?? "IN_STORE";
  return useMemo(() => ({ channel, get, set, adopt, reset }), [channel, get, set, adopt, reset]);
}
