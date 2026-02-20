import { describe, expect, it, vi } from "vitest";

import {
  executeOptimisticMutation,
  resolveInlineDraft,
  resolveInlineKeyAction,
  shouldBeginInlineEdit,
} from "@/components/table/inlineEditPolicy";

describe("inline edit policy", () => {
  it("enters edit mode on desktop double-click and blocks it on touch devices", () => {
    expect(
      shouldBeginInlineEdit({
        trigger: "doubleClick",
        isTouch: false,
        canEdit: true,
        isSaving: false,
        activeCellId: null,
        cellId: "row-1:name",
      }),
    ).toBe(true);

    expect(
      shouldBeginInlineEdit({
        trigger: "doubleClick",
        isTouch: true,
        canEdit: true,
        isSaving: false,
        activeCellId: null,
        cellId: "row-1:name",
      }),
    ).toBe(false);
  });

  it("opens edit mode from mobile action button only on touch devices", () => {
    expect(
      shouldBeginInlineEdit({
        trigger: "mobileButton",
        isTouch: true,
        canEdit: true,
        isSaving: false,
        activeCellId: null,
        cellId: "row-1:name",
      }),
    ).toBe(true);

    expect(
      shouldBeginInlineEdit({
        trigger: "mobileButton",
        isTouch: false,
        canEdit: true,
        isSaving: false,
        activeCellId: null,
        cellId: "row-1:name",
      }),
    ).toBe(false);
  });

  it("resolves Enter to commit and Escape to cancel", () => {
    expect(resolveInlineKeyAction("Enter")).toBe("commit");
    expect(resolveInlineKeyAction("Escape")).toBe("cancel");
    expect(resolveInlineKeyAction("Tab")).toBe("noop");
  });

  it("treats blur as save only when value changed and parse succeeds", () => {
    const unchanged = resolveInlineDraft({
      rawValue: "12",
      currentValue: 12,
      parser: (raw) => ({ ok: true, value: Number(raw) }),
      equals: (left, right) => left === right,
    });
    expect(unchanged.kind).toBe("unchanged");

    const invalid = resolveInlineDraft({
      rawValue: "abc",
      currentValue: 12,
      parser: () => ({ ok: false, errorKey: "validationError" }),
      equals: (left, right) => left === right,
    });
    expect(invalid.kind).toBe("invalid");

    const changed = resolveInlineDraft({
      rawValue: "18",
      currentValue: 12,
      parser: (raw) => ({ ok: true, value: Number(raw) }),
      equals: (left, right) => left === right,
    });
    expect(changed.kind).toBe("changed");
    if (changed.kind === "changed") {
      expect(changed.value).toBe(18);
    }
  });

  it("applies optimistic value and rolls back on mutation failure", async () => {
    const apply = vi.fn();
    const rollback = vi.fn();

    const result = await executeOptimisticMutation({
      previousValue: 12,
      nextValue: 18,
      applyOptimistic: apply,
      rollback,
      execute: async () => {
        throw new Error("boom");
      },
    });

    expect(result.ok).toBe(false);
    expect(apply).toHaveBeenCalledWith(18);
    expect(rollback).toHaveBeenCalledWith(12);
  });
});
