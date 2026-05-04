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

  it("keeps the sidebar CTA visual pattern and adds permission filtering in place", () => {
    expect(source).toContain('aria-label={tCommand("openButton")}');
    expect(source).toContain("<CirclePlusIcon");
    expect(source).toContain('className="h-10 w-full rounded-none bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"');
    expect(source).toContain("requiredPermission?: AppPermission");
    expect(source).toContain("hasPermission(access, item.requiredPermission)");
  });
});
