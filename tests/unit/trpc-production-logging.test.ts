import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("tRPC browser logging", () => {
  it("keeps client operation logging development-only", () => {
    const source = readFileSync(join(process.cwd(), "src/app/providers.tsx"), "utf8");

    expect(source).toContain('enabled: () => process.env.NODE_ENV === "development"');
    expect(source).not.toContain('opts.result instanceof Error');
  });
});
