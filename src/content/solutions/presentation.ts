import type { PlanFeature } from "@/lib/billing/plans";
import type { SolutionContentId } from "./types";

// Product captures are existing real UI images with demonstration data. Page
// copy and feature availability stay separate from this presentation mapping.
export const solutionPresentation: Record<
  SolutionContentId,
  {
    capture: "products" | "movements" | "posDesktop" | "dashboard";
    guides: { category: string; slug: string }[];
    features: PlanFeature[];
  }
> = {
  inventory: {
    capture: "products",
    guides: [
      { category: "products", slug: "add-product" },
      { category: "products", slug: "import-products" },
    ],
    features: ["initialImport", "priceTags", "stockCounts", "analytics"],
  },
  pos: {
    capture: "posDesktop",
    guides: [
      { category: "pos", slug: "make-sale" },
      { category: "pos", slug: "return-sale" },
      { category: "pos", slug: "close-shift" },
    ],
    features: ["pos", "customerOrders", "loyalty", "kkm"],
  },
  warehouse: {
    capture: "movements",
    guides: [
      { category: "inventory", slug: "receiving" },
      { category: "inventory", slug: "transfer" },
      { category: "inventory", slug: "inventory-count" },
    ],
    features: ["stockCounts", "purchaseOrders", "replenishment", "expiryLots"],
  },
  retail: {
    capture: "dashboard",
    guides: [
      { category: "products", slug: "import-products" },
      { category: "settings", slug: "add-employee" },
      { category: "reports", slug: "analytics-basics" },
    ],
    features: ["pos", "stockCounts", "analytics", "bazaarCatalog"],
  },
  grocery: {
    capture: "posDesktop",
    guides: [
      { category: "inventory", slug: "receiving" },
      { category: "inventory", slug: "write-off" },
      { category: "inventory", slug: "inventory-count" },
    ],
    features: ["pos", "priceTags", "stockCounts", "expiryLots"],
  },
  clothing: {
    capture: "products",
    guides: [
      { category: "products", slug: "add-product" },
      { category: "pos", slug: "return-sale" },
      { category: "inventory", slug: "transfer" },
    ],
    features: ["pos", "priceTags", "loyalty", "bazaarCatalog"],
  },
  "store-guide": {
    capture: "movements",
    guides: [
      { category: "inventory", slug: "receiving" },
      { category: "inventory", slug: "inventory-count" },
      { category: "reports", slug: "analytics-basics" },
    ],
    features: ["initialImport", "stockCounts", "analytics"],
  },
};
