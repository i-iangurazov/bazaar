import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const interactionStack = {
  "@radix-ui/react-dismissable-layer": "1.1.12",
  "@radix-ui/react-focus-scope": "1.1.9",
  "@radix-ui/react-primitive": "2.1.5",
} as const;

describe("Radix interaction stack", () => {
  it("pins a single DismissableLayer and FocusScope implementation", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      pnpm?: { overrides?: Record<string, string> };
    };
    const packageSection = readFileSync("pnpm-lock.yaml", "utf8").split("snapshots:", 1)[0] ?? "";

    for (const [packageName, version] of Object.entries(interactionStack)) {
      expect(packageJson.pnpm?.overrides?.[packageName]).toBe(version);
      const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const resolutions = packageSection.match(new RegExp(`'${escapedName}@[^']+'`, "g")) ?? [];
      expect(resolutions).toEqual([`'${packageName}@${version}'`]);
    }
  });
});
