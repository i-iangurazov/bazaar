import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appRoutes } from "@/lib/appRoutes";
import {
  canNavigateCommand,
  commandDestination,
  commandDestinations,
  searchResultDestination,
  type CommandId,
} from "@/lib/commandPaletteNavigation";

const expected = {
  "create-sale-order": "/pos/sell",
  "sale-return": "/pos/history",
  "inventory-receive": "/inventory/receiving",
  "inventory-adjust": "/inventory/write-offs",
  "inventory-count": "/inventory/counts?create=1",
  "inventory-transfer": "/inventory/transfers",
  "create-product": "/products/new?type=product",
  "create-bundle": "/products/new?type=bundle",
  "new-customer": "/customers?add=1",
  "new-supplier": "/suppliers?create=1",
  "new-employee": "/settings/users?create=1",
  "new-store": "/stores?create=1",
  "open-baam": "/baam",
  cash: "/pos/shifts#cash-movement",
  "finance-income": "/pos/shifts?cashMovementType=PAY_IN#cash-movement",
  "finance-expense": "/pos/shifts?cashMovementType=PAY_OUT#cash-movement",
} satisfies Record<CommandId, string>;
const ids = Object.keys(expected) as CommandId[];

describe("command panel canonical navigation", () => {
  it.each(ids)(
    "%s targets the real page, with the intended creation/operation parameters",
    (id) => {
      const { href } = commandDestination(id);
      expect(href).toBe(expected[id]);
      const pathname = href.split(/[?#]/)[0];
      expect(
        existsSync(`src/app/(app)${pathname}/page.tsx`) ||
          existsSync(`src/app${pathname}/page.tsx`),
      ).toBe(true);
    },
  );

  it("covers every command rendered by the panel and shares sidebar routes", () => {
    const source = readFileSync("src/components/command-palette.tsx", "utf8");
    expect(
      [...source.matchAll(/\.\.\.commandDestination\("([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(ids);
    expect(Object.keys(commandDestinations)).toEqual(ids);
    expect(source).not.toMatch(/href: "\/(?:inventory|products|pos|stores|suppliers)/);
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    for (const key of [
      "receiving",
      "transfers",
      "writeOffs",
      "counts",
      "products",
      "customers",
      "suppliers",
      "stores",
      "users",
      "baam",
    ] as const) {
      expect(shell).toContain(`href: appRoutes.${key}`);
      expect(Object.values(appRoutes)).toContain(appRoutes[key]);
    }
  });

  it.each(["ADMIN", "MANAGER", "STAFF", "CASHIER"])("filters every command for %s", (role) => {
    const allowed = ids.filter((id) => canNavigateCommand({ role }, commandDestination(id)));
    expect(allowed).toEqual(
      role === "ADMIN"
        ? ids
        : role === "MANAGER"
          ? ids.filter((id) => id !== "new-employee")
          : ["create-sale-order", "sale-return", "cash", "finance-income", "finance-expense"],
    );
  });

  it("rejects missing/unknown roles and unauthorized selection after a role change", () => {
    for (const role of [null, undefined, "OWNER"]) {
      expect(ids.some((id) => canNavigateCommand({ role }, commandDestination(id)))).toBe(false);
    }
    const staleSelection = commandDestination("new-employee");
    expect(canNavigateCommand({ role: "MANAGER" }, staleSelection)).toBe(false);
    expect(
      canNavigateCommand({ role: "ADMIN" }, { href: "//example.com", permission: "usePos" }),
    ).toBe(false);
  });

  it("forwards only context understood by each destination", () => {
    const context = {
      storeId: "store & 2",
      fromStoreId: "source-3",
      organizationId: "other-org",
      warehouseId: "warehouse",
      action: "delete",
    };
    for (const id of ids) {
      const url = new URL(commandDestination(id, context).href, "https://bazaar.test");
      expect(url.searchParams.has("organizationId")).toBe(false);
      expect(url.searchParams.has("warehouseId")).toBe(false);
      expect(url.searchParams.has("action")).toBe(false);
      const preservesStore = [
        "inventory-adjust",
        "inventory-count",
        "create-product",
        "create-bundle",
        "new-customer",
      ].includes(id);
      expect(url.searchParams.get("storeId")).toBe(preservesStore ? context.storeId : null);
      expect(url.searchParams.get("fromStoreId")).toBe(
        id === "inventory-transfer" ? "source-3" : null,
      );
    }
  });

  it("uses canonical, encoded destinations and role checks for all search result types", () => {
    for (const type of ["product", "supplier", "store", "purchaseOrder"] as const) {
      const destination = searchResultDestination({ type, id: "id/with?chars", label: "A & B" });
      expect(destination.href).toBe(
        type === "product"
          ? "/products/id%2Fwith%3Fchars"
          : type === "purchaseOrder"
            ? "/purchase-orders/id%2Fwith%3Fchars"
            : type === "supplier"
              ? "/suppliers?q=A+%26+B"
              : "/stores",
      );
      for (const role of ["ADMIN", "MANAGER", "STAFF", "CASHIER"]) {
        expect(canNavigateCommand({ role }, destination)).toBe(
          role === "ADMIN" || role === "MANAGER" || (role === "CASHIER" && type === "product"),
        );
      }
    }
  });
});
