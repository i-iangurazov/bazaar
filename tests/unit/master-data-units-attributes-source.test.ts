import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("unit and attribute management hardening", () => {
  it("trims required UI and API fields before validating them", () => {
    const unitPage = readSource("src/app/(app)/settings/units/page.tsx");
    const attributePage = readSource("src/app/(app)/settings/attributes/page.tsx");
    const unitRouter = readSource("src/server/trpc/routers/units.ts");
    const attributeRouter = readSource("src/server/trpc/routers/attributes.ts");

    expect(unitPage.match(/z\.string\(\)\.trim\(\)\.min\(1/g)).toHaveLength(3);
    expect(attributePage.match(/z\.string\(\)\.trim\(\)\.min\(1/g)?.length).toBeGreaterThanOrEqual(
      3,
    );
    expect(unitRouter.match(/z\.string\(\)\.trim\(\)\.min\(1/g)?.length).toBeGreaterThanOrEqual(6);
    expect(
      attributeRouter.match(/z\.string\(\)\.trim\(\)\.min\(1/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("uses synchronous save/removal locks and a unit confirmation gate", () => {
    for (const source of [
      readSource("src/app/(app)/settings/units/page.tsx"),
      readSource("src/app/(app)/settings/attributes/page.tsx"),
    ]) {
      expect(source).toContain("const saveLockRef = useRef(false)");
      expect(source).toContain("const removeLockRef = useRef(false)");
      expect(source).toContain("if (saveLockRef.current)");
      expect(source).toContain("if (removeLockRef.current)");
      expect(source).toContain(".mutateAsync(");
    }
    expect(readSource("src/app/(app)/settings/units/page.tsx")).toContain(
      'description: t("confirmRemove", { code: unit.code })',
    );
  });

  it("checks every persisted attribute usage shape in one transaction before deletion", () => {
    const router = readSource("src/server/trpc/routers/attributes.ts");

    expect(router).toContain("return await ctx.prisma.$transaction(async (tx) =>");
    expect(router).toContain("tx.variantAttributeValue.count");
    expect(router).toContain("tx.categoryAttributeTemplate.count");
    expect(router).toContain("jsonb_typeof(variant.\"attributes\") = 'object'");
    expect(router).toContain('variant."attributes" ? ${existing.key}');
    expect(router).toContain("normalizedUsage > 0 || templateUsage > 0 || legacyUsage.length > 0");
  });
});
