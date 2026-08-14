import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("POS receipt preview layout", () => {
  it("uses a wide desktop modal, a fitted table, and mobile line cards", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/components/pos/receipt-preview-modal.tsx"),
      "utf8",
    );

    expect(source).toContain('className="sm:max-w-[calc(100vw-3rem)] xl:max-w-7xl"');
    expect(source).toContain('<Table className="table-fixed" sortable={false}>');
    expect(source).not.toContain('Table className="min-w-[760px]"');
    expect(source).toContain('className="divide-y divide-border border-t border-border md:hidden"');
    expect(source).toContain('<col className="w-[32%]" />');
    expect(source).toContain('<col className="w-[18%]" />');
  });
});
