import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("conventional favicon resource", () => {
  it("ships a valid ICO container at /favicon.ico", async () => {
    const icon = await readFile(path.join(process.cwd(), "public/favicon.ico"));

    expect(Array.from(icon.subarray(0, 4))).toEqual([0, 0, 1, 0]);
    expect(icon.byteLength).toBeGreaterThan(1_000);
  });
});
