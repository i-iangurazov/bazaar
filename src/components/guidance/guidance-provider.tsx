"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  filterGuidanceTips,
  filterGuidanceTours,
  getGuidancePageKey,
  guidanceTips,
  guidanceTours,
  shouldAutoRunTour,
  type GuidanceFeature,
  type GuidancePageKey,
  type GuidanceRole,
  type GuidanceTipDefinition,
  type GuidanceTourDefinition,
} from "@/lib/guidance";
import {
  type GuidanceSyncPayload,
  completeTourOptimistic,
  createGuidanceSyncScheduler,
  dismissAutoTourOptimistic,
  toSortedGuidanceArray,
} from "@/lib/guidance-sync";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";

type GuidanceContextValue = {
  role: GuidanceRole;
  features: GuidanceFeature[];
  isLoading: boolean;
  pageKey: GuidancePageKey | null;
  pageTips: GuidanceTipDefinition[];
  pageTours: GuidanceTourDefinition[];
  dismissedAutoTours: Set<string>;
  completedTours: Set<string>;
  toursDisabled: boolean;
  activeTourId: string | null;
  focusedTipId: string | null;
  startTour: (tourId: string) => void;
  stopTour: () => void;
  completeTour: (tourId: string) => Promise<void>;
  skipTour: (tourId: string) => Promise<void>;
  resetTour: (tourId: string) => Promise<void>;
  setToursDisabled: (disabled: boolean) => Promise<void>;
  focusTip: (tipId: string | null) => void;
};

const GuidanceContext = createContext<GuidanceContextValue | null>(null);

type GuidanceProviderProps = {
  role: GuidanceRole;
  children: ReactNode;
};

const toStringSet = (value: string[]) => new Set(value.filter((item) => item.trim()));

const toFeatures = (features: unknown): GuidanceFeature[] => {
  if (!Array.isArray(features)) {
    return [];
  }
  return features.filter(
    (feature): feature is GuidanceFeature =>
      feature === "imports" ||
      feature === "exports" ||
      feature === "analytics" ||
      feature === "compliance" ||
      feature === "supportToolkit",
  );
};

const toGuidanceSnapshot = (
  state: {
    dismissedAutoTours?: string[];
    dismissedTips: string[];
    completedTours: string[];
    toursDisabled?: boolean;
    updatedAt?: string | null;
  },
) => {
  const nextDismissedAutoTours = toStringSet(state.dismissedAutoTours ?? state.dismissedTips);
  const nextCompletedTours = toStringSet(state.completedTours);
  const nextToursDisabled = Boolean(state.toursDisabled);
  const updatedAtMs = state.updatedAt ? Date.parse(state.updatedAt) : 0;
  return {
    dismissedAutoTours: nextDismissedAutoTours,
    completedTours: nextCompletedTours,
    toursDisabled: nextToursDisabled,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
  };
};

const hasMountedGuidanceTarget = (tour: GuidanceTourDefinition) => {
  return tour.steps.some((step) => Boolean(document.querySelector(step.selector)));
};

const waitForMountedGuidanceTarget = async (tour: GuidanceTourDefinition, timeoutMs = 2_500) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (hasMountedGuidanceTarget(tour)) {
      return true;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return false;
};

export const GuidanceProvider = ({ role, children }: GuidanceProviderProps) => {
  const t = useTranslations("guidance");
  const { toast } = useToast();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const router = useRouter();
  const pageKey = useMemo(() => getGuidancePageKey(pathname), [pathname]);

  const guidanceStateQuery = trpc.guidance.getState.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const billingQuery = trpc.billing.get.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
  const syncStateMutation = trpc.guidance.syncState.useMutation();

  const [dismissedAutoTours, setDismissedAutoTours] = useState<Set<string>>(new Set());
  const [completedTours, setCompletedTours] = useState<Set<string>>(new Set());
  const [toursDisabled, setToursDisabledState] = useState(false);
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [focusedTipId, setFocusedTipId] = useState<string | null>(null);

  const dismissedAutoToursRef = useRef<Set<string>>(new Set());
  const completedToursRef = useRef<Set<string>>(new Set());
  const toursDisabledRef = useRef(false);
  const syncSchedulerRef = useRef<ReturnType<typeof createGuidanceSyncScheduler> | null>(null);
  const syncStateMutateAsyncRef = useRef(syncStateMutation.mutateAsync);
  const syncErrorHandlerRef = useRef<() => void>(() => {});
  const lastGuidanceUpdateMsRef = useRef(0);

  const applyGuidanceState = useCallback(
    (state: {
      dismissedAutoTours?: string[];
      dismissedTips: string[];
      completedTours: string[];
      toursDisabled?: boolean;
      updatedAt?: string | null;
    }) => {
      const snapshot = toGuidanceSnapshot(state);
      dismissedAutoToursRef.current = snapshot.dismissedAutoTours;
      completedToursRef.current = snapshot.completedTours;
      toursDisabledRef.current = snapshot.toursDisabled;

      if (snapshot.updatedAtMs > 0) {
        lastGuidanceUpdateMsRef.current = Math.max(lastGuidanceUpdateMsRef.current, snapshot.updatedAtMs);
      }

      setDismissedAutoTours(snapshot.dismissedAutoTours);
      setCompletedTours(snapshot.completedTours);
      setToursDisabledState(snapshot.toursDisabled);
    },
    [],
  );

  const persistGuidanceState = useCallback(
    async (payload: GuidanceSyncPayload) => {
      try {
        const persistedState = await syncStateMutateAsyncRef.current(payload);
        applyGuidanceState({
          dismissedAutoTours: (persistedState as { dismissedAutoTours?: string[] }).dismissedAutoTours,
          dismissedTips: persistedState.dismissedTips,
          completedTours: persistedState.completedTours,
          toursDisabled: (persistedState as { toursDisabled?: boolean }).toursDisabled,
          updatedAt: (persistedState as { updatedAt?: string | null }).updatedAt ?? null,
        });
      } catch {
        syncSchedulerRef.current?.enqueue(payload);
        syncErrorHandlerRef.current();
      }
    },
    [applyGuidanceState],
  );

  const features = useMemo(
    () => toFeatures((billingQuery.data as { features?: unknown } | undefined)?.features ?? []),
    [billingQuery.data],
  );

  useEffect(() => {
    if (!guidanceStateQuery.data) {
      return;
    }
    const snapshot = toGuidanceSnapshot({
      dismissedAutoTours: (guidanceStateQuery.data as { dismissedAutoTours?: string[] }).dismissedAutoTours,
      dismissedTips: guidanceStateQuery.data.dismissedTips,
      completedTours: guidanceStateQuery.data.completedTours,
      toursDisabled: (guidanceStateQuery.data as { toursDisabled?: boolean }).toursDisabled,
      updatedAt: (guidanceStateQuery.data as { updatedAt?: string | null }).updatedAt ?? null,
    });
    if (snapshot.updatedAtMs > 0 && snapshot.updatedAtMs < lastGuidanceUpdateMsRef.current) {
      return;
    }
    applyGuidanceState({
      dismissedAutoTours: (guidanceStateQuery.data as { dismissedAutoTours?: string[] }).dismissedAutoTours,
      dismissedTips: guidanceStateQuery.data.dismissedTips,
      completedTours: guidanceStateQuery.data.completedTours,
      toursDisabled: (guidanceStateQuery.data as { toursDisabled?: boolean }).toursDisabled,
      updatedAt: (guidanceStateQuery.data as { updatedAt?: string | null }).updatedAt ?? null,
    });
  }, [applyGuidanceState, guidanceStateQuery.data]);

  useEffect(() => {
    dismissedAutoToursRef.current = dismissedAutoTours;
  }, [dismissedAutoTours]);

  useEffect(() => {
    completedToursRef.current = completedTours;
  }, [completedTours]);

  useEffect(() => {
    toursDisabledRef.current = toursDisabled;
  }, [toursDisabled]);

  useEffect(() => {
    syncStateMutateAsyncRef.current = syncStateMutation.mutateAsync;
  }, [syncStateMutation.mutateAsync]);

  useEffect(() => {
    syncErrorHandlerRef.current = () => {
      toast({
        variant: "error",
        description: t("saveFailed"),
      });
    };
  }, [toast, t]);

  useEffect(() => {
    syncSchedulerRef.current = createGuidanceSyncScheduler({
      delayMs: 350,
      persist: async (payload) => {
        await syncStateMutateAsyncRef.current(payload);
      },
      onError: () => {
        syncErrorHandlerRef.current();
      },
    });

    return () => {
      syncSchedulerRef.current?.dispose();
      syncSchedulerRef.current = null;
    };
  }, []);

  const availableTips = useMemo(
    () => filterGuidanceTips(guidanceTips, { role, features }),
    [role, features],
  );

  const availableTours = useMemo(
    () => filterGuidanceTours(guidanceTours, { role, features }),
    [role, features],
  );

  const pageTips = useMemo(
    () => (pageKey ? availableTips.filter((tip) => tip.pageKey === pageKey) : []),
    [availableTips, pageKey],
  );

  const pageTours = useMemo(
    () => (pageKey ? availableTours.filter((tour) => tour.pageKey === pageKey) : []),
    [availableTours, pageKey],
  );

  useEffect(() => {
    setFocusedTipId(null);
    setActiveTourId(null);
  }, [pageKey]);

  useEffect(() => {
    const requestedTourId = searchParams.get("tour");
    if (!requestedTourId) {
      return;
    }

    const requestedTour = availableTours.find((tour) => tour.id === requestedTourId);
    if (requestedTour && requestedTour.pageKey === pageKey && !toursDisabled) {
      setActiveTourId(requestedTourId);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("tour");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [availableTours, pageKey, pathname, router, searchParams, toursDisabled]);

  useEffect(() => {
    if (!pageKey || !pageTours.length || activeTourId || guidanceStateQuery.isLoading) {
      return;
    }

    const pageTour = pageTours[0];
    if (
      !shouldAutoRunTour(
        {
          completedTours,
          dismissedAutoTours,
          toursDisabled,
        },
        pageTour.id,
      )
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const hasTarget = await waitForMountedGuidanceTarget(pageTour);
      if (!hasTarget || cancelled || toursDisabledRef.current) {
        return;
      }
      setActiveTourId(pageTour.id);
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pageKey, pageTours, activeTourId, guidanceStateQuery.isLoading, completedTours, dismissedAutoTours, toursDisabled]);

  const startTour = useCallback(
    (tourId: string) => {
      if (toursDisabledRef.current) {
        return;
      }
      setActiveTourId(tourId);
      setFocusedTipId(null);
    },
    [],
  );

  const stopTour = useCallback(() => {
    setActiveTourId(null);
  }, []);

  const completeTour = useCallback(
    (tourId: string) => {
      const nextCompletedTours = completeTourOptimistic(completedToursRef.current, tourId);
      completedToursRef.current = nextCompletedTours;
      lastGuidanceUpdateMsRef.current = Date.now();
      setCompletedTours(nextCompletedTours);

      const payload: GuidanceSyncPayload = {
        dismissedAutoTours: toSortedGuidanceArray(dismissedAutoToursRef.current),
        completedTours: toSortedGuidanceArray(nextCompletedTours),
        toursDisabled: toursDisabledRef.current,
      };
      void persistGuidanceState(payload);
      return Promise.resolve();
    },
    [persistGuidanceState],
  );

  const skipTour = useCallback(
    (tourId: string) => {
      const nextCompletedTours = completeTourOptimistic(completedToursRef.current, tourId);
      const nextDismissedAutoTours = dismissAutoTourOptimistic(dismissedAutoToursRef.current, tourId);

      completedToursRef.current = nextCompletedTours;
      dismissedAutoToursRef.current = nextDismissedAutoTours;
      lastGuidanceUpdateMsRef.current = Date.now();

      setCompletedTours(nextCompletedTours);
      setDismissedAutoTours(nextDismissedAutoTours);

      const payload: GuidanceSyncPayload = {
        dismissedAutoTours: toSortedGuidanceArray(nextDismissedAutoTours),
        completedTours: toSortedGuidanceArray(nextCompletedTours),
        toursDisabled: toursDisabledRef.current,
      };
      void persistGuidanceState(payload);
      return Promise.resolve();
    },
    [persistGuidanceState],
  );

  const resetTour = useCallback(
    (tourId: string) => {
      const nextCompletedTours = new Set(completedToursRef.current);
      nextCompletedTours.delete(tourId);
      const nextDismissedAutoTours = new Set(dismissedAutoToursRef.current);
      nextDismissedAutoTours.delete(tourId);

      completedToursRef.current = nextCompletedTours;
      dismissedAutoToursRef.current = nextDismissedAutoTours;
      lastGuidanceUpdateMsRef.current = Date.now();

      setCompletedTours(nextCompletedTours);
      setDismissedAutoTours(nextDismissedAutoTours);

      const payload: GuidanceSyncPayload = {
        dismissedAutoTours: toSortedGuidanceArray(nextDismissedAutoTours),
        completedTours: toSortedGuidanceArray(nextCompletedTours),
        toursDisabled: toursDisabledRef.current,
      };
      void persistGuidanceState(payload);
      return Promise.resolve();
    },
    [persistGuidanceState],
  );

  const setToursDisabled = useCallback(
    (disabled: boolean) => {
      toursDisabledRef.current = disabled;
      lastGuidanceUpdateMsRef.current = Date.now();
      setToursDisabledState(disabled);
      if (disabled) {
        setActiveTourId(null);
      }

      const payload: GuidanceSyncPayload = {
        dismissedAutoTours: toSortedGuidanceArray(dismissedAutoToursRef.current),
        completedTours: toSortedGuidanceArray(completedToursRef.current),
        toursDisabled: disabled,
      };
      void persistGuidanceState(payload);
      return Promise.resolve();
    },
    [persistGuidanceState],
  );

  const value = useMemo<GuidanceContextValue>(
    () => ({
      role,
      features,
      isLoading: guidanceStateQuery.isLoading || billingQuery.isLoading || syncStateMutation.isLoading,
      pageKey,
      pageTips,
      pageTours,
      dismissedAutoTours,
      completedTours,
      toursDisabled,
      activeTourId,
      focusedTipId,
      startTour,
      stopTour,
      completeTour,
      skipTour,
      resetTour,
      setToursDisabled,
      focusTip: (tipId: string | null) => setFocusedTipId(tipId),
    }),
    [
      role,
      features,
      guidanceStateQuery.isLoading,
      billingQuery.isLoading,
      syncStateMutation.isLoading,
      pageKey,
      pageTips,
      pageTours,
      dismissedAutoTours,
      completedTours,
      toursDisabled,
      activeTourId,
      focusedTipId,
      startTour,
      stopTour,
      completeTour,
      skipTour,
      resetTour,
      setToursDisabled,
    ],
  );

  return <GuidanceContext.Provider value={value}>{children}</GuidanceContext.Provider>;
};

export const useGuidance = () => {
  const context = useContext(GuidanceContext);
  if (!context) {
    throw new Error("useGuidance must be used within GuidanceProvider");
  }
  return context;
};
