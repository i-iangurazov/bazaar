import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string) => readFile(path.join(process.cwd(), file), "utf8");

describe("inventory action compatibility navigation", () => {
  it("waits for the client session before authorizing legacy stock actions", async () => {
    const page = await read("src/app/(app)/inventory/page.tsx");

    expect(page).toContain("const { data: session, status: sessionStatus } = useSession()");
    expect(page).toContain('if (sessionStatus === "loading")');
    expect(page.indexOf('if (sessionStatus === "loading")')).toBeLessThan(
      page.indexOf("if ((isStockAction && !canManageStock)"),
    );
  });

  it("redirects the legacy receive action and preserves remaining query state", async () => {
    const page = await read("src/app/(app)/inventory/page.tsx");

    expect(page).toContain('action === "receive"');
    expect(page).toContain('nextParams.delete("action")');
    expect(page).toContain("`/inventory/receiving?${nextQuery}`");
    expect(page).toContain('"/inventory/receiving"');
  });

  it("uses the canonical receiving route for new command-palette navigation", async () => {
    const palette = await read("src/components/command-palette.tsx");

    expect(palette).toContain('href: "/inventory/receiving"');
    expect(palette).not.toContain('href: "/inventory?action=receive"');
  });

  it("replaces the legacy transfer action with one canonical navigation", async () => {
    const page = await read("src/app/(app)/inventory/page.tsx");

    expect(page).toContain('if (action === "transfer")');
    expect(page).toContain("router.replace(buildTransferHref(), { scroll: false });");
    expect(page).not.toContain("router.push(buildTransferHref());\n      return;");
    expect(page).toContain(
      "if (!storeId && (storesQuery.isLoading || (storesQuery.data?.length ?? 0) > 0))",
    );
  });
});
