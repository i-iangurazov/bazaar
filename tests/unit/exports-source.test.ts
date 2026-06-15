import { describe, expect, it } from "vitest";
import { ExportType } from "@prisma/client";

import { EXPORT_TYPE_METADATA, EXPORT_TYPES } from "@/lib/export-types";

describe("exports UI metadata", () => {
  it("covers every backend export type", () => {
    expect([...EXPORT_TYPES].sort()).toEqual(Object.values(ExportType).sort());

    for (const type of Object.values(ExportType)) {
      expect(EXPORT_TYPE_METADATA[type]).toBeDefined();
      expect(EXPORT_TYPE_METADATA[type].titleKey).toBeTruthy();
      expect(EXPORT_TYPE_METADATA[type].descriptionKey).toBeTruthy();
      expect(["csv", "xlsx"]).toContain(EXPORT_TYPE_METADATA[type].recommendedFormat);
    }
  });
});
