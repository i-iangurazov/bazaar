import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/(app)/customers/page.tsx", "utf8");

describe("customer form accessibility source", () => {
  it("associates visible validation errors with fields and announces the error group", () => {
    for (const errorId of [
      "customer-name-error",
      "customer-contact-error",
      "customer-email-error",
      "customer-phone-error",
      "customer-address-error",
    ]) {
      expect(source).toContain(errorId);
    }
    expect(source).toContain('role="alert"');
    expect(source).toContain('aria-live="assertive"');
    expect(source).toContain("aria-invalid");
    expect(source).toContain("aria-describedby");
  });

  it("guards customer create and update against same-tick duplicate submissions", () => {
    expect(source).toContain("const formSubmitInFlightRef = useRef(false)");
    expect(source).toContain("if (formSubmitInFlightRef.current || !storeId || formErrors.length)");
    expect(source).toContain("formSubmitInFlightRef.current = true");
    expect(source.match(/formSubmitInFlightRef\.current = false/g)).toHaveLength(2);
  });
});
