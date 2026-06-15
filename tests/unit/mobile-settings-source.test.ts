import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const profileSource = readFileSync(
  join(process.cwd(), "src/app/(app)/settings/profile/page.tsx"),
  "utf8",
);
const storesRouterSource = readFileSync(
  join(process.cwd(), "src/server/trpc/routers/stores.ts"),
  "utf8",
);

describe("mobile settings source", () => {
  it("adds a mobile-only settings hub with the expected app groups", () => {
    expect(profileSource).toContain("data-mobile-settings-hub");
    expect(profileSource).toContain('className="space-y-3 md:hidden"');
    expect(profileSource).toContain('href: "#store-profile"');
    expect(profileSource).toContain('href: "#product-settings"');
    expect(profileSource).toContain('href: "/settings/printing"');
    expect(profileSource).toContain('href: "/settings/users"');
    expect(profileSource).toContain('href: "/billing"');
    expect(profileSource).toContain('href: "#language-settings"');
    expect(profileSource).toContain('href: "/help"');
    expect(profileSource).toContain('href: "#account-settings"');
  });

  it("keeps store profile and product settings saves reachable on mobile", () => {
    expect(profileSource).toContain('id="store-profile"');
    expect(profileSource).toContain('id="product-settings"');
    expect(profileSource).toContain('className="bazaar-admin-surface scroll-mt-24"');
    expect(profileSource).toContain('className="bazaar-admin-modal-card md:hidden"');
    expect(profileSource).toContain('<FormActions className="hidden md:flex">');
  });

  it("uses store-scoped owner/admin mutations for product settings", () => {
    expect(profileSource).toContain("trpc.stores.updateProductSettings.useMutation");
    expect(profileSource).toContain("enableSku: values.enableSku");
    expect(profileSource).toContain("enableBarcode: values.enableBarcode");
    expect(profileSource).toContain(
      "enableSimilarProductCheck: values.enableSimilarProductCheck",
    );
    expect(storesRouterSource).toContain("updateProductSettings: adminOrOrgOwnerProcedure");
  });
});
