import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("mobile customers source", () => {
  it("uses a mobile-only customer toolbar and customer cards without changing the desktop table", async () => {
    const source = await readSource("src/app/(app)/customers/page.tsx");

    expect(source).toContain("data-mobile-customers-toolbar");
    expect(source).toContain('className="hidden md:contents"');
    expect(source).toContain("<TableContainer>");
    expect(source).toContain('mobileSearchPlaceholder');
    expect(source).toContain('customer.lastOrderAt');
    expect(source).toContain('customer.orderCount');
    expect(source).toContain('href={`tel:${customer.phone}`}');
    expect(source).toContain('viewCustomerSales(customer)');
  });

  it("loads mobile customer detail through a store-scoped backend query", async () => {
    const pageSource = await readSource("src/app/(app)/customers/page.tsx");
    const routerSource = await readSource("src/server/trpc/routers/customers.ts");
    const serviceSource = await readSource("src/server/services/customers.ts");

    expect(pageSource).toContain("trpc.customers.detail.useQuery");
    expect(pageSource).toContain("recentOrders.map");
    expect(pageSource).toContain("mobileSheet");
    expect(routerSource).toContain("detail: managerProcedure");
    expect(routerSource).toContain("getCustomerDetail");
    expect(serviceSource).toContain("export const getCustomerDetail");
    expect(serviceSource).toContain("assertUserCanAccessStore");
    expect(serviceSource).toContain("storeId: customer.storeId");
  });

  it("keeps the POS mobile customer selector on a bottom sheet backed by customer search", async () => {
    const posSource = await readSource("src/app/(app)/pos/sell/page.tsx");

    expect(posSource).toContain("const MobileCustomerSheet = () => {");
    expect(posSource).toContain("customerSearchQuery.data.items.map");
    expect(posSource).toContain("handleSelectCustomer({");
    expect(posSource).toContain("handleClearCustomer");
    expect(posSource).toContain("fixed inset-0 z-[70] md:hidden");
  });
});
