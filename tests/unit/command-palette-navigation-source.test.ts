import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/components/command-palette.tsx"), "utf8");

const expectInOrder = (content: string, markers: string[]) => {
  let previousIndex = -1;
  for (const marker of markers) {
    const index = content.indexOf(marker);
    expect(index, `Missing marker ${marker}`).toBeGreaterThanOrEqual(0);
    expect(index, `Marker ${marker} is out of order`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
};

describe("conservative command palette role filtering source", () => {
  it("keeps the existing action categories and action order", () => {
    expect(source).toContain(
      'const actionCategories: CommandPaletteCategory[] = ["documents", "products", "other", "payments"];',
    );
    expectInOrder(source, [
      'id: "create-sale-order"',
      'id: "sale-return"',
      'id: "inventory-receive"',
      'id: "inventory-adjust"',
      'id: "inventory-count"',
      'id: "inventory-transfer"',
      'id: "create-product"',
      'id: "create-bundle"',
      'id: "new-customer"',
      'id: "new-supplier"',
      'id: "new-employee"',
      'id: "new-store"',
      'id: "cash"',
      'id: "finance-income"',
      'id: "finance-expense"',
    ]);
  });

  it("filters commands and search results with the central role permissions", () => {
    expect(source).toContain("permission?: AppPermission");
    expect(source).toContain("hasPermission(access, action.permission)");
    expect(source).toContain("permissionForSearchResultType(item.type)");
    expect(source).toContain('permission: "manageProducts"');
    expect(source).toContain('permission: "manageUsers"');
    expect(source).toContain('permission: "viewInventory"');
  });
});
