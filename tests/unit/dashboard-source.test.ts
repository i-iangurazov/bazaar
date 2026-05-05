import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("dashboard source layout", () => {
  it("does not render a separate low-stock card because low stock is already in attention", async () => {
    const source = await readSource("src/app/(app)/dashboard/page.tsx");

    expect(source).toContain('key: "lowStock"');
    expect(source).toContain('label: t("lowStock")');
    expect(source).not.toContain('<CardTitle>{t("lowStock")}</CardTitle>');
    expect(source).toContain('xl:col-span-8');
  });
});
