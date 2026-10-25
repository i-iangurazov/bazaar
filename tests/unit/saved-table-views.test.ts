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
      activeViewId: null,
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

  it("keeps the explicitly selected view when two names share the same settings", () => {
    const first = createSavedTableView({
      name: "First",
      state: { search: "tea", page: 3, pageSize: 25 },
    });
    const second = { ...first, id: "second", name: "Second" };
    const selected = findMatchingSavedTableView(
      [first, second],
      { ...first.state, page: 1 },
      second.id,
    );
    expect(selected?.id).toBe(second.id);
    expect(
      findMatchingSavedTableView([first, second], { ...first.state, page: 8 }, second.id)?.id,
    ).toBe(second.id);
    expect(
      findMatchingSavedTableView([first, second], { ...first.state, search: "coffee" }, second.id),
    ).toBeNull();
    expect(
      findMatchingSavedTableView([first, second], { ...first.state, pageSize: 50 }, second.id),
    ).toBeNull();
  });

  it("retains valid view identity on reload and safely migrates old preferences", () => {
    const view = createSavedTableView({ name: "Tea", state: { search: "tea" } });
    const parse = (value: unknown) => value as typeof view.state;
    const stored = { views: [view], defaultViewId: view.id, activeViewId: view.id };
    expect(parseSavedTableViews(JSON.stringify(stored), parse).activeViewId).toBe(view.id);
    expect(
      parseSavedTableViews(JSON.stringify({ ...stored, activeViewId: "deleted" }), parse)
        .activeViewId,
    ).toBeNull();
    expect(
      parseSavedTableViews(JSON.stringify({ views: [view], defaultViewId: view.id }), parse),
    ).toEqual({ ...stored, activeViewId: null });
  });
});
