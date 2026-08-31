import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import {
  getGuidesForCategory,
  getHelpGuideById,
  helpCategories,
  helpGuideId,
  helpGuides,
  helpJourney,
  helpRoleTracks,
  helpTasks,
} from "@/content/help/catalog";

const readSource = (relativePath: string) =>
  readFile(path.join(process.cwd(), relativePath), "utf8");

describe("Bazaar Guide route catalog", () => {
  it("gives every category a unique, populated public landing route", () => {
    const categorySlugs = helpCategories.map((category) => category.slug);
    expect(new Set(categorySlugs).size).toBe(categorySlugs.length);

    const publicUrls = new Set(sitemap().map((entry) => entry.url));
    for (const category of helpCategories) {
      expect(getGuidesForCategory(category.slug), category.slug).not.toHaveLength(0);
      expect(publicUrls).toContain(`https://www.bazaar.kg/help/${category.slug}`);
    }
  });

  it("publishes each unique guide route and resolves every catalog reference", () => {
    const guideIds = helpGuides.map(helpGuideId);
    expect(new Set(guideIds).size).toBe(guideIds.length);

    const publicUrls = new Set(sitemap().map((entry) => entry.url));
    for (const id of guideIds) {
      expect(publicUrls).toContain(`https://www.bazaar.kg/help/${id}`);
    }

    const referencedIds = [
      ...helpTasks.map((task) => task.guideId),
      ...helpJourney.map((item) => item.guideId),
      ...helpRoleTracks.flatMap((track) => track.guideIds),
    ];
    for (const id of referencedIds) {
      expect(getHelpGuideById(id), id).toBeTruthy();
    }
  });

  it("backs the new guide actions with app-owned order and customer pages", async () => {
    const orderList = await readSource("src/app/(app)/sales/orders/page.tsx");
    const orderCreate = await readSource("src/app/(app)/sales/orders/new/page.tsx");
    const customerList = await readSource("src/app/(app)/customers/page.tsx");
    const customerCreate = await readSource("src/app/(app)/customers/new/page.tsx");

    expect(getHelpGuideById("orders/create-order")?.appRoute).toBe("/sales/orders/new");
    expect(getHelpGuideById("orders/process-order")?.appRoute).toBe("/sales/orders");
    expect(getHelpGuideById("customers/add-customer")?.appRoute).toBe("/customers?add=1");
    expect(getHelpGuideById("customers/review-history")?.appRoute).toBe("/customers");

    expect(orderList).toContain('href="/sales/orders/new"');
    expect(orderCreate).toContain("router.push(`/sales/orders/${order.id}`)");
    expect(customerList).toContain('searchParams.get("add") === "1"');
    expect(customerCreate).toContain('redirect("/customers?add=1")');
  });
});
