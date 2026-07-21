"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

import {
  buildPosRegisterStorageKey,
  resolvePosRegisterContext,
  type PosRegisterResolutionIssue,
} from "@/lib/posRegisterContext";

const legacyGlobalRegisterKey = "pos:selected-register";

type PosRegisterOption = {
  id: string;
  isActive: boolean;
};

type PosRegisterSelectionState = {
  scopeKey: string | null;
  registerId: string;
  issue: PosRegisterResolutionIssue;
  isReady: boolean;
};

export const usePosRegisterSelection = ({
  registers,
  registersReady,
  serverPreferenceId,
}: {
  registers: readonly PosRegisterOption[];
  registersReady: boolean;
  serverPreferenceId?: string | null;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const explicitRegisterId = searchParams.get("registerId")?.trim() || null;
  const searchParamsString = searchParams.toString();
  const storageKey = useMemo(
    () =>
      buildPosRegisterStorageKey({
        organizationId: session?.user?.organizationId,
        userId: session?.user?.id,
      }),
    [session?.user?.id, session?.user?.organizationId],
  );
  const registerFingerprint = registers
    .map((register) => `${register.id}:${register.isActive ? "1" : "0"}`)
    .sort()
    .join("|");
  const stableRegisters = useMemo(
    () =>
      registerFingerprint
        ? registerFingerprint.split("|").map((entry) => {
            const statusSeparator = entry.lastIndexOf(":");
            return {
              id: entry.slice(0, statusSeparator),
              isActive: entry.slice(statusSeparator + 1) === "1",
            };
          })
        : [],
    [registerFingerprint],
  );
  const [state, setState] = useState<PosRegisterSelectionState>({
    scopeKey: null,
    registerId: "",
    issue: null,
    isReady: false,
  });
  const mountedScopeKeyRef = useRef<string | null | undefined>(undefined);

  const replaceRegisterInUrl = useCallback(
    (registerId: string | null) => {
      const params = new URLSearchParams(searchParamsString);
      if (registerId) {
        params.set("registerId", registerId);
      } else {
        params.delete("registerId");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParamsString],
  );

  useEffect(() => {
    if (sessionStatus === "loading" || !registersReady || !storageKey) {
      return;
    }

    let persistedRegisterId: string | null = null;
    try {
      persistedRegisterId = window.localStorage.getItem(storageKey);
    } catch {
      persistedRegisterId = null;
    }

    const previousMountedScopeKey = mountedScopeKeyRef.current;
    const accountChangedInMountedPage =
      previousMountedScopeKey !== undefined && previousMountedScopeKey !== storageKey;
    mountedScopeKeyRef.current = storageKey;

    const resolution = resolvePosRegisterContext({
      explicitRegisterId: accountChangedInMountedPage ? null : explicitRegisterId,
      persistedRegisterId,
      serverPreferenceId,
      registers: stableRegisters,
    });

    try {
      window.localStorage.removeItem(legacyGlobalRegisterKey);
      if (resolution.clearPersistedRegister) {
        window.localStorage.removeItem(storageKey);
      } else if (resolution.registerId) {
        window.localStorage.setItem(storageKey, resolution.registerId);
      }
    } catch {
      // POS can continue with the in-memory and URL selection when storage is unavailable.
    }

    setState((current) => {
      const next = {
        scopeKey: storageKey,
        registerId: resolution.registerId ?? "",
        issue: resolution.issue,
        isReady: true,
      };
      return current.scopeKey === next.scopeKey &&
        current.registerId === next.registerId &&
        current.issue === next.issue &&
        current.isReady === next.isReady
        ? current
        : next;
    });

    if (resolution.registerId && explicitRegisterId !== resolution.registerId) {
      replaceRegisterInUrl(resolution.registerId);
    } else if (accountChangedInMountedPage && explicitRegisterId) {
      replaceRegisterInUrl(null);
    }
  }, [
    explicitRegisterId,
    registerFingerprint,
    registersReady,
    replaceRegisterInUrl,
    serverPreferenceId,
    sessionStatus,
    stableRegisters,
    storageKey,
  ]);

  const selectRegister = useCallback(
    (registerId: string) => {
      if (!storageKey || !stableRegisters.some((item) => item.id === registerId && item.isActive)) {
        setState({
          scopeKey: storageKey,
          registerId: "",
          issue: "invalid-explicit",
          isReady: true,
        });
        return;
      }

      try {
        window.localStorage.removeItem(legacyGlobalRegisterKey);
        window.localStorage.setItem(storageKey, registerId);
      } catch {
        // The URL remains the durable fallback for this browser session.
      }
      setState({ scopeKey: storageKey, registerId, issue: null, isReady: true });
      replaceRegisterInUrl(registerId);
    },
    [replaceRegisterInUrl, stableRegisters, storageKey],
  );

  const isCurrentScope = state.scopeKey === storageKey;
  return {
    registerId: isCurrentScope ? state.registerId : "",
    selectRegister,
    issue: isCurrentScope ? state.issue : null,
    isReady: isCurrentScope && state.isReady,
    storageKey,
  };
};
