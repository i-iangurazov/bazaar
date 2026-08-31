import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeSupplierMutationInput,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
  SUPPLIER_NOTES_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from "@/lib/supplierForm";

describe("supplier form", () => {
  it("trims submitted values and omits blank optional fields", () => {
    expect(
      normalizeSupplierMutationInput({
        name: "  QA-BAZAAR Supplier  ",
        email: "   ",
        phone: " +996 555 000 111 ",
        notes: "  ",
      }),
    ).toEqual({
      name: "QA-BAZAAR Supplier",
      email: undefined,
      phone: "+996 555 000 111",
      notes: undefined,
    });
  });

  it("keeps a synchronous in-flight guard around supplier mutations", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(app)/suppliers/page.tsx"), "utf8");
    const routerSource = readFileSync(
      join(process.cwd(), "src/server/trpc/routers/suppliers.ts"),
      "utf8",
    );

    expect(source).toContain('.min(2, t("nameMinLength"))');
    expect(source).toContain("SUPPLIER_NAME_MAX_LENGTH");
    expect(source).toContain("SUPPLIER_EMAIL_MAX_LENGTH");
    expect(source).toContain("SUPPLIER_PHONE_MAX_LENGTH");
    expect(source).toContain("SUPPLIER_NOTES_MAX_LENGTH");
    expect(source).toContain("noValidate");
    expect(source).toContain("if (submissionInFlightRef.current)");
    expect(source).toContain("submissionInFlightRef.current = true");
    expect(source.match(/submissionInFlightRef\.current = false/g)).toHaveLength(2);
    expect(source).toContain("normalizeSupplierMutationInput(values)");
    expect(routerSource.match(/\.min\(2\)\.max\(SUPPLIER_NAME_MAX_LENGTH\)/g)).toHaveLength(2);
  });

  it("keeps form limits aligned with the server boundary", () => {
    expect(SUPPLIER_NAME_MAX_LENGTH).toBe(180);
    expect(SUPPLIER_EMAIL_MAX_LENGTH).toBe(254);
    expect(SUPPLIER_PHONE_MAX_LENGTH).toBe(80);
    expect(SUPPLIER_NOTES_MAX_LENGTH).toBe(2_000);
  });
});
