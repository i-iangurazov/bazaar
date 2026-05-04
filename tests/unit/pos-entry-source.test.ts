import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("pos entry navigation", () => {
  it("does not auto-redirect away from the POS hub when a shift is already open", async () => {
    const source = await readSource("src/app/(app)/pos/page.tsx");

    expect(source).toContain("router.push(`/pos/sell?registerId=${shift.registerId}`)");
    expect(source).not.toContain("router.replace(`/pos/sell?registerId=${selectedRegister.id}`)");
    expect(source).not.toContain("router.replace(`/pos/sell?registerId=");
    expect(source).toContain('t("entry.readyToSell")');
  });
});
