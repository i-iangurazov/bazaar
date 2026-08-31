import { describe, expect, it } from "vitest";

import { formatMovementNote, sanitizeMovementNote } from "@/lib/i18n/movementNote";

const translate = (key: string, values?: Record<string, unknown>) =>
  `${key}:${JSON.stringify(values ?? {})}`;

describe("movement-note presentation", () => {
  it("keeps legacy zero-cost audit reasons out of customer-visible text", () => {
    expect(sanitizeMovementNote("[ZERO_COST_REASON] approved donation")).toBe("");
    expect(sanitizeMovementNote("Supplier samples • [ZERO_COST_REASON] approved donation")).toBe(
      "Supplier samples",
    );
    expect(formatMovementNote(translate, "[ZERO_COST_REASON] approved donation")).toBe("");
  });

  it("preserves and localizes the human-authored part of a historical note", () => {
    expect(formatMovementNote(translate, "stockCount:SC-004 • [ZERO_COST_REASON] recount")).toBe(
      'movementNoteStockCount:{"code":"SC-004"}',
    );
    expect(sanitizeMovementNote("Ordinary inventory note")).toBe("Ordinary inventory note");
  });
});
