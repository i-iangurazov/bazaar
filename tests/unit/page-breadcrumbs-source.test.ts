import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/components/page-breadcrumbs.tsx"), "utf8");

describe("page breadcrumbs source", () => {
  it("renders breadcrumbs as a polished compact navigation surface", () => {
    expect(source).toContain('import { ChevronRightIcon, HomeIcon } from "@/components/icons"');
    expect(source).toContain("scrollbar-none -mx-1 mb-3 overflow-x-auto");
    expect(source).toContain("rounded-md border border-border/80 bg-background/90 p-1");
    expect(source).toContain("shadow-sm");
    expect(source).toContain("<ChevronRightIcon");
    expect(source).toContain("<HomeIcon");
    expect(source).toContain('aria-current={isLast ? "page" : undefined}');
    expect(source).toContain("bg-primary/10 text-primary");
    expect(source).toContain("focus-visible:ring-ring/30");
  });
});
