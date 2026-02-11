export type GuidanceSyncPayload = {
  dismissedAutoTours: string[];
  completedTours: string[];
  toursDisabled: boolean;
};

type GuidanceSyncSchedulerInput = {
  delayMs?: number;
  persist: (payload: GuidanceSyncPayload) => Promise<void>;
  onError?: (error: unknown) => void;
};

export const toSortedGuidanceArray = (value: Set<string>) =>
  Array.from(value).sort((a, b) => a.localeCompare(b));

export const dismissAutoTourOptimistic = (current: Set<string>, tourId: string) => {
  if (current.has(tourId)) {
    return current;
  }
  const next = new Set(current);
  next.add(tourId);
  return next;
};

export const completeTourOptimistic = (current: Set<string>, tourId: string) => {
  if (current.has(tourId)) {
    return current;
  }
  const next = new Set(current);
  next.add(tourId);
  return next;
};

export const createGuidanceSyncScheduler = ({
  delayMs = 350,
  persist,
  onError,
}: GuidanceSyncSchedulerInput) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let pendingPayload: GuidanceSyncPayload | null = null;

  const clearTimer = () => {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = null;
  };

  const flush = async () => {
    if (inFlight || !pendingPayload) {
      return;
    }

    inFlight = true;
    const payload = pendingPayload;
    pendingPayload = null;

    try {
      await persist(payload);
    } catch (error) {
      onError?.(error);
    } finally {
      inFlight = false;
      if (pendingPayload) {
        await flush();
      }
    }
  };

  return {
    enqueue(payload: GuidanceSyncPayload) {
      pendingPayload = payload;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, delayMs);
    },
    flushNow() {
      clearTimer();
      void flush();
    },
    dispose() {
      clearTimer();
      if (pendingPayload) {
        void flush();
        return;
      }
      pendingPayload = null;
    },
  };
};
