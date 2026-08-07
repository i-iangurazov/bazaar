import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("inactive POS register history", () => {
  it("does not expose the KKM retry action for a read-only inactive register", async () => {
    const source = await readFile(
      join(process.cwd(), "src/app/(app)/pos/history/page.tsx"),
      "utf8",
    );
    const retryGuard = '{canOperateRegister && canRetryKkm && sale.kkmStatus === "FAILED"';
    const retryButtonStart = source.indexOf(retryGuard);
    expect(retryButtonStart).toBeGreaterThan(-1);
    const retryButton = source.slice(retryButtonStart, retryButtonStart + 500);

    expect(retryButton).toContain("retryKkmMutation.mutate");
    expect(retryButton).toContain('t("history.retryKkm")');
  });
});
