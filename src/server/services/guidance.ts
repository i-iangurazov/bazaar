import { prisma } from "@/server/db/prisma";

type GuidanceState = {
  completedTours: string[];
  dismissedAutoTours: string[];
  toursDisabled: boolean;
  dismissedTips: string[];
  updatedAt: string | null;
};

const TOURS_DISABLED_MARKER = "__guidance:tours_disabled__";
const AUTO_TOUR_PREFIX = "__auto_tour__:";

const emptyState = (): GuidanceState => ({
  completedTours: [],
  dismissedAutoTours: [],
  toursDisabled: false,
  dismissedTips: [],
  updatedAt: null,
});

const toStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      unique.add(item.trim());
    }
  }
  return Array.from(unique);
};

const splitDismissedState = (value: unknown) => {
  const allValues = toStringArray(value);
  const dismissedTips: string[] = [];
  const dismissedAutoTours: string[] = [];
  let toursDisabled = false;

  for (const item of allValues) {
    if (item === TOURS_DISABLED_MARKER) {
      toursDisabled = true;
      continue;
    }
    if (item.startsWith(AUTO_TOUR_PREFIX)) {
      const tourId = item.slice(AUTO_TOUR_PREFIX.length).trim();
      if (tourId) {
        dismissedAutoTours.push(tourId);
      }
      continue;
    }
    dismissedTips.push(item);
  }

  return {
    dismissedTips,
    dismissedAutoTours,
    toursDisabled,
  };
};

const composeDismissedState = (input: {
  dismissedTips: string[];
  dismissedAutoTours: string[];
  toursDisabled: boolean;
}) => {
  const merged = new Set<string>();
  for (const tipId of input.dismissedTips) {
    merged.add(tipId);
  }
  for (const tourId of input.dismissedAutoTours) {
    merged.add(`${AUTO_TOUR_PREFIX}${tourId}`);
  }
  if (input.toursDisabled) {
    merged.add(TOURS_DISABLED_MARKER);
  }
  return Array.from(merged);
};

const normalizeState = (state: {
  completedToursJson: unknown;
  dismissedTipsJson: unknown;
  updatedAt: Date;
}): GuidanceState => {
  const dismissedState = splitDismissedState(state.dismissedTipsJson);

  return {
    completedTours: toStringArray(state.completedToursJson),
    dismissedAutoTours: dismissedState.dismissedAutoTours,
    toursDisabled: dismissedState.toursDisabled,
    dismissedTips: dismissedState.dismissedTips,
    updatedAt: state.updatedAt.toISOString(),
  };
};

const ensureGuideState = async (userId: string) => {
  const existing = await prisma.userGuideState.findUnique({ where: { userId } });
  if (existing) {
    return existing;
  }
  return prisma.userGuideState.create({
    data: {
      userId,
      completedToursJson: [],
      dismissedTipsJson: [],
    },
  });
};

export const getGuidanceState = async (userId: string): Promise<GuidanceState> => {
  const state = await prisma.userGuideState.findUnique({ where: { userId } });
  if (!state) {
    return emptyState();
  }
  return normalizeState(state);
};

export const dismissGuidanceTip = async (input: {
  userId: string;
  tipId: string;
}) => {
  const state = await ensureGuideState(input.userId);
  const dismissedState = splitDismissedState(state.dismissedTipsJson);
  const dismissedTips = new Set(dismissedState.dismissedTips);
  dismissedTips.add(input.tipId);

  const updated = await prisma.userGuideState.update({
    where: { userId: input.userId },
    data: {
      dismissedTipsJson: composeDismissedState({
        dismissedTips: Array.from(dismissedTips),
        dismissedAutoTours: dismissedState.dismissedAutoTours,
        toursDisabled: dismissedState.toursDisabled,
      }),
    },
  });

  return normalizeState(updated);
};

export const resetGuidanceTips = async (input: {
  userId: string;
  pageKey?: string;
}) => {
  const state = await ensureGuideState(input.userId);
  const dismissedState = splitDismissedState(state.dismissedTipsJson);
  const dismissedTips = dismissedState.dismissedTips;

  const nextTips = input.pageKey
    ? dismissedTips.filter((tipId) => !tipId.startsWith(`${input.pageKey}:`))
    : [];

  const updated = await prisma.userGuideState.update({
    where: { userId: input.userId },
    data: {
      dismissedTipsJson: composeDismissedState({
        dismissedTips: nextTips,
        dismissedAutoTours: dismissedState.dismissedAutoTours,
        toursDisabled: dismissedState.toursDisabled,
      }),
    },
  });

  return normalizeState(updated);
};

export const completeGuidanceTour = async (input: {
  userId: string;
  tourId: string;
}) => {
  const state = await ensureGuideState(input.userId);
  const completedTours = new Set(toStringArray(state.completedToursJson));
  completedTours.add(input.tourId);

  const updated = await prisma.userGuideState.update({
    where: { userId: input.userId },
    data: { completedToursJson: Array.from(completedTours) },
  });

  return normalizeState(updated);
};

export const resetGuidanceTour = async (input: {
  userId: string;
  tourId: string;
}) => {
  const state = await ensureGuideState(input.userId);
  const completedTours = toStringArray(state.completedToursJson).filter(
    (tourId) => tourId !== input.tourId,
  );

  const updated = await prisma.userGuideState.update({
    where: { userId: input.userId },
    data: { completedToursJson: completedTours },
  });

  return normalizeState(updated);
};

export const syncGuidanceState = async (input: {
  userId: string;
  dismissedTips?: string[];
  dismissedAutoTours?: string[];
  completedTours?: string[];
  toursDisabled?: boolean;
}) => {
  const state = await ensureGuideState(input.userId);
  const dismissedState = splitDismissedState(state.dismissedTipsJson);

  const dismissedTips =
    input.dismissedTips === undefined
      ? dismissedState.dismissedTips
      : toStringArray(input.dismissedTips);

  const dismissedAutoTours =
    input.dismissedAutoTours === undefined
      ? dismissedState.dismissedAutoTours
      : toStringArray(input.dismissedAutoTours);

  const toursDisabled = input.toursDisabled ?? dismissedState.toursDisabled;

  const completedTours =
    input.completedTours === undefined
      ? toStringArray(state.completedToursJson)
      : toStringArray(input.completedTours);

  const updated = await prisma.userGuideState.update({
    where: { userId: input.userId },
    data: {
      dismissedTipsJson: composeDismissedState({
        dismissedTips,
        dismissedAutoTours,
        toursDisabled,
      }),
      completedToursJson: completedTours,
    },
  });

  return normalizeState(updated);
};
