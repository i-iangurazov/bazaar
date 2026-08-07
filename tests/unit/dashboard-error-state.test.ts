import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("dashboard initial error state", () => {
  it("blocks fabricated dashboard content when bootstrap has no data", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /if \(dashboardQuery\.isError && !dashboardQuery\.data\) \{[\s\S]*?<QueryErrorState/,
    );
  });
});
