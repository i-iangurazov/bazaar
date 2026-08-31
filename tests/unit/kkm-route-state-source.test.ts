import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("KKM operational route states", () => {
  it("checks entitlements before queue requests and renders dependency-specific recovery", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/app/(app)/pos/kkm/page.tsx"),
      "utf8",
    );

    expect(source).toContain("trpc.billing.features.useQuery");
    expect(source).toContain("enabled: canView && kkmEnabled");
    expect(source).toContain('href="/billing"');
    expect(source).toContain('t("planRequiredTitle")');
    expect(source).toContain('t("accessCheckFailedTitle")');
    expect(source).toContain('t("storesLoadFailedTitle")');
    expect(source).toContain('t("queueLoadFailedTitle")');
    expect(source).not.toContain("QueryErrorState");
  });
});
