import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/components/page-breadcrumbs.tsx"), "utf8");

describe("page breadcrumbs source", () => {
  it("renders compact breadcrumb navigation with the current page and visible keyboard focus", () => {
    expect(source).toContain('import { ChevronRightIcon, HomeIcon } from "@/components/icons"');
    expect(source).toContain("scrollbar-none -mx-1 mb-3 overflow-x-auto");
    expect(source).toContain(
      "inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground",
    );
    expect(source).toContain("<ChevronRightIcon");
    expect(source).toContain("<HomeIcon");
    expect(source).toContain('aria-current={isLast ? "page" : undefined}');
    expect(source).toContain('isLast ? "text-foreground" : "text-muted-foreground"');
    expect(source).toContain("focus-visible:ring-ring");
  });
});
