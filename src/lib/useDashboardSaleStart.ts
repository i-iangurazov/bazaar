"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mobileShellMediaQuery } from "@/hooks/useIsMobile";
import { trpc } from "@/lib/trpc";

export function useDashboardSaleStart({
  storeId,
  fallbackHref,
  scopeKey,
}: {
  storeId: string | null;
  fallbackHref: string;
  scopeKey: string;
}) {
  const router = useRouter();
  const { pos } = trpc.useUtils();
  const request = useRef<symbol | null>(null);
  const [checkingScope, setCheckingScope] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();

  useLayoutEffect(() => {
    setCheckingScope(null);
    return () => {
      request.current = null;
    };
  }, [scopeKey]);

  const cancel = () => {
    request.current = null;
    setCheckingScope(null);
  };

  // Next Link handles modified clicks itself. Only intercept in-app navigation on phones.
  const onNavigate = async (event: { preventDefault: () => void }) => {
    if (!storeId || !window.matchMedia?.(mobileShellMediaQuery).matches) return;

    event.preventDefault();
    if (request.current || navigating) return;

    const lookup = Symbol();
    request.current = lookup;
    setCheckingScope(scopeKey);

    let href = fallbackHref;
    try {
      const registers = await pos.registers.list.fetch(
        { storeId },
        { staleTime: 0, retry: false, networkMode: "always" },
      );
      const openRegisters = registers.filter(
        (register) =>
          register.storeId === storeId && register.isActive && register.openShift?.status === "OPEN",
      );
      if (openRegisters.length === 1) {
        href = `/pos/sell?registerId=${encodeURIComponent(openRegisters[0]!.id)}`;
      }
    } catch {
      // The existing POS entry handles shift selection, access changes and read errors.
    }
    if (request.current !== lookup) return;

    startNavigation(() => router.push(href));
    cancel();
  };

  return { onNavigate, cancel, pending: checkingScope === scopeKey || navigating };
}
