// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadTableFile } from "@/lib/fileExport";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client file exports", () => {
  it("keeps XLSX out of initial route bundles and downloads it on demand", async () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/fileExport.ts"), "utf8");
    expect(source).not.toMatch(/^import .*from ["']xlsx["'];?$/m);
    expect(source).toContain('await import("xlsx")');

    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    await downloadTableFile({
      format: "xlsx",
      fileNameBase: "safe-export",
      header: ["Name", "Value"],
      rows: [["Product", "=unsafe"]],
    });

    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });
});
