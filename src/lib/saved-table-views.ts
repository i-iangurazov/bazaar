export type SavedTableView<TState> = {
  id: string;
  name: string;
  state: TState;
  createdAt: number;
  updatedAt: number;
};

export type SavedTableViewsState<TState> = {
  views: SavedTableView<TState>[];
  defaultViewId: string | null;
  activeViewId: string | null;
};

const normalizeSavedViewName = (value: string) => value.trim().replace(/\s+/g, " ");

export const parseSavedTableViews = <TState>(
  raw: string,
  parseState: (value: unknown) => TState | null,
): SavedTableViewsState<TState> => {
  try {
    const parsed = JSON.parse(raw) as {
      views?: Array<{
        id?: unknown;
        name?: unknown;
        state?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
      }>;
      defaultViewId?: unknown;
      activeViewId?: unknown;
    };

    const views = Array.isArray(parsed.views)
      ? parsed.views.flatMap((view) => {
          const id = typeof view.id === "string" ? view.id : "";
          const name = typeof view.name === "string" ? normalizeSavedViewName(view.name) : "";
          const state = parseState(view.state);
          const createdAt =
            typeof view.createdAt === "number" && Number.isFinite(view.createdAt)
              ? view.createdAt
              : Date.now();
          const updatedAt =
            typeof view.updatedAt === "number" && Number.isFinite(view.updatedAt)
              ? view.updatedAt
              : createdAt;
          if (!id || !name || !state) {
            return [];
          }
          return [{ id, name, state, createdAt, updatedAt }];
        })
      : [];

    const defaultViewId =
      typeof parsed.defaultViewId === "string" &&
      views.some((view) => view.id === parsed.defaultViewId)
        ? parsed.defaultViewId
        : null;

    const activeViewId =
      typeof parsed.activeViewId === "string" &&
      views.some((view) => view.id === parsed.activeViewId)
        ? parsed.activeViewId
        : null;
    return { views, defaultViewId, activeViewId };
  } catch {
    return { views: [], defaultViewId: null, activeViewId: null };
  }
};

export const statesAreEqual = <TState>(left: TState, right: TState) =>
  JSON.stringify(left) === JSON.stringify(right);

export const findMatchingSavedTableView = <TState>(
  views: SavedTableView<TState>[],
  currentState: TState,
  activeViewId: string | null = null,
) => {
  // A view describes filters, sorting and columns. Browsing another page does
  // not change that view, and applying one intentionally starts at page one.
  const settings = (state: TState) => {
    if (!state || typeof state !== "object" || Array.isArray(state)) return state;
    const configuration = { ...(state as Record<string, unknown>) };
    delete configuration.page;
    return configuration;
  };
  const currentSettings = settings(currentState);
  const matches = (view: SavedTableView<TState>) =>
    statesAreEqual(settings(view.state), currentSettings);
  return (
    views.find((view) => view.id === activeViewId && matches(view)) ?? views.find(matches) ?? null
  );
};

export const createSavedTableView = <TState>({
  name,
  state,
}: {
  name: string;
  state: TState;
}): SavedTableView<TState> => {
  const now = Date.now();
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `saved-view-${now}-${Math.random().toString(16).slice(2)}`,
    name: normalizeSavedViewName(name),
    state,
    createdAt: now,
    updatedAt: now,
  };
};

export const renameSavedTableView = <TState>(
  view: SavedTableView<TState>,
  nextName: string,
): SavedTableView<TState> => ({
  ...view,
  name: normalizeSavedViewName(nextName),
  updatedAt: Date.now(),
});

export const overwriteSavedTableView = <TState>(
  view: SavedTableView<TState>,
  nextState: TState,
): SavedTableView<TState> => ({
  ...view,
  state: nextState,
  updatedAt: Date.now(),
});

export const normalizeSavedTableViewName = normalizeSavedViewName;
