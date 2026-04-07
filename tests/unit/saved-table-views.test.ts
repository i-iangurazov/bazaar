import { describe, expect, it } from "vitest";

import {
  createSavedTableView,
  findMatchingSavedTableView,
  overwriteSavedTableView,
  parseSavedTableViews,
  renameSavedTableView,
} from "@/lib/saved-table-views";

describe("saved table views", () => {
  it("parses valid saved views and drops invalid entries", () => {
    const parsed = parseSavedTableViews(
      JSON.stringify({
        views: [
          {
            id: "view-1",
            name: "  Tea   View ",
            state: { search: "tea", pageSize: 25 },
            createdAt: 100,
            updatedAt: 200,
          },
          {
            id: "view-2",
            name: "Broken view",
            state: { pageSize: "bad" },
          },
        ],
        defaultViewId: "view-1",
      }),
      (value) => {
        if (
          typeof value === "object" &&
          value !== null &&
          typeof (value as { search?: unknown }).search === "string" &&
          typeof (value as { pageSize?: unknown }).pageSize === "number"
        ) {
          return value as { search: string; pageSize: number };
        }
        return null;
      },
    );

    expect(parsed).toEqual({
      views: [
        {
          id: "view-1",
          name: "Tea View",
          state: { search: "tea", pageSize: 25 },
          createdAt: 100,
          updatedAt: 200,
        },
      ],
      defaultViewId: "view-1",
    });
  });

  it("creates, finds, renames, and overwrites views", () => {
    const created = createSavedTableView({
      name: "  Fast   Products ",
      state: { search: "milk", pageSize: 50 },
    });

    expect(created.name).toBe("Fast Products");
    expect(created.state).toEqual({ search: "milk", pageSize: 50 });

    const matched = findMatchingSavedTableView([created], {
      search: "milk",
      pageSize: 50,
    });
    expect(matched?.id).toBe(created.id);

    const renamed = renameSavedTableView(created, "  Default   View ");
    expect(renamed.name).toBe("Default View");
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    const overwritten = overwriteSavedTableView(renamed, {
      search: "tea",
      pageSize: 25,
    });
    expect(overwritten.state).toEqual({ search: "tea", pageSize: 25 });
    expect(overwritten.updatedAt).toBeGreaterThanOrEqual(renamed.updatedAt);
  });
});
