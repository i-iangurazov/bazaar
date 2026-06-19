import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/components/app-shell.tsx"), "utf8");

const expectInOrder = (content: string, markers: string[]) => {
  let previousIndex = -1;
  for (const marker of markers) {
    const index = content.indexOf(marker);
    expect(index, `Missing marker ${marker}`).toBeGreaterThanOrEqual(0);
    expect(index, `Marker ${marker} is out of order`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
};

describe("conservative app shell navigation source", () => {
  it("preserves previous group ids and order", () => {
    expect(source).toContain(
      'type NavGroupId = "core" | "operations" | "insights" | "admin" | "help";',
    );
    expectInOrder(source, [
      'id: "core"',
      'id: "operations"',
      'id: "insights"',
      'id: "admin"',
      'id: "help"',
    ]);
  });

  it("preserves previous core, operations, insights, admin, and help item order", () => {
    expectInOrder(source, [
      'key: "dashboard"',
      'key: "pos"',
      'key: "products"',
      'key: "inventory"',
      'key: "orders"',
      'key: "salesOrders"',
      'key: "purchaseOrders"',
      'key: "customers"',
      'key: "suppliers"',
      'key: "stores"',
      'key: "integrations"',
      'key: "imports"',
      'key: "onboarding"',
      'key: "reports"',
      'key: "adminMetrics"',
      'key: "users"',
      'key: "printing"',
      'key: "attributes"',
      'key: "units"',
      'key: "adminJobs"',
      'key: "billing"',
      'key: "platformOwner"',
      'key: "adminSupport"',
      'key: "help"',
      'key: "diagnostics"',
      'key: "whatsNew"',
    ]);
  });

  it("keeps the sidebar CTA compact in collapsed mode and adds permission filtering in place", () => {
    expect(source).toContain('aria-label={tCommand("openButton")}');
    expect(source).toContain("<CirclePlusIcon");
    expect(source).toContain(
      'className="h-10 w-full rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/15 hover:bg-sidebar-primary/90',
    );
    expect(source).toContain("group-data-[state=collapsed]/sidebar-wrapper:w-10");
    expect(source).toContain("group-data-[state=collapsed]/sidebar-wrapper:shadow-none");
    expect(source).toContain("requiredPermission?: AppPermission");
    expect(source).toContain("hasPermission(access, item.requiredPermission)");
    expect(source).toContain('requiredPermission: "manageCustomers"');
    expect(source).toContain("CustomerDatabaseIcon");
  });

  it("keeps product support settings visible through product management permission", () => {
    const attributesStart = source.indexOf('key: "attributes"');
    const attributesSource = source.slice(attributesStart, attributesStart + 260);
    const unitsStart = source.indexOf('key: "units"');
    const unitsSource = source.slice(unitsStart, unitsStart + 260);

    expect(attributesSource).toContain('requiredPermission: "manageProducts"');
    expect(attributesSource).not.toContain("adminOnly: true");
    expect(unitsSource).toContain('requiredPermission: "manageProducts"');
    expect(unitsSource).not.toContain("adminOnly: true");
  });

  it("uses distinct sidebar icons for neighboring inventory pages", () => {
    const inventoryStart = source.indexOf('key: "inventory"');
    const inventorySource = source.slice(inventoryStart, inventoryStart + 1500);

    expect(inventorySource).toContain("icon: InventoryIcon");
    expect(inventorySource).toContain("icon: InventoryOverviewIcon");
    expect(inventorySource).toContain("icon: ProductMovementIcon");
    expect(inventorySource).toContain("icon: ReceiveIcon");
    expect(inventorySource).toContain('key: "stockTransfer"');
    expect(inventorySource).toContain("icon: TransferIcon");
    expect(inventorySource).toContain("icon: WriteOffIcon");
    expect(inventorySource).toContain("icon: StockCountsIcon");
  });

  it("keeps integrations reachable from the mobile more menu", () => {
    const mobileMoreStart = source.indexOf("const mobileMoreCandidates");
    const mobileMoreSource = source.slice(mobileMoreStart, mobileMoreStart + 1800);

    expect(mobileMoreSource).toContain('key: "mobile-integrations"');
    expect(mobileMoreSource).toContain('label: tNav("integrations")');
    expect(mobileMoreSource).toContain('href: "/operations/integrations"');
    expect(mobileMoreSource).toContain('requiredPermission: "manageIntegrations"');
    expect(source).toContain('normalizedPath.startsWith("/operations/integrations")');
  });

  it("keeps POS sell as a standalone cashier workspace outside the admin shell", () => {
    const posStandaloneStart = source.indexOf('if (normalizedPath === "/pos/sell")');
    const adminShellReturnStart = source.indexOf("  return (\n    <GuidanceProvider", posStandaloneStart);

    expect(posStandaloneStart).toBeGreaterThanOrEqual(0);
    expect(adminShellReturnStart).toBeGreaterThan(posStandaloneStart);

    const posStandaloneBlock = source.slice(posStandaloneStart, adminShellReturnStart);
    expect(posStandaloneBlock).toContain("{children}");
    expect(posStandaloneBlock).not.toContain("isMobile === true");
    expect(posStandaloneBlock).not.toContain("<MobileAppShell");
    expect(posStandaloneBlock).not.toContain("<SidebarProvider");
  });
});
