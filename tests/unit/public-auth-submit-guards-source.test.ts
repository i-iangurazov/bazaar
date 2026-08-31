import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("public authentication submit guards", () => {
  it.each([
    ["login", "src/components/login-form.tsx", "submitInFlightRef"],
    ["reset request", "src/app/reset/page.tsx", "submitInFlightRef"],
    ["password reset", "src/app/reset/[token]/reset-token-form.tsx", "submitInFlightRef"],
    ["invite acceptance", "src/app/invite/[token]/page.tsx", "submitInFlightRef"],
    ["business registration", "src/app/register-business/[token]/page.tsx", "submitInFlightRef"],
  ])("guards same-tick duplicate %s submissions", (_name, path, guardName) => {
    const contents = source(path);
    expect(contents).toContain(`const ${guardName} = useRef(false)`);
    expect(contents).toContain(`if (${guardName}.current) return`);
    expect(contents).toContain(`${guardName}.current = true`);
    expect(contents).toContain(`${guardName}.current = false`);
  });

  it("guards both signup-mode mutation forms independently", () => {
    const contents = source("src/app/signup/page.tsx");
    for (const guardName of ["requestInFlightRef", "signupInFlightRef"]) {
      expect(contents).toContain(`const ${guardName} = useRef(false)`);
      expect(contents).toContain(`if (${guardName}.current) return`);
      expect(contents).toContain(`${guardName}.current = true`);
      expect(contents).toContain(`${guardName}.current = false`);
    }
  });
});
